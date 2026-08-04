// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { RWAToken } from "../../src/core/RWAToken.sol";
import { IRWAToken } from "../../src/interfaces/IRWAToken.sol";
import { IAssetRegistry } from "../../src/interfaces/IAssetRegistry.sol";

// ====================================================================
// MOCK ASSET REGISTRY FOR RWA TOKEN TESTS
// ====================================================================
contract MockAssetRegistryForToken {
    bool public assetActive = true;
    bool public mintAllowed = true;
    mapping(address => bool) public whitelisted;

    function setAssetActive(bool _active) external { assetActive = _active; }
    function setMintAllowed(bool _allowed) external { mintAllowed = _allowed; }
    function setWhitelisted(address user, bool _whitelisted) external { whitelisted[user] = _whitelisted; }

    function isAssetActive(bytes32) external view returns (bool) { return assetActive; }
    function isWhitelisted(bytes32, address account) external view returns (bool) { return whitelisted[account]; }
    function isMintAllowed(bytes32, uint256) external view returns (bool) { return mintAllowed; }
    
    function recordMint(bytes32, uint256) external {}
    function recordBurn(bytes32, uint256) external {}
}

// ====================================================================
// TEST SUITE
// ====================================================================
contract RWATokenTest is Test {
    RWAToken public rwaToken;
    MockAssetRegistryForToken public mockRegistry;

    bytes32 public constant ASSET_ID = keccak256("NEXUS_RWA_001");
    address public registryAddr;
    address public complianceAddr = address(0x111);
    address public alice = address(0x222);
    address public bob = address(0x333);

    function setUp() public {
        mockRegistry = new MockAssetRegistryForToken();
        registryAddr = address(mockRegistry);

        rwaToken = new RWAToken(
            "Nexus Real Estate",
            "NRE",
            ASSET_ID,
            registryAddr,
            complianceAddr
        );

        mockRegistry.setWhitelisted(alice, true);
        mockRegistry.setWhitelisted(bob, true);
    }

    // ================================================================
    // CONSTRUCTOR TESTS
    // ================================================================

    function test_Constructor_RevertsOnZeroAddresses() public {
        vm.expectRevert(IRWAToken.ZeroAddress.selector);
        new RWAToken("Fail", "FAIL", ASSET_ID, address(0), complianceAddr);

        vm.expectRevert(IRWAToken.ZeroAddress.selector);
        new RWAToken("Fail", "FAIL", ASSET_ID, registryAddr, address(0));

        vm.expectRevert(IRWAToken.ZeroAmount.selector);
        new RWAToken("Fail", "FAIL", bytes32(0), registryAddr, complianceAddr);
    }

    // ================================================================
    // MINT TESTS
    // ================================================================

    function test_Mint_Success() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);
        assertEq(rwaToken.balanceOf(alice), 1000 * 1e18);
    }

    function test_Mint_RevertsIfNotRegistry() public {
        vm.expectRevert(IRWAToken.CallerNotRegistry.selector);
        vm.prank(alice);
        rwaToken.mint(alice, 1000 * 1e18);
    }

    function test_Mint_RevertsIfAssetNotActive() public {
        mockRegistry.setAssetActive(false);
        vm.prank(registryAddr);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, ASSET_ID));
        rwaToken.mint(alice, 1000 * 1e18);
    }

    function test_Mint_RevertsIfNotWhitelisted() public {
        mockRegistry.setWhitelisted(alice, false);
        vm.prank(registryAddr);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, alice));
        rwaToken.mint(alice, 1000 * 1e18);
    }

    function test_Mint_RevertsIfCapExceeded() public {
        mockRegistry.setMintAllowed(false);
        vm.prank(registryAddr);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.MintCapExceeded.selector, ASSET_ID, 0, 1000 * 1e18));
        rwaToken.mint(alice, 1000 * 1e18);
    }

    // ================================================================
    // BURN TESTS
    // ================================================================

    function test_Burn_SuccessByRegistry() public {
        vm.startPrank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);
        rwaToken.burn(alice, 500 * 1e18);
        vm.stopPrank();
        assertEq(rwaToken.balanceOf(alice), 500 * 1e18);
    }

    function test_Burn_SuccessByCompliance() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        vm.prank(complianceAddr);
        rwaToken.burn(alice, 1000 * 1e18);
        assertEq(rwaToken.balanceOf(alice), 0);
    }

    function test_Burn_RevertsIfNotAuthorized() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        vm.expectRevert(IRWAToken.CallerNotRegistry.selector);
        vm.prank(alice);
        rwaToken.burn(alice, 500 * 1e18);
    }

    function test_Burn_RevertsExceedsBalance() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 100 * 1e18);

        vm.prank(complianceAddr);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.BurnExceedsBalance.selector, alice, 100 * 1e18, 500 * 1e18));
        rwaToken.burn(alice, 500 * 1e18);
    }

    // ================================================================
    // TRANSFER HOOK (P2P) TESTS
    // ================================================================

    function test_Transfer_Success() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        vm.prank(alice);
        rwaToken.transfer(bob, 400 * 1e18);
        assertEq(rwaToken.balanceOf(bob), 400 * 1e18);
    }

    function test_Transfer_RevertsSenderNotWhitelisted() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        mockRegistry.setWhitelisted(alice, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, alice));
        rwaToken.transfer(bob, 400 * 1e18);
    }

    function test_Transfer_RevertsReceiverNotWhitelisted() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        mockRegistry.setWhitelisted(bob, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.NotWhitelisted.selector, bob));
        rwaToken.transfer(bob, 400 * 1e18);
    }

    function test_Transfer_RevertsAssetNotActive() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        mockRegistry.setAssetActive(false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRWAToken.AssetNotActive.selector, ASSET_ID));
        rwaToken.transfer(bob, 400 * 1e18);
    }

    // ================================================================
    // FORCED TRANSFER TESTS
    // ================================================================

    function test_ForcedTransfer_SuccessBypassesWhitelist() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        // Revoke bob's whitelist status to prove forcedTransfer bypasses it
        mockRegistry.setWhitelisted(bob, false);

        vm.prank(complianceAddr);
        rwaToken.forcedTransfer(alice, bob, 1000 * 1e18);
        
        assertEq(rwaToken.balanceOf(bob), 1000 * 1e18);
        assertEq(rwaToken.balanceOf(alice), 0);
    }

    function test_ForcedTransfer_RevertsIfNotCompliance() public {
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18);

        vm.expectRevert(IRWAToken.CallerNotCompliance.selector);
        vm.prank(registryAddr);
        rwaToken.forcedTransfer(alice, bob, 1000 * 1e18);
    }

    // ================================================================
    // ADMIN TESTS
    // ================================================================

    function test_Admin_Pause_Unpause() public {
        rwaToken.pause();
        
        vm.prank(registryAddr);
        vm.expectRevert(); // OpenZeppelin EnforcedPause
        rwaToken.mint(alice, 1000 * 1e18);

        rwaToken.unpause();
        vm.prank(registryAddr);
        rwaToken.mint(alice, 1000 * 1e18); // Should pass
        assertEq(rwaToken.balanceOf(alice), 1000 * 1e18);
    }

    function test_Admin_Setters() public {
        rwaToken.setComplianceEngine(address(0x999));
        assertEq(rwaToken.getComplianceEngine(), address(0x999));

        rwaToken.setAssetRegistry(address(0x888));
        assertEq(rwaToken.getAssetRegistry(), address(0x888));
    }
}