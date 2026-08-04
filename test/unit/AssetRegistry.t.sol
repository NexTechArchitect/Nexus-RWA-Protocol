// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { AssetRegistry } from "../../src/core/AssetRegistry.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";
import { JurisdictionLib } from "../../src/libraries/JurisdictionLib.sol";

contract AssetRegistryTest is Test {
    AssetRegistry public registry;

    address public owner = address(0x111);
    address public registrar = address(0x222);
    address public compliance = address(0x333);
    address public mockToken = address(0x444);
    address public investor = address(0x555);

    bytes32 public constant ASSET_ID = keccak256("REAL_ESTATE_001");
    uint16 public constant USA_CODE = 840;
    uint16 public constant IRAN_CODE = 364; // Sanctioned
    uint16 public constant INVALID_CODE = 1000;

    function setUp() public {
        vm.warp(1000000); // Fixed timestamp for maturity and KYC tests
        
        vm.prank(owner);
        registry = new AssetRegistry(registrar, compliance);
    }

    // ================================================================
    // CONSTRUCTOR & ADMIN TESTS
    // ================================================================

    function test_Constructor_RevertZeroAddresses() public {
        vm.expectRevert(IAssetRegistry.ZeroAddress.selector);
        new AssetRegistry(address(0), compliance);

        vm.expectRevert(IAssetRegistry.ZeroAddress.selector);
        new AssetRegistry(registrar, address(0));
    }

    function test_Setters_Success() public {
        vm.startPrank(owner);
        registry.setRegistrar(address(0x999));
        assertEq(registry.getRegistrar(), address(0x999));

        registry.setComplianceEngine(address(0x888));
        assertEq(registry.getComplianceEngine(), address(0x888));
        vm.stopPrank();
    }

    // ================================================================
    // ASSET REGISTRATION TESTS
    // ================================================================

    function test_RegisterAsset_Success() public {
        uint40 maturity = uint40(block.timestamp + 365 days);
        
        vm.prank(registrar);
        registry.registerAsset(
            ASSET_ID, mockToken, IAssetRegistry.AssetType.REAL_ESTATE, 
            USA_CODE, true, 1, 1000 * 1e18, maturity
        );

        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(info.token, mockToken);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.ACTIVE));
        assertEq(info.totalSupplyCap, 1000 * 1e18);
        assertEq(info.maturityDate, maturity);
    }

    function test_RegisterAsset_RevertsInvalidInputs() public {
        vm.startPrank(registrar);
        
        // Zero Token
        vm.expectRevert(IAssetRegistry.ZeroAddress.selector);
        registry.registerAsset(ASSET_ID, address(0), IAssetRegistry.AssetType.REAL_ESTATE, USA_CODE, true, 1, 1000 * 1e18, 0);

        // Zero Cap
        vm.expectRevert(IAssetRegistry.ZeroValue.selector);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.REAL_ESTATE, USA_CODE, true, 1, 0, 0);

        // Invalid Type
        vm.expectRevert(IAssetRegistry.InvalidAssetType.selector);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.NONE, USA_CODE, true, 1, 1000 * 1e18, 0);

        // Sanctioned Country
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.SanctionedJurisdiction.selector, IRAN_CODE));
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.REAL_ESTATE, IRAN_CODE, true, 1, 1000 * 1e18, 0);

        // Past Maturity
        uint40 pastMaturity = uint40(block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.InvalidMaturityDate.selector, pastMaturity));
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.REAL_ESTATE, USA_CODE, true, 1, 1000 * 1e18, pastMaturity);

        vm.stopPrank();
    }

    function test_RegisterAsset_RevertsDuplicate() public {
        vm.startPrank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 100 * 1e18, 0);
        
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetAlreadyRegistered.selector, ASSET_ID));
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 100 * 1e18, 0);
        vm.stopPrank();
    }

    // ================================================================
    // MINT & BURN SUPPLY CAP TESTS
    // ================================================================

    function test_RecordMint_Success() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        // Caller MUST be the mockToken itself
        vm.prank(mockToken);
        registry.recordMint(ASSET_ID, 500 * 1e18);

        assertEq(registry.getMintedSupply(ASSET_ID), 500 * 1e18);
    }

    function test_RecordMint_RevertsCapExceeded() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.prank(mockToken);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.SupplyCapExceeded.selector, ASSET_ID, 1000 * 1e18, 1001 * 1e18));
        registry.recordMint(ASSET_ID, 1001 * 1e18);
    }

    function test_RecordMint_RevertsTokenMismatch() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        // Caller is NOT the mockToken
        address hacker = address(0xBad);
        vm.prank(hacker);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.TokenMismatch.selector, ASSET_ID, mockToken, hacker));
        registry.recordMint(ASSET_ID, 500 * 1e18);
    }

    function test_RecordMint_RevertsMatured() public {
        uint40 maturity = uint40(block.timestamp + 100);
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, maturity);

        // Fast forward past maturity
        vm.warp(block.timestamp + 101);

        vm.prank(mockToken);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.AssetMatured.selector, ASSET_ID, maturity));
        registry.recordMint(ASSET_ID, 100 * 1e18);
    }

    function test_UpdateSupplyCap_RevertsBelowMinted() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.prank(mockToken);
        registry.recordMint(ASSET_ID, 500 * 1e18);

        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(IAssetRegistry.NewCapBelowMinted.selector, ASSET_ID, 500 * 1e18, 400 * 1e18));
        registry.updateSupplyCap(ASSET_ID, 400 * 1e18);
    }

    // ================================================================
    // INVESTOR WHITELIST & KYC TESTS
    // ================================================================

    function test_WhitelistInvestor_Success() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.prank(registrar);
        registry.whitelistInvestor(ASSET_ID, investor, USA_CODE, true);

        assertTrue(registry.isWhitelisted(ASSET_ID, investor));
        JurisdictionLib.InvestorData memory data = registry.getInvestorData(investor);
        assertEq(data.countryCode, USA_CODE);
        assertTrue(data.isAccredited);
        assertTrue(data.isKYCVerified);
    }

    function test_WhitelistInvestor_RevertSanctioned() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.SanctionedJurisdiction.selector, IRAN_CODE));
        registry.whitelistInvestor(ASSET_ID, investor, IRAN_CODE, true);
    }

    function test_UpdateInvestorKYC_Success() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.startPrank(registrar);
        registry.whitelistInvestor(ASSET_ID, investor, USA_CODE, true);
        
        uint40 newExpiry = uint40(block.timestamp + 500 days);
        registry.updateInvestorKYC(investor, 826, false, newExpiry); // 826 = UK
        vm.stopPrank();

        JurisdictionLib.InvestorData memory data = registry.getInvestorData(investor);
        assertEq(data.countryCode, 826);
        assertFalse(data.isAccredited);
        assertEq(data.kycExpiry, newExpiry);
    }

    // ================================================================
    // COMPLIANCE ACTIONS (FREEZE / UNFREEZE)
    // ================================================================

    function test_FreezeAndUnfreeze_Success() public {
        vm.prank(registrar);
        registry.registerAsset(ASSET_ID, mockToken, IAssetRegistry.AssetType.T_BILL, USA_CODE, true, 1, 1000 * 1e18, 0);

        vm.prank(compliance);
        registry.freezeAsset(ASSET_ID);
        
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.FROZEN));

        vm.prank(compliance);
        registry.unfreezeAsset(ASSET_ID);
        
        info = registry.getAssetInfo(ASSET_ID);
        assertEq(uint8(info.status), uint8(IAssetRegistry.AssetStatus.ACTIVE));
    }
}