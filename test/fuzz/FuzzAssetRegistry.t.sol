// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { AssetRegistry }    from "../../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../../src/core/ComplianceEngine.sol";
import { RWAToken }         from "../../src/core/RWAToken.sol";
import { IAssetRegistry }   from "../../src/interfaces/IAssetRegistry.sol";
import { JurisdictionLib }  from "../../src/libraries/JurisdictionLib.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// FuzzAssetRegistry
//
// Property-based tests for AssetRegistry. Every test uses Foundry's native fuzz
// engine (forge-std bound()) and real deployed contracts — no mocks.
//
// Properties tested:
//   P1  Supply accounting is always consistent (mintedSupply never exceeds cap)
//   P2  Whitelist flag is always boolean-stable (no ghost entries)
//   P3  KYC expiry is always in the future after a successful whitelist
//   P4  recordMint / recordBurn are strictly inverse operations
//   P5  Status transitions respect terminal-state invariant (REDEEMED is final)
//   P6  updateSupplyCap(newCap < mintedSupply) always reverts
//   P7  Sanctioned / out-of-range country codes always revert
//   P8  Any non-registrar caller always reverts on privileged functions
//   P9  Multiple investors across multiple assets never cross-contaminate whitelist
//   P10 isAssetActive() returns false whenever status != ACTIVE or asset matured
// ═══════════════════════════════════════════════════════════════════════════════
contract FuzzAssetRegistry is Test {

    //──────────────────────────────────────────────────────────────────────────
    // Actors & contracts
    //──────────────────────────────────────────────────────────────────────────
    address internal OWNER      = makeAddr("owner");
    address internal REGISTRAR  = makeAddr("registrar");
    address internal COMPLIANCE = makeAddr("complianceEngine");
    address internal RANDO      = makeAddr("rando");

    AssetRegistry    internal registry;
    ComplianceEngine internal compliance;
    RWAToken         internal token;

    bytes32 internal constant ASSET_A = keccak256("ASSET_A");
    bytes32 internal constant ASSET_B = keccak256("ASSET_B");

    uint16 internal constant VALID_CODE   = 840;  // USA
    uint16 internal constant IRAN_CODE    = 364;  // sanctioned
    uint16 internal constant RUSSIA_CODE  = 643;  // sanctioned

    uint256 internal constant BASE_CAP = 10_000_000e18;

    //──────────────────────────────────────────────────────────────────────────
    // Setup
    //──────────────────────────────────────────────────────────────────────────
    function setUp() public {
        vm.startPrank(OWNER);
        registry   = new AssetRegistry(REGISTRAR, COMPLIANCE);
        compliance = new ComplianceEngine(address(registry), REGISTRAR);
        token      = new RWAToken("Nexus T-Bill", "nTBILL", ASSET_A, address(registry), COMPLIANCE);
        vm.stopPrank();

        // Register ASSET_A with a real token address
        vm.prank(REGISTRAR);
        registry.registerAsset(
            ASSET_A,
            address(token),
            IAssetRegistry.AssetType.T_BILL,
            VALID_CODE,
            true,
            0,
            BASE_CAP,
            0
        );
    }

    //──────────────────────────────────────────────────────────────────────────
    // Helpers
    //──────────────────────────────────────────────────────────────────────────

    /// @dev Returns a safe (non-sanctioned, in-range) country code.
    function _safeCode(uint16 raw) internal pure returns (uint16) {
        // Collapse into 1..999, then skip sanctioned codes
        uint16 code = uint16(bound(raw, 1, 999));
        if (code == 364 || code == 408 || code == 643 || code == 760 || code == 192 || code == 862) {
            code = 700; // Singapore-adjacent safe code
        }
        return code;
    }

    /// @dev Returns a valid future maturity (or 0 for perpetual).
    function _safeMaturity(uint40 raw) internal view returns (uint40) {
        if (raw == 0) return 0;
        return uint40(bound(raw, block.timestamp + 1, block.timestamp + 30 * 365 days));
    }

    /// @dev Prank as the token address to call recordMint (only token can call this).
    function _recordMintAsToken(bytes32 assetId, uint256 amount) internal {
        vm.prank(address(token));
        registry.recordMint(assetId, amount);
    }

    function _recordBurnAsToken(bytes32 assetId, uint256 amount) internal {
        vm.prank(address(token));
        registry.recordBurn(assetId, amount);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P1 — Supply cap is never breached via recordMint
    //══════════════════════════════════════════════════════════════════════════

    /// @notice Minting any amount ≤ remaining cap must succeed and never push
    ///         mintedSupply past totalSupplyCap.
    function testFuzz_P1_MintNeverExceedsCap(uint256 amount) public {
        // bound to [1, BASE_CAP] — guaranteed not to exceed cap
        amount = bound(amount, 1, BASE_CAP);

        _recordMintAsToken(ASSET_A, amount);

        uint256 minted = registry.getMintedSupply(ASSET_A);
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_A);

        assertLe(minted, info.totalSupplyCap, "P1: mintedSupply > totalSupplyCap");
        assertEq(minted, amount,               "P1: minted supply mismatch");
    }

    /// @notice Two sequential mints that together exceed the cap — second must revert.
    function testFuzz_P1_SequentialMintExceedCap_Reverts(uint256 firstMint) public {
        firstMint = bound(firstMint, 1, BASE_CAP - 1);
        uint256 secondMint = BASE_CAP - firstMint + 1; // guaranteed to push over

        _recordMintAsToken(ASSET_A, firstMint);

        vm.prank(address(token));
        vm.expectRevert(); // SupplyCapExceeded
        registry.recordMint(ASSET_A, secondMint);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P2 — Whitelist is strictly boolean and idempotency-safe
    //══════════════════════════════════════════════════════════════════════════

    /// @notice After a successful whitelist, isWhitelisted is always true.
    function testFuzz_P2_WhitelistSetsTrue(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = _safeCode(rawCode);

        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, code, true);

        assertTrue(
            registry.isWhitelisted(ASSET_A, investor),
            "P2: whitelist should be true after whitelistInvestor"
        );
    }

    /// @notice After removeInvestor, isWhitelisted is always false.
    function testFuzz_P2_RemoveInvestorSetsFalse(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = _safeCode(rawCode);

        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, code, false);

        vm.prank(REGISTRAR);
        registry.removeInvestor(ASSET_A, investor);

        assertFalse(
            registry.isWhitelisted(ASSET_A, investor),
            "P2: whitelist should be false after removeInvestor"
        );
    }

    /// @notice Double-whitelisting always reverts.
    function testFuzz_P2_DoubleWhitelist_Reverts(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = _safeCode(rawCode);

        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, code, false);

        vm.prank(REGISTRAR);
        vm.expectRevert(
            abi.encodeWithSelector(IAssetRegistry.InvestorAlreadyWhitelisted.selector, ASSET_A, investor)
        );
        registry.whitelistInvestor(ASSET_A, investor, code, false);
    }

    /// @notice Removing a non-whitelisted investor always reverts.
    function testFuzz_P2_RemoveNonWhitelisted_Reverts(address investor) public {
        vm.assume(investor != address(0));
        vm.assume(!registry.isWhitelisted(ASSET_A, investor));

        vm.prank(REGISTRAR);
        vm.expectRevert(
            abi.encodeWithSelector(IAssetRegistry.InvestorNotWhitelisted.selector, ASSET_A, investor)
        );
        registry.removeInvestor(ASSET_A, investor);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P3 — KYC expiry is always > block.timestamp immediately after whitelist
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P3_KYCExpiryAlwaysFuture(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = _safeCode(rawCode);

        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, code, true);

        JurisdictionLib.InvestorData memory data = registry.getInvestorData(investor);

        assertGt(
            data.kycExpiry,
            uint40(block.timestamp),
            "P3: kycExpiry must be strictly after block.timestamp"
        );
        assertTrue(data.isKYCVerified, "P3: isKYCVerified must be true after whitelist");
    }

    //══════════════════════════════════════════════════════════════════════════
    // P4 — recordMint / recordBurn are strictly inverse
    //══════════════════════════════════════════════════════════════════════════

    /// @notice Minting then burning the same amount returns supply to zero.
    function testFuzz_P4_MintThenBurnIsZero(uint256 amount) public {
        amount = bound(amount, 1, BASE_CAP);

        _recordMintAsToken(ASSET_A, amount);
        assertEq(registry.getMintedSupply(ASSET_A), amount, "P4: supply after mint wrong");

        _recordBurnAsToken(ASSET_A, amount);
        assertEq(registry.getMintedSupply(ASSET_A), 0, "P4: supply after full burn should be zero");
    }

    /// @notice Partial burn reduces supply by exactly the burned amount.
    function testFuzz_P4_PartialBurnReducesExactly(uint256 mintAmt, uint256 burnAmt) public {
        mintAmt = bound(mintAmt, 2, BASE_CAP);
        burnAmt = bound(burnAmt, 1, mintAmt);

        _recordMintAsToken(ASSET_A, mintAmt);
        _recordBurnAsToken(ASSET_A, burnAmt);

        assertEq(
            registry.getMintedSupply(ASSET_A),
            mintAmt - burnAmt,
            "P4: mintedSupply after partial burn incorrect"
        );
    }

    //══════════════════════════════════════════════════════════════════════════
    // P5 — REDEEMED is a terminal state — no further status changes allowed
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P5_RedeemedIsTerminal(uint8 newStatusRaw) public {
        // Mark ASSET_A as REDEEMED
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_A, IAssetRegistry.AssetStatus.REDEEMED);

        // Any subsequent updateAssetStatus call must revert
        // Avoid NONE (invalid) and REDEEMED itself — both revert for different reasons
        IAssetRegistry.AssetStatus newStatus = IAssetRegistry.AssetStatus(
            bound(newStatusRaw, 1, 4) // 1=ACTIVE, 2=PAUSED, 3=FROZEN, 4=REDEEMED
        );

        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetRedeemed.selector, ASSET_A));
        registry.updateAssetStatus(ASSET_A, newStatus);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P6 — updateSupplyCap(newCap < mintedSupply) always reverts
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P6_CapBelowMintedAlwaysReverts(uint256 mintAmt) public {
        mintAmt = bound(mintAmt, 2, BASE_CAP);

        _recordMintAsToken(ASSET_A, mintAmt);

        // Try to set cap to anything strictly below mintedSupply
        uint256 badCap = bound(mintAmt, 1, mintAmt - 1);

        vm.prank(REGISTRAR);
        vm.expectRevert(
            abi.encodeWithSelector(IAssetRegistry.NewCapBelowMinted.selector, ASSET_A, mintAmt, badCap)
        );
        registry.updateSupplyCap(ASSET_A, badCap);
    }

    /// @notice Increasing the cap always succeeds and is reflected correctly.
    function testFuzz_P6_IncreasedCapAccepted(uint256 extraCap) public {
        extraCap = bound(extraCap, 1, type(uint128).max);
        uint256 newCap = BASE_CAP + extraCap;

        vm.prank(REGISTRAR);
        registry.updateSupplyCap(ASSET_A, newCap);

        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_A);
        assertEq(info.totalSupplyCap, newCap, "P6: new cap not reflected");
    }

    //══════════════════════════════════════════════════════════════════════════
    // P7 — Sanctioned & out-of-range country codes always revert
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P7_SanctionedCodeReverts_OnWhitelist(address investor) public {
        vm.assume(investor != address(0));

        uint16[6] memory sanctioned = [uint16(364), 408, 643, 760, 192, 862];
        for (uint256 i = 0; i < sanctioned.length; i++) {
            vm.prank(REGISTRAR);
            vm.expectRevert(); // SanctionedJurisdiction
            registry.whitelistInvestor(ASSET_A, investor, sanctioned[i], false);
        }
    }

    function testFuzz_P7_ZeroCodeReverts(address investor) public {
        vm.assume(investor != address(0));

        vm.prank(REGISTRAR);
        vm.expectRevert(); // InvalidCountryCode(0)
        registry.whitelistInvestor(ASSET_A, investor, 0, false);
    }

    function testFuzz_P7_OverMaxCodeReverts(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = uint16(bound(rawCode, 1000, type(uint16).max));

        vm.prank(REGISTRAR);
        vm.expectRevert(); // InvalidCountryCode(code)
        registry.whitelistInvestor(ASSET_A, investor, code, false);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P8 — Non-registrar callers always revert on privileged functions
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P8_RandomCallerCannotWhitelist(address caller, address investor) public {
        vm.assume(caller != REGISTRAR && caller != OWNER);
        vm.assume(investor != address(0));

        vm.prank(caller);
        vm.expectRevert(IAssetRegistry.OnlyRegistrar.selector);
        registry.whitelistInvestor(ASSET_A, investor, VALID_CODE, false);
    }

    function testFuzz_P8_RandomCallerCannotRegisterAsset(address caller) public {
        vm.assume(caller != REGISTRAR && caller != OWNER);

        bytes32 newId  = keccak256(abi.encodePacked(caller, block.timestamp));
        address newTok = makeAddr("newTok");

        vm.prank(caller);
        vm.expectRevert(IAssetRegistry.OnlyRegistrar.selector);
        registry.registerAsset(newId, newTok, IAssetRegistry.AssetType.T_BILL, VALID_CODE, true, 0, 1e18, 0);
    }

    function testFuzz_P8_RandomCallerCannotUpdateStatus(address caller) public {
        vm.assume(caller != REGISTRAR && caller != OWNER);

        vm.prank(caller);
        vm.expectRevert(IAssetRegistry.OnlyRegistrar.selector);
        registry.updateAssetStatus(ASSET_A, IAssetRegistry.AssetStatus.PAUSED);
    }

    function testFuzz_P8_RandomCallerCannotUpdateCap(address caller, uint256 newCap) public {
        vm.assume(caller != REGISTRAR && caller != OWNER);
        newCap = bound(newCap, 1, type(uint128).max);

        vm.prank(caller);
        vm.expectRevert(IAssetRegistry.OnlyRegistrar.selector);
        registry.updateSupplyCap(ASSET_A, newCap);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P9 — Whitelist per-asset: Asset A whitelist never bleeds into Asset B
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P9_AssetWhitelistIsolation(address investor, uint16 rawCode) public {
        vm.assume(investor != address(0));
        uint16 code = _safeCode(rawCode);

        // Register a second token for ASSET_B
        vm.prank(OWNER);
        RWAToken tokenB = new RWAToken("B", "B", ASSET_B, address(registry), COMPLIANCE);

        vm.prank(REGISTRAR);
        registry.registerAsset(ASSET_B, address(tokenB), IAssetRegistry.AssetType.COMMODITY, VALID_CODE, true, 0, 1e18, 0);

        // Whitelist investor ONLY for ASSET_A
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, code, false);

        assertTrue(registry.isWhitelisted(ASSET_A, investor), "P9: should be whitelisted on A");
        assertFalse(registry.isWhitelisted(ASSET_B, investor), "P9: must NOT be whitelisted on B");
    }

    //══════════════════════════════════════════════════════════════════════════
    // P10 — isAssetActive() correctly reflects status and maturity
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P10_isAssetActive_FalseWhenPaused() public {
        vm.prank(REGISTRAR);
        registry.updateAssetStatus(ASSET_A, IAssetRegistry.AssetStatus.PAUSED);
        assertFalse(registry.isAssetActive(ASSET_A), "P10: PAUSED asset must not be active");
    }

    function testFuzz_P10_isAssetActive_FalseWhenFrozen() public {
        // Freeze through compliance engine (onlyCompliance)
        vm.prank(COMPLIANCE);
        registry.freezeAsset(ASSET_A);
        assertFalse(registry.isAssetActive(ASSET_A), "P10: FROZEN asset must not be active");
    }

    function testFuzz_P10_isAssetActive_FalseAfterMaturity(uint40 rawOffset) public {
        // Deploy a maturing asset
        bytes32 matId = keccak256("MAT");
        uint40 offset = uint40(bound(rawOffset, 1, 365 days));
        uint40 maturity = uint40(block.timestamp) + offset;

        vm.prank(OWNER);
        RWAToken matToken = new RWAToken("Mat", "MAT", matId, address(registry), COMPLIANCE);

        vm.prank(REGISTRAR);
        registry.registerAsset(matId, address(matToken), IAssetRegistry.AssetType.CORPORATE_BOND, VALID_CODE, true, 0, 1e18, maturity);

        // Warp past maturity
        vm.warp(block.timestamp + offset + 1);

        assertFalse(registry.isAssetActive(matId), "P10: past-maturity asset must not be active");
    }

    function testFuzz_P10_isAssetActive_TrueForActive() public view {
        assertTrue(registry.isAssetActive(ASSET_A), "P10: freshly-registered asset must be active");
    }

    //══════════════════════════════════════════════════════════════════════════
    // P11 — recordMint caller must be the registered token — any other reverts
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P11_RecordMintOnlyToken(address caller, uint256 amount) public {
        vm.assume(caller != address(token));
        amount = bound(amount, 1, BASE_CAP);

        vm.prank(caller);
        vm.expectRevert(); // TokenMismatch
        registry.recordMint(ASSET_A, amount);
    }

    function testFuzz_P11_RecordBurnOnlyToken(address caller, uint256 amount) public {
        vm.assume(caller != address(token));
        amount = bound(amount, 1, BASE_CAP);

        vm.prank(caller);
        vm.expectRevert(); // TokenMismatch
        registry.recordBurn(ASSET_A, amount);
    }

    //══════════════════════════════════════════════════════════════════════════
    // P12 — updateInvestorKYC expiry must always be in the future
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P12_KYCUpdatePastExpiry_Reverts(address investor, uint40 pastExpiry) public {
        vm.assume(investor != address(0));
        // Any expiry <= block.timestamp should revert
        pastExpiry = uint40(bound(pastExpiry, 0, block.timestamp));

        vm.prank(REGISTRAR);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.InvalidKYCExpiry.selector, pastExpiry));
        registry.updateInvestorKYC(investor, VALID_CODE, false, pastExpiry);
    }

    function testFuzz_P12_KYCUpdateFutureExpiry_Succeeds(address investor, uint40 futureExpiry) public {
        vm.assume(investor != address(0));
        futureExpiry = uint40(bound(futureExpiry, block.timestamp + 1, block.timestamp + 10 * 365 days));

        // Whitelist first so there's something to update
        vm.prank(REGISTRAR);
        registry.whitelistInvestor(ASSET_A, investor, VALID_CODE, true);

        vm.prank(REGISTRAR);
        registry.updateInvestorKYC(investor, VALID_CODE, true, futureExpiry);

        JurisdictionLib.InvestorData memory data = registry.getInvestorData(investor);
        assertEq(data.kycExpiry, futureExpiry, "P12: kycExpiry should match the set value");
    }

    //══════════════════════════════════════════════════════════════════════════
    // P13 — isMintAllowed is consistent with mintedSupply + amount vs. cap
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P13_IsMintAllowedConsistency(uint256 firstMint, uint256 queryAmt) public {
        firstMint = bound(firstMint, 0, BASE_CAP);
        queryAmt  = bound(queryAmt,  1, BASE_CAP * 2);

        // Only mint if firstMint > 0
        if (firstMint > 0) {
            _recordMintAsToken(ASSET_A, firstMint);
        }

        bool allowed = registry.isMintAllowed(ASSET_A, queryAmt);
        uint256 minted = registry.getMintedSupply(ASSET_A);

        if (minted + queryAmt <= BASE_CAP) {
            assertTrue(allowed,  "P13: should be allowed when within cap");
        } else {
            assertFalse(allowed, "P13: should not be allowed when exceeding cap");
        }
    }

    //══════════════════════════════════════════════════════════════════════════
    // P14 — Jurisdiction rule updates are atomically reflected
    //══════════════════════════════════════════════════════════════════════════

    function testFuzz_P14_JurisdictionRuleUpdate(
        uint16  rawCode,
        bool    allowAll,
        uint8   minLevel
    ) public {
        uint16 code = _safeCode(rawCode);
        minLevel    = uint8(bound(minLevel, 0, 3));

        vm.prank(REGISTRAR);
        registry.updateJurisdictionRule(ASSET_A, code, allowAll, minLevel);

        JurisdictionLib.AssetJurisdictionRule memory rule = registry.getJurisdictionRule(ASSET_A);
        assertEq(rule.issuerCountryCode,    code,     "P14: country code mismatch");
        assertEq(rule.allowAllJurisdictions, allowAll, "P14: allowAll mismatch");
        assertEq(rule.minAccreditationLevel, minLevel, "P14: minLevel mismatch");
    }
}
