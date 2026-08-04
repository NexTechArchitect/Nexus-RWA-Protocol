// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { Vm }              from "forge-std/Vm.sol";
import { stdError }        from "forge-std/StdError.sol";

// ── Core Contracts ────────────────────────────────────────────────
import { AssetRegistry }    from "../../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../../src/core/ComplianceEngine.sol";
import { RWAToken }         from "../../src/core/RWAToken.sol";
import { IdentityRegistry } from "../../src/core/IdentityRegistry.sol";

// ── Interfaces ────────────────────────────────────────────────────
import { IAssetRegistry }    from "../../src/interfaces/IAssetRegistry.sol";
import { IComplianceEngine } from "../../src/interfaces/IComplianceEngine.sol";
import { IRWAToken }         from "../../src/interfaces/IRWAToken.sol";

// ── Libraries ─────────────────────────────────────────────────────
import { JurisdictionLib } from "../../src/libraries/JurisdictionLib.sol";

// ── Mock Tokens ───────────────────────────────────────────────────
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal ERC20 used as a stand-in for the RWA asset token in forced-transfer tests
contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @title IntegrationFullFlow
/// @notice End-to-end protocol lifecycle: deploy -> register -> whitelist -> mint -> transfer -> compliance ->
///         forced-transfer -> freeze/unfreeze -> burn -> redeem.
///         Every happy-path and key sad-path is wired together using the real deployed contracts.
///
/// @dev    Test layout (read top-to-bottom as a story):
///         §0  Setup / constructor invariants
///         §1  Asset registration lifecycle
///         §2  Investor KYC + whitelisting
///         §3  RWAToken mint / burn through registry
///         §4  Peer-to-peer transfer enforcement
///         §5  ComplianceEngine — block / unblock investor
///         §6  Asset freeze / unfreeze through compliance officer
///         §7  Forced-transfer (legal clawback)
///         §8  Asset maturity & supply cap
///         §9  Cross-cutting admin paths (role updates, pausing)
///         §10 Revert coverage (all key error codes)
contract IntegrationFullFlow is Test {

    //==========================================================================
    // §0 — ACTORS & STATE
    //==========================================================================

    // Protocol roles
    address internal OWNER           = makeAddr("owner");           // deployer / owner of all contracts
    address internal REGISTRAR       = makeAddr("registrar");       // registers assets & whitelists investors
    address internal COMPLIANCE_OFF  = makeAddr("complianceOfficer"); // freeze / block / forced-transfer
    address internal VERIFIER        = makeAddr("verifier");        // identity-registry verifier

    // Investors
    address internal ALICE           = makeAddr("alice");           // primary investor (US, accredited)
    address internal BOB             = makeAddr("bob");             // secondary investor (UK, accredited)
    address internal CHARLIE         = makeAddr("charlie");         // non-accredited investor (DE)
    address internal EVE             = makeAddr("eve");             // sanctioned wallet (will be blocked)

    // Asset constants
    bytes32 internal constant ASSET_ID   = keccak256("NEXUS-TBILL-001");
    bytes32 internal constant ASSET_ID_2 = keccak256("NEXUS-RE-002");

    uint16  internal constant US_CODE  = 840; // United States
    uint16  internal constant UK_CODE  = 826; // United Kingdom
    uint16  internal constant DE_CODE  = 276; // Germany
    uint16  internal constant SG_CODE  = 702; // Singapore

    uint256 internal constant SUPPLY_CAP = 10_000_000e18; // 10M tokens
    uint40  internal constant MATURITY   = 0;              // no maturity (perpetual)

    // Contracts under test
    AssetRegistry  internal registry;
    ComplianceEngine internal compliance;
    RWAToken         internal rwaToken;

    //==========================================================================
    // §0.1 — HELPERS
    //==========================================================================

    /// @dev Returns block.timestamp + 1 year as a uint40 kyc expiry
    function _futureExpiry() internal view returns (uint40) {
        return uint40(block.timestamp + 365 days);
    }

    /// @dev Whitelist an investor for ASSET_ID with US KYC, accredited = true
    function _whitelistAlice() internal {
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);
    }

    function _whitelistBob() internal {
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_ID, BOB, UK_CODE, true);
    }

    function _whitelistCharlie() internal {
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_ID, CHARLIE, DE_CODE, false);
    }

    //==========================================================================
    // §0.2 — SETUP
    //==========================================================================

    function setUp() public {
        vm.startPrank(OWNER);

        // 1. Deploy AssetRegistry (needs compliance addr — use placeholder, update after)
        registry   = new AssetRegistry(REGISTRAR, address(1)); // placeholder compliance

        // 2. Deploy ComplianceEngine pointing to real registry
        compliance = new ComplianceEngine(address(registry), COMPLIANCE_OFF);

        // 3. Point registry to real compliance engine
        registry.setComplianceEngine(address(compliance));

        // 4. Deploy RWAToken (not yet registered)
        rwaToken = new RWAToken(
            "Nexus T-Bill Token",
            "nTBILL",
            ASSET_ID,
            address(registry),
            address(compliance)
        );

        vm.stopPrank();

        // 5. Register the asset (registrar role)
        vm.prank(REGISTRAR);
        registry.registerAsset(
            ASSET_ID,
            address(rwaToken),
            IAssetRegistry.AssetType.T_BILL,
            US_CODE,              // issuerCountryCode
            true,                 // allowAllJurisdictions
            0,                    // minAccreditationLevel (0 = anyone)
            SUPPLY_CAP,
            MATURITY
        );
    }

    //==========================================================================
    // §0.3 — DEPLOY INVARIANTS (smoke-test the whole wiring)
    //==========================================================================

    function test_DeployWiring_CorrectAddresses() public view {
        assertEq(registry.getRegistrar(),        REGISTRAR,               "registrar mismatch");
        assertEq(registry.getComplianceEngine(), address(compliance),      "compliance mismatch");
        assertEq(rwaToken.getAssetRegistry(),    address(registry),        "token->registry mismatch");
        assertEq(rwaToken.getComplianceEngine(), address(compliance),      "token->compliance mismatch");
        assertEq(rwaToken.assetId(),             ASSET_ID,                 "assetId mismatch");
        assertEq(compliance.getAssetRegistry(),  address(registry),        "compliance->registry mismatch");
        assertEq(compliance.getComplianceOfficer(), COMPLIANCE_OFF,        "officer mismatch");
    }

    function test_DeployWiring_AssetRegisteredAndActive() public view {
        assertTrue(registry.isAssetActive(ASSET_ID), "asset should be active after registration");
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.assetType), uint8(IAssetRegistry.AssetType.T_BILL));
        assertEq(info.totalSupplyCap, SUPPLY_CAP);
        assertEq(info.mintedSupply,   0);
    }

    //==========================================================================
    // §1 — ASSET REGISTRATION LIFECYCLE
    //==========================================================================

    function test_RegisterAsset_SecondAsset_Success() public {
        // Deploy a second token for a new asset
        vm.prank(OWNER);
        RWAToken token2 = new RWAToken("Nexus Real Estate", "nRE", ASSET_ID_2, address(registry), address(compliance));

        vm.prank(REGISTRAR);
        registry.registerAsset(
            ASSET_ID_2,
            address(token2),
            IAssetRegistry.AssetType.REAL_ESTATE,
            UK_CODE,
            false,  // restricted jurisdictions
            1,      // minAccreditationLevel = 1 (accredited only)
            500_000e18,
            0
        );

        assertTrue(registry.isAssetActive(ASSET_ID_2));
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID_2);
        assertEq(uint8(info.assetType), uint8(IAssetRegistry.AssetType.REAL_ESTATE));
        assertEq(info.totalSupplyCap, 500_000e18);
    }

    function test_RegisterAsset_Duplicate_Reverts() public {
        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetAlreadyRegistered.selector, ASSET_ID));
        registry.registerAsset(ASSET_ID, address(rwaToken), IAssetRegistry.AssetType.T_BILL, US_CODE, true, 0, SUPPLY_CAP, 0);
    }

    function test_RegisterAsset_ZeroSupplyCap_Reverts() public {
        bytes32 id3 = keccak256("ASSET-3");
        vm.prank(OWNER);
        RWAToken t3 = new RWAToken("T3", "T3", id3, address(registry), address(compliance));

        vm.prank(REGISTRAR);
        vm.expectRevert(IAssetRegistry.ZeroValue.selector);
        registry.registerAsset(id3, address(t3), IAssetRegistry.AssetType.COMMODITY, US_CODE, true, 0, 0, 0);
    }

    function test_UpdateAssetStatus_PauseThenResume() public {
        // Pause
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.PAUSED);
        assertFalse(registry.isAssetActive(ASSET_ID), "should be inactive when PAUSED");

        // Re-activate
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.ACTIVE);
        assertTrue(registry.isAssetActive(ASSET_ID), "should be ACTIVE again");
    }

    function test_UpdateAssetStatus_Redeemed_Irreversible() public {
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.REDEEMED);

        assertFalse(registry.isAssetActive(ASSET_ID));

        // Trying to go back to ACTIVE should revert
        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetRedeemed.selector, ASSET_ID));
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.ACTIVE);
    }

    function test_UpdateSupplyCap_IncreasesCorrectly() public {
        uint256 newCap = SUPPLY_CAP * 2;
        vm.prank(REGISTRAR);
        registry.updateSupplyCap(ASSET_ID, newCap);

        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(info.totalSupplyCap, newCap);
    }

    //==========================================================================
    // §2 — INVESTOR KYC + WHITELISTING
    //==========================================================================

    function test_WhitelistInvestor_Alice_Success() public {
        assertFalse(registry.isWhitelisted(ASSET_ID, ALICE), "alice should not be whitelisted yet");

        vm.prank(REGISTRAR);
        vm.expectEmit(true, true, false, true);
        emit IAssetRegistry.InvestorWhitelisted(ASSET_ID, ALICE, US_CODE, true);
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);

        assertTrue(registry.isWhitelisted(ASSET_ID, ALICE));

        JurisdictionLib.InvestorData memory data = registry.getInvestorData(ALICE);
        assertEq(data.countryCode,  US_CODE);
        assertTrue(data.isAccredited);
        assertTrue(data.isKYCVerified);
        assertGt(data.kycExpiry, uint40(block.timestamp));
    }

    function test_WhitelistInvestor_Duplicate_Reverts() public {
        _whitelistAlice();

        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.InvestorAlreadyWhitelisted.selector, ASSET_ID, ALICE));
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);
    }

    function test_RemoveInvestor_StopsTransfers() public {
        _whitelistAlice();
        _whitelistBob();

        // Mint to Alice
        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // Remove Alice from whitelist
        vm.prank(REGISTRAR);
        registry.removeInvestor(ASSET_ID, ALICE);

        assertFalse(registry.isWhitelisted(ASSET_ID, ALICE));

        // Transfer from Alice should now revert
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, ALICE));
        rwaToken.transfer(BOB, 100e18);
    }

    function test_UpdateInvestorKYC_ChangesData() public {
        _whitelistAlice();

        uint40 newExpiry = uint40(block.timestamp + 2 * 365 days);

        vm.prank(REGISTRAR);
        registry.updateInvestorKYC(ALICE, UK_CODE, false, newExpiry);

        JurisdictionLib.InvestorData memory data = registry.getInvestorData(ALICE);
        assertEq(data.countryCode, UK_CODE);
        assertFalse(data.isAccredited);
        assertEq(data.kycExpiry, newExpiry);
    }

    //==========================================================================
    // §3 — RWTOKEN MINT / BURN THROUGH REGISTRY
    //==========================================================================

    function test_Mint_Success_UpdatesSupply() public {
        _whitelistAlice();
        uint256 amount = 100_000e18;

        vm.prank(address(registry));
        vm.expectEmit(true, true, false, true);
        emit IRWAToken.Minted(ASSET_ID, ALICE, amount);
        rwaToken.mint(ALICE, amount);

        assertEq(rwaToken.balanceOf(ALICE), amount);
        assertEq(registry.getMintedSupply(ASSET_ID), amount);
    }

    function test_Mint_NotWhitelisted_Reverts() public {
        // ALICE is not whitelisted
        vm.prank(address(registry));
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, ALICE));
        rwaToken.mint(ALICE, 1000e18);
    }

    function test_Mint_SupplyCapExceeded_Reverts() public {
        _whitelistAlice();

        // Mint exactly up to cap first (in two chunks because we need to not exceed)
        uint256 almostCap = SUPPLY_CAP - 1e18;
        vm.prank(address(registry));
        rwaToken.mint(ALICE, almostCap);
        assertEq(registry.getMintedSupply(ASSET_ID), almostCap);

        // Now try to mint 2e18 (would exceed by 1e18)
        vm.prank(address(registry));
        // recordMint in registry will catch this
        vm.expectRevert();
        rwaToken.mint(ALICE, 2e18);
    }

    function test_Burn_Success_DecreasesSupply() public {
        _whitelistAlice();
        uint256 mintAmt = 500e18;
        uint256 burnAmt = 200e18;

        vm.prank(address(registry));
        rwaToken.mint(ALICE, mintAmt);

        // Burn via registry (registryOrCompliance modifier allows this)
        vm.prank(address(registry));
        vm.expectEmit(true, true, false, true);
        emit IRWAToken.Burned(ASSET_ID, ALICE, burnAmt);
        rwaToken.burn(ALICE, burnAmt);

        assertEq(rwaToken.balanceOf(ALICE), mintAmt - burnAmt);
        assertEq(registry.getMintedSupply(ASSET_ID), mintAmt - burnAmt);
    }

    function test_Burn_ExceedsBalance_Reverts() public {
        _whitelistAlice();
        uint256 mintAmt = 100e18;

        vm.prank(address(registry));
        rwaToken.mint(ALICE, mintAmt);

        vm.prank(address(registry));
        vm.expectRevert(
            abi.encodeWithSelector(IRWAToken.BurnExceedsBalance.selector, ALICE, mintAmt, mintAmt + 1)
        );
        rwaToken.burn(ALICE, mintAmt + 1);
    }

    function test_Mint_OnlyRegistry_Enforced() public {
        // Random EOA tries to mint directly
        vm.prank(ALICE);
        vm.expectRevert(IRWAToken.CallerNotRegistry.selector);
        rwaToken.mint(ALICE, 1000e18);
    }

    //==========================================================================
    // §4 — P2P TRANSFER ENFORCEMENT
    //==========================================================================

    function test_Transfer_BothWhitelisted_Success() public {
        _whitelistAlice();
        _whitelistBob();

        uint256 amount = 1000e18;

        vm.prank(address(registry));
        rwaToken.mint(ALICE, amount);

        vm.prank(ALICE);
        rwaToken.transfer(BOB, amount);

        assertEq(rwaToken.balanceOf(ALICE), 0);
        assertEq(rwaToken.balanceOf(BOB),   amount);
    }

    function test_Transfer_ReceiverNotWhitelisted_Reverts() public {
        _whitelistAlice();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // BOB is not whitelisted — transfer should revert
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, BOB));
        rwaToken.transfer(BOB, 500e18);
    }

    function test_Transfer_SenderNotWhitelisted_Reverts() public {
        // Whitelist BOB only — no way to put tokens in ALICE without whitelisting her first,
        // so we test via a direct _update scenario: remove Alice after minting
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // Remove Alice — she now holds tokens but is not whitelisted
        vm.prank(REGISTRAR);
        registry.removeInvestor(ASSET_ID, ALICE);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, ALICE));
        rwaToken.transfer(BOB, 100e18);
    }

    function test_Transfer_AssetPaused_Reverts() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // Pause the asset at registry level
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.PAUSED);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, ASSET_ID));
        rwaToken.transfer(BOB, 100e18);
    }

    //==========================================================================
    // §5 — COMPLIANCE ENGINE: BLOCK / UNBLOCK
    //==========================================================================

    function test_BlockInvestor_PreventsTransfers() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // Block Alice globally
        vm.prank(COMPLIANCE_OFF);
        vm.expectEmit(true, true, false, false);
        emit IComplianceEngine.InvestorBlocked(ALICE, COMPLIANCE_OFF);
        compliance.blockInvestor(ALICE);

        assertTrue(compliance.isBlocked(ALICE));

        // canTransfer should return false
        assertFalse(compliance.canTransfer(ASSET_ID, ALICE, BOB));

        // enforceTransferCompliance should revert
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.BlockedInvestor.selector, ALICE));
        compliance.enforceTransferCompliance(ASSET_ID, ALICE, BOB);
    }

    function test_UnblockInvestor_RestoresCanTransfer() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(COMPLIANCE_OFF);
        compliance.blockInvestor(ALICE);
        assertTrue(compliance.isBlocked(ALICE));

        vm.prank(COMPLIANCE_OFF);
        vm.expectEmit(true, true, false, false);
        emit IComplianceEngine.InvestorUnblocked(ALICE, COMPLIANCE_OFF);
        compliance.unblockInvestor(ALICE);

        assertFalse(compliance.isBlocked(ALICE));
        assertTrue(compliance.canTransfer(ASSET_ID, ALICE, BOB));
    }

    function test_BlockInvestor_Receiver_PreventsTransfer() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);

        // Block BOB (receiver side)
        vm.prank(COMPLIANCE_OFF);
        compliance.blockInvestor(BOB);

        assertFalse(compliance.canTransfer(ASSET_ID, ALICE, BOB));
    }

    function test_BlockSameInvestorTwice_Reverts() public {
        vm.prank(COMPLIANCE_OFF);
        compliance.blockInvestor(ALICE);

        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.InvestorAlreadyBlocked.selector, ALICE));
        compliance.blockInvestor(ALICE);
    }

    function test_UnblockNonBlockedInvestor_Reverts() public {
        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.InvestorNotBlocked.selector, ALICE));
        compliance.unblockInvestor(ALICE);
    }

    function test_SelfTransfer_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.SelfTransfer.selector, ALICE));
        compliance.enforceTransferCompliance(ASSET_ID, ALICE, ALICE);
    }

    //==========================================================================
    // §6 — ASSET FREEZE / UNFREEZE THROUGH COMPLIANCE ENGINE
    //==========================================================================

    function test_FreezeAsset_BlocksAllTransfers() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 2000e18);

        // Freeze via ComplianceEngine -> calls registry.freezeAsset
        vm.prank(COMPLIANCE_OFF);
        vm.expectEmit(true, true, false, false);
        emit IComplianceEngine.AssetFrozen(ASSET_ID, COMPLIANCE_OFF);
        compliance.freezeAsset(ASSET_ID);

        // Asset status should be FROZEN in registry
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.FROZEN));
        assertFalse(registry.isAssetActive(ASSET_ID));

        // Transfer should revert (isAssetActive check in _update)
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, ASSET_ID));
        rwaToken.transfer(BOB, 100e18);
    }

    function test_UnfreezeAsset_ResumesTrades() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(address(registry));
        rwaToken.mint(ALICE, 2000e18);

        vm.prank(COMPLIANCE_OFF);
        compliance.freezeAsset(ASSET_ID);

        // Unfreeze
        vm.prank(COMPLIANCE_OFF);
        vm.expectEmit(true, true, false, false);
        emit IComplianceEngine.AssetUnfrozen(ASSET_ID, COMPLIANCE_OFF);
        compliance.unfreezeAsset(ASSET_ID);

        // Asset should be ACTIVE again
        assertTrue(registry.isAssetActive(ASSET_ID));

        // Transfers should work again
        vm.prank(ALICE);
        rwaToken.transfer(BOB, 500e18);
        assertEq(rwaToken.balanceOf(BOB), 500e18);
    }

    function test_FreezeTwice_Reverts() public {
        vm.prank(COMPLIANCE_OFF);
        compliance.freezeAsset(ASSET_ID);

        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetFrozen.selector, ASSET_ID));
        compliance.freezeAsset(ASSET_ID);
    }

    function test_UnfreezeNonFrozenAsset_Reverts() public {
        // Asset is ACTIVE, unfreezing ACTIVE should revert
        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(); // AssetNotActive
        compliance.unfreezeAsset(ASSET_ID);
    }

    //==========================================================================
    // §7 — FORCED TRANSFER (LEGAL CLAWBACK)
    //==========================================================================

    function test_ForcedTransfer_Success_BypassesWhitelist() public {
        _whitelistAlice();

        uint256 mintAmount  = 5000e18;
        uint256 clawAmount  = 2000e18;

        vm.prank(address(registry));
        rwaToken.mint(ALICE, mintAmount);

        // BOB is NOT whitelisted — forced transfer still works
        assertFalse(registry.isWhitelisted(ASSET_ID, BOB));

        vm.prank(COMPLIANCE_OFF);
        vm.expectEmit(true, true, true, true);
        emit IComplianceEngine.ForcedTransferExecuted(ASSET_ID, ALICE, BOB, clawAmount);
        compliance.executeForcedTransfer(ASSET_ID, address(rwaToken), ALICE, BOB, clawAmount);

        assertEq(rwaToken.balanceOf(ALICE), mintAmount - clawAmount);
        assertEq(rwaToken.balanceOf(BOB),   clawAmount);
    }

    function test_ForcedTransfer_ZeroAmount_Reverts() public {
        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(IComplianceEngine.ZeroAmount.selector);
        compliance.executeForcedTransfer(ASSET_ID, address(rwaToken), ALICE, BOB, 0);
    }

    function test_ForcedTransfer_SelfTransfer_Reverts() public {
        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.SelfTransfer.selector, ALICE));
        compliance.executeForcedTransfer(ASSET_ID, address(rwaToken), ALICE, ALICE, 100e18);
    }

    function test_ForcedTransfer_WrongTokenAssetId_Reverts() public {
        // Create a second token for a different asset — passing it with the first ASSET_ID
        bytes32 wrongId = keccak256("DIFFERENT");
        vm.prank(OWNER);
        RWAToken wrongToken = new RWAToken("Wrong", "WRG", wrongId, address(registry), address(compliance));

        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.AssetNotRegistered.selector, ASSET_ID));
        // token.assetId() = wrongId != ASSET_ID  -> should revert
        compliance.executeForcedTransfer(ASSET_ID, address(wrongToken), ALICE, BOB, 100e18);
    }

    function test_ForcedTransfer_OnlyOfficer_Enforced() public {
        vm.prank(ALICE); // random user
        vm.expectRevert(IComplianceEngine.OnlyComplianceOfficer.selector);
        compliance.executeForcedTransfer(ASSET_ID, address(rwaToken), ALICE, BOB, 100e18);
    }

    //==========================================================================
    // §8 — ASSET MATURITY & SUPPLY CAP EDGE CASES
    //==========================================================================

    function test_AssetMaturity_BlocksMint() public {
        bytes32 matId = keccak256("MAT-ASSET");

        vm.prank(OWNER);
        RWAToken matToken = new RWAToken("Maturing Token", "MAT", matId, address(registry), address(compliance));

        uint40 shortMaturity = uint40(block.timestamp + 10); // expires in 10s

        vm.prank(REGISTRAR);
        registry.registerAsset(matId, address(matToken), IAssetRegistry.AssetType.CORPORATE_BOND, US_CODE, true, 0, 1_000_000e18, shortMaturity);

        // Whitelist alice for this asset
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(matId, ALICE, US_CODE, true);

        // Skip past maturity
        skip(11);

        // Mint should fail because asset has matured, so `isAssetActive` returns false in RWAToken
        vm.prank(address(registry));
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, matId));
        matToken.mint(ALICE, 1000e18);
    }

    function test_SupplyCap_ExactBoundary() public {
        _whitelistAlice();

        // Mint exactly at cap — should succeed
        vm.prank(address(registry));
        rwaToken.mint(ALICE, SUPPLY_CAP);

        assertEq(registry.getMintedSupply(ASSET_ID), SUPPLY_CAP);

        // One more wei should fail
        _whitelistBob();
        vm.prank(address(registry));
        vm.expectRevert();
        rwaToken.mint(BOB, 1);
    }

    function test_SupplyCapUpdate_BelowMinted_Reverts() public {
        _whitelistAlice();
        uint256 mintAmt = 500_000e18;

        vm.prank(address(registry));
        rwaToken.mint(ALICE, mintAmt);

        // Try to set supply cap BELOW already-minted amount
        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.NewCapBelowMinted.selector, ASSET_ID, mintAmt, mintAmt - 1));
        registry.updateSupplyCap(ASSET_ID, mintAmt - 1);
    }

    //==========================================================================
    // §9 — ADMIN PATHS (ROLE UPDATES, PAUSE)
    //==========================================================================

    function test_SetComplianceOfficer_UpdatesCorrectly() public {
        address newOfficer = makeAddr("newOfficer");

        vm.prank(OWNER);
        vm.expectEmit(true, true, false, false);
        emit IComplianceEngine.ComplianceOfficerUpdated(COMPLIANCE_OFF, newOfficer);
        compliance.setComplianceOfficer(newOfficer);

        assertEq(compliance.getComplianceOfficer(), newOfficer);

        // Old officer can no longer block
        vm.prank(COMPLIANCE_OFF);
        vm.expectRevert(IComplianceEngine.OnlyComplianceOfficer.selector);
        compliance.blockInvestor(ALICE);

        // New officer can block
        vm.prank(newOfficer);
        compliance.blockInvestor(ALICE);
        assertTrue(compliance.isBlocked(ALICE));
    }

    function test_SetRegistrar_UpdatesCorrectly() public {
        address newRegistrar = makeAddr("newRegistrar");

        vm.prank(OWNER);
        registry.setRegistrar(newRegistrar);

        assertEq(registry.getRegistrar(), newRegistrar);

        // Old registrar can no longer whitelist
        vm.prank(REGISTRAR);
        vm.expectRevert(IAssetRegistry.OnlyRegistrar.selector);
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);

        // New registrar can
        vm.prank(newRegistrar);
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);
        assertTrue(registry.isWhitelisted(ASSET_ID, ALICE));
    }

    function test_Pause_Registry_BlocksAllWrites() public {
        vm.prank(OWNER);
        registry.pause();

        vm.prank(REGISTRAR);
        vm.expectRevert(); // Pausable: paused
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);

        vm.prank(OWNER);
        registry.unpause();

        // Should work again after unpause
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_ID, ALICE, US_CODE, true);
        assertTrue(registry.isWhitelisted(ASSET_ID, ALICE));
    }

    function test_Pause_RWAToken_BlocksMintBurn() public {
        _whitelistAlice();

        // Pause the token itself
        vm.prank(OWNER);
        rwaToken.pause();

        vm.prank(address(registry));
        vm.expectRevert(); // ERC20Pausable: token transfer while paused
        rwaToken.mint(ALICE, 1000e18);

        vm.prank(OWNER);
        rwaToken.unpause();

        // Works again
        vm.prank(address(registry));
        rwaToken.mint(ALICE, 1000e18);
        assertEq(rwaToken.balanceOf(ALICE), 1000e18);
    }

    function test_SetComplianceEngine_ZeroAddress_Reverts() public {
        vm.prank(OWNER);
        vm.expectRevert(IComplianceEngine.ZeroAddress.selector);
        compliance.setComplianceOfficer(address(0));
    }

    //==========================================================================
    // §10 — FULL LIFECYCLE STORY (A -> Z in one test)
    //==========================================================================

    /// @notice The definitive end-to-end test: from zero-state to full redemption.
    /// Deploy -> Register Asset -> KYC Investors -> Mint -> Trade -> Compliance Action ->
    /// Forced Transfer -> Unfreeze -> Burn -> Redeem Asset
    function test_FullProtocolLifecycle_AtoZ() public {
        // ── Step 1: Whitelist investors ───────────────────────────────────────
        _whitelistAlice();
        _whitelistBob();

        // ── Step 2: Mint primary allocation to Alice ──────────────────────────
        uint256 aliceMint = 1_000_000e18;
        vm.prank(address(registry));
        rwaToken.mint(ALICE, aliceMint);
        assertEq(rwaToken.balanceOf(ALICE), aliceMint);
        assertEq(registry.getMintedSupply(ASSET_ID), aliceMint);

        // ── Step 3: Alice transfers some to Bob ───────────────────────────────
        uint256 aliceToBob = 200_000e18;
        vm.prank(ALICE);
        rwaToken.transfer(BOB, aliceToBob);
        assertEq(rwaToken.balanceOf(ALICE), aliceMint - aliceToBob);
        assertEq(rwaToken.balanceOf(BOB),   aliceToBob);

        // ── Step 4: Compliance blocks Bob (suspicious activity) ───────────────
        vm.prank(COMPLIANCE_OFF);
        compliance.blockInvestor(BOB);
        assertFalse(compliance.canTransfer(ASSET_ID, BOB, ALICE));

        // ── Step 5: Freeze the entire asset for investigation ─────────────────
        vm.prank(COMPLIANCE_OFF);
        compliance.freezeAsset(ASSET_ID);
        assertFalse(registry.isAssetActive(ASSET_ID));

        // ── Step 6: Forced transfer (court order) — move Bob's tokens to ALICE -
        // Forced transfer works EVEN on frozen assets because it bypasses the _update hook
        uint256 clawback = aliceToBob;
        vm.prank(COMPLIANCE_OFF);
        compliance.executeForcedTransfer(ASSET_ID, address(rwaToken), BOB, ALICE, clawback);
        assertEq(rwaToken.balanceOf(BOB),   0);
        assertEq(rwaToken.balanceOf(ALICE), aliceMint); // back to original

        // ── Step 7: Unblock Bob and Unfreeze asset ─────────────────────────────
        vm.prank(COMPLIANCE_OFF);
        compliance.unblockInvestor(BOB);
        vm.prank(COMPLIANCE_OFF);
        compliance.unfreezeAsset(ASSET_ID);
        assertTrue(registry.isAssetActive(ASSET_ID));
        assertFalse(compliance.isBlocked(BOB));

        // ── Step 8: Burn all of Alice's tokens (redemption) ───────────────────
        vm.prank(address(registry));
        rwaToken.burn(ALICE, aliceMint);
        assertEq(rwaToken.balanceOf(ALICE),        0);
        assertEq(registry.getMintedSupply(ASSET_ID), 0);

        // ── Step 9: Mark asset as REDEEMED (terminal state) ───────────────────
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.REDEEMED);
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.REDEEMED));
        assertFalse(registry.isAssetActive(ASSET_ID));

        // ── Step 10: Confirm no further mints possible ────────────────────────
        vm.prank(address(registry));
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, ASSET_ID));
        rwaToken.mint(ALICE, 1e18);

        console2.log("[IntegrationFullFlow] A-to-Z lifecycle PASSED");
    }

    //==========================================================================
    // §11 — JURISDICTION RULES
    //==========================================================================

    function test_JurisdictionRule_Restricted_AllowsSameIssuerCountry() public {
        // Create a restricted-jurisdiction asset (issuer = US, no open jurisdictions)
        bytes32 restrictedId = keccak256("RESTRICTED-US-ONLY");

        vm.prank(OWNER);
        RWAToken restrictedToken = new RWAToken("Restricted", "RST", restrictedId, address(registry), address(compliance));

        vm.prank(REGISTRAR);
        registry.registerAsset(restrictedId, address(restrictedToken), IAssetRegistry.AssetType.T_BILL, US_CODE, false, 0, 1_000_000e18, 0);

        // Whitelist two US investors
        address usInvestor1 = makeAddr("usInvestor1");
        address usInvestor2 = makeAddr("usInvestor2");

        vm.startPrank(REGISTRAR);
        registry.whitelistInvestor(restrictedId, usInvestor1, US_CODE, false);
        registry.whitelistInvestor(restrictedId, usInvestor2, US_CODE, false);
        vm.stopPrank();

        // canTransfer should be true between US investors (same jurisdiction)
        assertTrue(compliance.canTransfer(restrictedId, usInvestor1, usInvestor2));
    }

    function test_CanTransfer_ReturnsFalse_WhenAssetInactive() public {
        _whitelistAlice();
        _whitelistBob();

        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_ID, IAssetRegistry.AssetStatus.PAUSED);

        assertFalse(compliance.canTransfer(ASSET_ID, ALICE, BOB));
    }
}