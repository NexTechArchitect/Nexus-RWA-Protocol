// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { YieldDistributor } from "../../src/core/YieldDistributor.sol";
import { IYieldDistributor } from "../../src/interfaces/IYieldDistributor.sol";

// ====================================================================
// MOCKS FOR YIELD DISTRIBUTOR
// ====================================================================
contract MockYieldToken is ERC20 {
    constructor() ERC20("USDC Mock", "USDC") {
        _mint(msg.sender, 1000000 * 1e6); // 1 Million USDC
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockAssetRegistryForYield {
    mapping(address => bool) public whitelisted;
    function setWhitelisted(address user, bool status) external { whitelisted[user] = status; }
    function isWhitelisted(bytes32, address account) external view returns (bool) { return whitelisted[account]; }
}

// ====================================================================
// TEST SUITE
// ====================================================================
contract YieldDistributorTest is Test {
    YieldDistributor public distributor;
    MockYieldToken public yieldToken;
    MockAssetRegistryForYield public mockRegistry;

    bytes32 public constant ASSET_ID = keccak256("YIELD_ASSET");
    uint256 public constant EPOCH_DURATION = 30 days;
    
    address public treasury = address(0x100);
    address public automationNode = address(0x200);
    address public investor = address(0x300);

    function setUp() public {
        yieldToken = new MockYieldToken();
        mockRegistry = new MockAssetRegistryForYield();
        
        // Treasury holds funds to deposit
        yieldToken.mint(treasury, 100000 * 1e6);

        distributor = new YieldDistributor(
            ASSET_ID,
            address(mockRegistry),
            address(yieldToken),
            treasury,
            automationNode,
            EPOCH_DURATION
        );

        mockRegistry.setWhitelisted(investor, true);
    }

    // ================================================================
    // HELPER FUNCTIONS
    // ================================================================

    function _generateSingleLeafRoot(address _investor, uint256 _amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(_investor, _amount))));
    }

    // ================================================================
    // INITIALIZATION & CHAINLINK AUTOMATION TESTS
    // ================================================================

    function test_Constructor_InitializesCorrectly() public view {
        assertEq(distributor.getCurrentEpochId(), 1);
        assertEq(distributor.getNextEpochTime(), block.timestamp + EPOCH_DURATION);
        
        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(uint8(epoch.status), uint8(IYieldDistributor.EpochStatus.ACTIVE));
    }

    function test_CheckUpkeep_ReturnsTrueAfterDuration() public {
        vm.warp(block.timestamp + EPOCH_DURATION + 1);
        (bool upkeepNeeded, bytes memory performData) = distributor.checkUpkeep("");
        
        assertTrue(upkeepNeeded);
        assertEq(abi.decode(performData, (uint64)), 2); // Next epoch is 2
    }

    function test_PerformUpkeep_RevertsIfEarly() public {
        vm.prank(automationNode);
        vm.expectRevert(IYieldDistributor.UpkeepNotNeeded.selector);
        distributor.performUpkeep(abi.encode(uint64(2)));
    }

    function test_PerformUpkeep_Success() public {
        vm.warp(block.timestamp + EPOCH_DURATION + 1);
        
        vm.prank(automationNode);
        distributor.performUpkeep(abi.encode(uint64(2)));

        assertEq(distributor.getCurrentEpochId(), 2);
        IYieldDistributor.Epoch memory epoch2 = distributor.getEpoch(2);
        assertEq(uint8(epoch2.status), uint8(IYieldDistributor.EpochStatus.ACTIVE));
    }

    // ================================================================
    // DEPOSIT & FINALIZE TESTS
    // ================================================================

    function test_DepositYield_RevertsIfNotDistributor() public {
        vm.prank(investor);
        vm.expectRevert(IYieldDistributor.OnlyDistributor.selector);
        distributor.depositYield(1, 1000 * 1e6);
    }

    function test_DepositYield_Success() public {
        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), 1000 * 1e6);
        distributor.depositYield(1, 1000 * 1e6);
        vm.stopPrank();

        assertEq(yieldToken.balanceOf(address(distributor)), 1000 * 1e6);
    }

    function test_FinalizeEpoch_RevertsEmptyRoot() public {
        vm.prank(treasury);
        vm.expectRevert(IYieldDistributor.InvalidMerkleRoot.selector);
        distributor.finalizeEpoch(1, bytes32(0), 1000 * 1e6);
    }

    function test_FinalizeEpoch_Success() public {
        bytes32 root = _generateSingleLeafRoot(investor, 100 * 1e6);
        
        vm.prank(treasury);
        distributor.finalizeEpoch(1, root, 100 * 1e6);

        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(uint8(epoch.status), uint8(IYieldDistributor.EpochStatus.FINALIZED));
        assertEq(epoch.merkleRoot, root);
        assertEq(epoch.totalYield, 100 * 1e6);
    }

    // ================================================================
    // CLAIM YIELD TESTS
    // ================================================================

    function test_ClaimYield_Success() public {
        uint256 claimAmount = 100 * 1e6;
        bytes32 root = _generateSingleLeafRoot(investor, claimAmount);
        bytes32[] memory emptyProof = new bytes32[](0); // 1-element tree needs no proof

        // Treasury deposits and finalizes
        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), claimAmount);
        distributor.depositYield(1, claimAmount);
        distributor.finalizeEpoch(1, root, claimAmount);
        vm.stopPrank();

        // Investor claims
        vm.prank(investor);
        distributor.claimYield(1, claimAmount, emptyProof);

        assertTrue(distributor.hasClaimed(1, investor));
        assertEq(yieldToken.balanceOf(investor), claimAmount);
        
        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(epoch.claimedYield, claimAmount);
    }

    function test_ClaimYield_RevertsIfDoubleClaim() public {
        uint256 claimAmount = 100 * 1e6;
        bytes32 root = _generateSingleLeafRoot(investor, claimAmount);
        bytes32[] memory emptyProof = new bytes32[](0);

        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), claimAmount);
        distributor.depositYield(1, claimAmount);
        distributor.finalizeEpoch(1, root, claimAmount);
        vm.stopPrank();

        vm.startPrank(investor);
        distributor.claimYield(1, claimAmount, emptyProof);

        // Attempt double claim
        vm.expectRevert(abi.encodeWithSelector(IYieldDistributor.AlreadyClaimed.selector, 1, investor));
        distributor.claimYield(1, claimAmount, emptyProof);
        vm.stopPrank();
    }

    function test_ClaimYield_RevertsNotWhitelisted() public {
        uint256 claimAmount = 100 * 1e6;
        bytes32 root = _generateSingleLeafRoot(investor, claimAmount);
        bytes32[] memory emptyProof = new bytes32[](0);

        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), claimAmount);
        distributor.depositYield(1, claimAmount);
        distributor.finalizeEpoch(1, root, claimAmount);
        vm.stopPrank();

        // Revoke whitelist
        mockRegistry.setWhitelisted(investor, false);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(IYieldDistributor.NotWhitelisted.selector, investor));
        distributor.claimYield(1, claimAmount, emptyProof);
    }

    // ================================================================
    // BATCH CLAIM TESTS
    // ================================================================

    function test_ClaimYieldBatch_Success() public {
        uint256 amount1 = 100 * 1e6;
        bytes32 root1 = _generateSingleLeafRoot(investor, amount1);
        
        // Setup Epoch 1
        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), amount1);
        distributor.depositYield(1, amount1);
        distributor.finalizeEpoch(1, root1, amount1);
        vm.stopPrank();

        // Advance to Epoch 2
        vm.warp(block.timestamp + EPOCH_DURATION + 1);
        vm.prank(automationNode);
        distributor.performUpkeep(abi.encode(uint64(2)));

        uint256 amount2 = 200 * 1e6;
        bytes32 root2 = _generateSingleLeafRoot(investor, amount2);

        // Setup Epoch 2
        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), amount2);
        distributor.depositYield(2, amount2);
        distributor.finalizeEpoch(2, root2, amount2);
        vm.stopPrank();

        // Batch Claim Logic
        uint64[] memory epochsToClaim = new uint64[](2);
        epochsToClaim[0] = 1;
        epochsToClaim[1] = 2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount1;
        amounts[1] = amount2;

        bytes32[][] memory proofs = new bytes32[][](2);
        proofs[0] = new bytes32[](0);
        proofs[1] = new bytes32[](0);

        vm.prank(investor);
        distributor.claimYieldBatch(epochsToClaim, amounts, proofs);

        assertEq(yieldToken.balanceOf(investor), amount1 + amount2);
        assertTrue(distributor.hasClaimed(1, investor));
        assertTrue(distributor.hasClaimed(2, investor));
    }

    function test_ClaimYieldBatch_RevertsArrayMismatch() public {
        uint64[] memory epochsToClaim = new uint64[](2);
        uint256[] memory amounts = new uint256[](1); // Mismatch length
        bytes32[][] memory proofs = new bytes32[][](2);

        vm.prank(investor);
        vm.expectRevert(IYieldDistributor.ZeroAmount.selector);
        distributor.claimYieldBatch(epochsToClaim, amounts, proofs);
    }

    // ================================================================
    // CLOSE & SWEEP TESTS
    // ================================================================

    function test_CloseEpoch_SuccessSweepsUnclaimed() public {
        uint256 depositAmt = 1000 * 1e6;
        bytes32 dummyRoot = bytes32(uint256(1)); // Nobody claims
        
        vm.startPrank(treasury);
        yieldToken.approve(address(distributor), depositAmt);
        distributor.depositYield(1, depositAmt);
        distributor.finalizeEpoch(1, dummyRoot, depositAmt);
        
        uint256 treasuryBalBefore = yieldToken.balanceOf(treasury);

        distributor.closeEpoch(1);
        vm.stopPrank();

        uint256 treasuryBalAfter = yieldToken.balanceOf(treasury);
        
        assertEq(treasuryBalAfter - treasuryBalBefore, depositAmt);
        
        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(uint8(epoch.status), uint8(IYieldDistributor.EpochStatus.CLOSED));
    }
}