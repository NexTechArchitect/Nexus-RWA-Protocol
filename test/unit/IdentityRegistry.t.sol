// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IdentityRegistry } from "../../src/core/IdentityRegistry.sol";
import { IIdentityRegistry } from "../../src/interfaces/IIdentityRegistry.sol";
import { JurisdictionLib } from "../../src/libraries/JurisdictionLib.sol";

contract IdentityRegistryTest is Test {
    IdentityRegistry public registry;

    address public owner = address(0x111);
    address public verifier = address(0x222);
    address public investor = address(0x333);
    
    bytes32 public constant MOCK_HASH = keccak256("OFF_CHAIN_DATA_COMMITMENT");
    uint16 public constant USA_CODE = 840;
    uint16 public constant IRAN_CODE = 364; // Sanctioned
    uint16 public constant INVALID_CODE = 1000; // > 999

    function setUp() public {
        vm.prank(owner);
        registry = new IdentityRegistry(verifier);
    }

    // ================================================================
    // CONSTRUCTOR & ADMIN TESTS
    // ================================================================

    function test_Constructor_RevertZeroAddress() public {
        vm.expectRevert(IIdentityRegistry.ZeroAddress.selector);
        new IdentityRegistry(address(0));
    }

    function test_SetVerifier_Success() public {
        vm.prank(owner);
        registry.setVerifier(address(0x444));
        assertEq(registry.getVerifier(), address(0x444));
    }

    // ================================================================
    // REGISTRATION TESTS
    // ================================================================

    function test_RegisterIdentity_Success() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.prank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);

        IIdentityRegistry.Identity memory id = registry.getIdentity(investor);
        assertEq(id.wallet, investor);
        assertEq(id.countryCode, USA_CODE);
        assertEq(uint8(id.tier), uint8(IIdentityRegistry.VerificationTier.BASIC));
        assertEq(id.kycExpiry, expiry);
        assertTrue(id.isActive);
        assertFalse(id.isAccredited);
        assertEq(id.identityHash, MOCK_HASH);
        
        assertTrue(registry.isRegistered(investor));
    }

    function test_RegisterIdentity_RevertSanctioned() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.prank(verifier);
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.SanctionedJurisdiction.selector, IRAN_CODE));
        registry.registerIdentity(investor, IRAN_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);
    }

    function test_RegisterIdentity_RevertInvalidInputs() public {
        uint40 pastExpiry = uint40(block.timestamp - 1);
        uint40 validExpiry = uint40(block.timestamp + 100);

        vm.startPrank(verifier);
        
        // Zero Address
        vm.expectRevert(IIdentityRegistry.ZeroAddress.selector);
        registry.registerIdentity(address(0), USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, validExpiry, MOCK_HASH);
        
        // Zero Hash
        vm.expectRevert(IIdentityRegistry.ZeroHash.selector);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, validExpiry, bytes32(0));

        // Invalid Tier (NONE)
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidTier.selector, IIdentityRegistry.VerificationTier.NONE));
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.NONE, false, validExpiry, MOCK_HASH);

        // Invalid Expiry (Past)
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.InvalidKYCExpiry.selector, pastExpiry));
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, pastExpiry, MOCK_HASH);
        
        vm.stopPrank();
    }

    function test_RegisterIdentity_RevertDuplicate() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);
        
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.IdentityAlreadyRegistered.selector, investor));
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.KYC, true, expiry, MOCK_HASH);
        vm.stopPrank();
    }

    // ================================================================
    // TIER UPGRADE TESTS
    // ================================================================

    function test_UpgradeTier_SuccessAndAutoAccredits() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);
        
        // Upgrade to ACCREDITED (should automatically flip isAccredited to true)
        registry.upgradeTier(investor, IIdentityRegistry.VerificationTier.ACCREDITED);
        vm.stopPrank();

        IIdentityRegistry.Identity memory id = registry.getIdentity(investor);
        assertEq(uint8(id.tier), uint8(IIdentityRegistry.VerificationTier.ACCREDITED));
        assertTrue(id.isAccredited); // Strict check for correct logic mapping
    }

    function test_UpgradeTier_RevertDowngrade() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.KYC, false, expiry, MOCK_HASH);
        
        vm.expectRevert(abi.encodeWithSelector(
            IIdentityRegistry.TierDowngradeNotAllowed.selector, 
            IIdentityRegistry.VerificationTier.KYC, 
            IIdentityRegistry.VerificationTier.BASIC
        ));
        registry.upgradeTier(investor, IIdentityRegistry.VerificationTier.BASIC);
        vm.stopPrank();
    }

    // ================================================================
    // MAINTENANCE (KYC & COUNTRY) TESTS
    // ================================================================

    function test_RenewKYC_Success() public {
        uint40 expiry1 = uint40(block.timestamp + 10 days);
        uint40 expiry2 = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry1, MOCK_HASH);
        registry.renewKYC(investor, expiry2);
        vm.stopPrank();

        assertEq(registry.getIdentity(investor).kycExpiry, expiry2);
    }

    function test_UpdateCountryCode_RevertsSanctioned() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);
        
        // Try to update to sanctioned country
        vm.expectRevert(abi.encodeWithSelector(JurisdictionLib.SanctionedJurisdiction.selector, IRAN_CODE));
        registry.updateCountryCode(investor, IRAN_CODE);
        vm.stopPrank();
    }

    // ================================================================
    // DEACTIVATE / REACTIVATE TESTS
    // ================================================================

    function test_DeactivateAndReactivate_Success() public {
        uint40 expiry = uint40(block.timestamp + 365 days);
        
        vm.startPrank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);
        
        registry.deactivateIdentity(investor);
        assertFalse(registry.getIdentity(investor).isActive);

        registry.reactivateIdentity(investor);
        assertTrue(registry.getIdentity(investor).isActive);
        vm.stopPrank();
    }

    // ================================================================
    // COMPLIANCE ENGINE VIEWS (STRICT CHECKS)
    // ================================================================

    function test_EnforceCompliance_RevertsProperly() public {
        uint40 expiry = uint40(block.timestamp + 10 days);
        
        // Check 1: Unregistered
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.IdentityNotRegistered.selector, investor));
        registry.enforceIdentityCompliance(investor);

        // Register
        vm.prank(verifier);
        registry.registerIdentity(investor, USA_CODE, IIdentityRegistry.VerificationTier.BASIC, false, expiry, MOCK_HASH);

        // Check 2: Expired KYC
        vm.warp(block.timestamp + 11 days); // Fast forward past expiry
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.IdentityExpired.selector, investor, expiry));
        registry.enforceIdentityCompliance(investor);

        // Check 3: IsCompliant View returns false
        assertFalse(registry.isIdentityCompliant(investor));
    }
}