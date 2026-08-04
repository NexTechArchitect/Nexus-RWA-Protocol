// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ComplianceEngine } from "../../src/core/ComplianceEngine.sol";
import { AssetRegistry } from "../../src/core/AssetRegistry.sol";
import { IComplianceEngine } from "../../src/interfaces/IComplianceEngine.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";
import { JurisdictionLib } from "../../src/libraries/JurisdictionLib.sol";
import { IRWAToken } from "../../src/interfaces/IRWAToken.sol";

// Mock Token strictly for Forced Transfer Verification
contract MockTokenForCompliance {
    bytes32 public immutable assetId;
    mapping(address => uint256) public balances;
    
    constructor(bytes32 _assetId) {
        assetId = _assetId;
    }
    
    function forcedTransfer(address from, address to, uint256 amount) external {
        balances[from] -= amount;
        balances[to] += amount;
    }

    function mintMock(address to, uint256 amount) external {
        balances[to] += amount;
    }
}

contract ComplianceEngineTest is Test {
    ComplianceEngine public engine;
    AssetRegistry public registry;
    MockTokenForCompliance public mockToken;

    address public owner = address(0x111);
    address public officer = address(0x222);
    address public registrar = address(0x333);
    
    address public alice = address(0xAAA);
    address public bob = address(0xBBB);

    bytes32 public constant ASSET_ID = keccak256("CORP_BOND_01");
    uint16 public constant USA_CODE = 840;
    uint16 public constant INDIA_CODE = 356;
    uint16 public constant IRAN_CODE = 364; // Sanctioned

    function setUp() public {
        vm.warp(1000000);

        mockToken = new MockTokenForCompliance(ASSET_ID);

        vm.startPrank(owner);
        // We use the real AssetRegistry to test the deep JurisdictionLib integration
        registry = new AssetRegistry(registrar, address(this)); 
        engine = new ComplianceEngine(address(registry), officer);
        
        // Fix circular dependency for freezing tests
        registry.setComplianceEngine(address(engine));
        vm.stopPrank();

        // Register Asset & Whitelist Alice and Bob
        vm.startPrank(registrar);
        registry.registerAsset(
            ASSET_ID, address(mockToken), IAssetRegistry.AssetType.CORPORATE_BOND, 
            USA_CODE, true, 1, 1_000_000 * 1e18, 0
        );

        registry.whitelistInvestor(ASSET_ID, alice, USA_CODE, true); // Alice is USA & Accredited
        registry.whitelistInvestor(ASSET_ID, bob, INDIA_CODE, true); // Bob is IND & Accredited
        vm.stopPrank();
    }

    // ================================================================
    // TRANSFER COMPLIANCE TESTS
    // ================================================================

    function test_EnforceTransfer_Success() public view {
        // Both are active, whitelisted, accredited, not sanctioned, and asset is ACTIVE.
        engine.enforceTransferCompliance(ASSET_ID, alice, bob); // Should not revert
        assertTrue(engine.canTransfer(ASSET_ID, alice, bob));
    }

    function test_EnforceTransfer_RevertSelfTransfer() public {
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.SelfTransfer.selector, alice));
        engine.enforceTransferCompliance(ASSET_ID, alice, alice);

        assertFalse(engine.canTransfer(ASSET_ID, alice, alice));
    }

    function test_EnforceTransfer_RevertBlockedInvestor() public {
        vm.prank(officer);
        engine.blockInvestor(bob);

        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.BlockedInvestor.selector, bob));
        engine.enforceTransferCompliance(ASSET_ID, alice, bob);
        
        assertFalse(engine.canTransfer(ASSET_ID, alice, bob));
    }

    function test_EnforceTransfer_RevertKYCExpired() public {
        // Warp past the KYC window (365 days)
        vm.warp(block.timestamp + 366 days);

        vm.expectRevert(abi.encodeWithSelector(
            JurisdictionLib.KYCExpired.selector, 
            alice, 
            registry.getInvestorData(alice).kycExpiry
        ));
        engine.enforceTransferCompliance(ASSET_ID, alice, bob);
        assertFalse(engine.canTransfer(ASSET_ID, alice, bob));
    }

    function test_EnforceTransfer_RevertNotWhitelisted() public {
        address charlie = address(0xCCC); // Not whitelisted

        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.TransferNotCompliant.selector, alice, charlie, ASSET_ID));
        engine.enforceTransferCompliance(ASSET_ID, alice, charlie);
        assertFalse(engine.canTransfer(ASSET_ID, alice, charlie));
    }

    function test_EnforceTransfer_RevertNotAccredited() public {
        address retailUser = address(0xDDD);
        
        // Whitelist retailUser with isAccredited = false
        vm.prank(registrar);
        registry.whitelistInvestor(ASSET_ID, retailUser, USA_CODE, false);

        // Target asset requires minAccreditationLevel = 1.
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.NotAccreditedInvestor.selector, retailUser));
        engine.enforceTransferCompliance(ASSET_ID, alice, retailUser);
        assertFalse(engine.canTransfer(ASSET_ID, alice, retailUser));
    }

    function test_EnforceTransfer_RevertJurisdictionPairDisallowed() public {
        // 1. Change rule so `allowAllJurisdictions` is FALSE
        vm.prank(registrar);
        registry.updateJurisdictionRule(ASSET_ID, USA_CODE, false, 1);
        JurisdictionLib.InvestorData memory invalidData = JurisdictionLib.InvestorData({
            countryCode: 1000, // Invalid bounds (> 999)
            isAccredited: true,
            isKYCVerified: true,
            kycExpiry: uint40(block.timestamp + 365 days),
            registeredAt: uint40(block.timestamp)
        });

        // Intercept the call to the registry just for Bob's data
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(registry.getInvestorData.selector, bob),
            abi.encode(invalidData)
        );

        // 3. Now the transfer will reach the inner JurisdictionLib block and fail exactly as expected!
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.JurisdictionNotAllowed.selector, USA_CODE, 1000));
        engine.enforceTransferCompliance(ASSET_ID, alice, bob);
    }
    // ================================================================
    // BLOCK / UNBLOCK INVESTOR TESTS
    // ================================================================

    function test_BlockUnblock_Success() public {
        vm.startPrank(officer);
        
        engine.blockInvestor(alice);
        assertTrue(engine.isBlocked(alice));

        engine.unblockInvestor(alice);
        assertFalse(engine.isBlocked(alice));

        vm.stopPrank();
    }

    function test_Block_RevertsIfAlreadyBlocked() public {
        vm.startPrank(officer);
        engine.blockInvestor(alice);

        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.InvestorAlreadyBlocked.selector, alice));
        engine.blockInvestor(alice);
        vm.stopPrank();
    }

    function test_Block_RevertsIfNotOfficer() public {
        vm.prank(alice); // Random user
        vm.expectRevert(IComplianceEngine.OnlyComplianceOfficer.selector);
        engine.blockInvestor(bob);
    }

    // ================================================================
    // ASSET FREEZE CONTROL TESTS
    // ================================================================

    function test_FreezeUnfreezeAsset_Success() public {
        vm.startPrank(officer);
        
        engine.freezeAsset(ASSET_ID);
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.FROZEN));

        engine.unfreezeAsset(ASSET_ID);
        info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.ACTIVE));

        vm.stopPrank();
    }

    // ================================================================
    // FORCED TRANSFER (LEGAL CLAWBACK) TESTS
    // ================================================================

    function test_ExecuteForcedTransfer_Success() public {
        uint256 seizeAmount = 1000 * 1e18;
        mockToken.mintMock(alice, seizeAmount);

        vm.prank(officer);
        engine.executeForcedTransfer(ASSET_ID, address(mockToken), alice, bob, seizeAmount);

        assertEq(mockToken.balances(alice), 0);
        assertEq(mockToken.balances(bob), seizeAmount);
    }

    function test_ExecuteForcedTransfer_RevertTokenMismatch() public {
        // Deploy a new token bound to a FAKE asset ID
        MockTokenForCompliance maliciousToken = new MockTokenForCompliance(keccak256("FAKE_ASSET"));
        
        vm.prank(officer);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.AssetNotRegistered.selector, ASSET_ID));
        // Calling it with the real ASSET_ID, but the token itself reports FAKE_ASSET!
        engine.executeForcedTransfer(ASSET_ID, address(maliciousToken), alice, bob, 100);
    }
}