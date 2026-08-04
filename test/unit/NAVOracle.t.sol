// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { NAVOracle } from "../../src/core/NAVOracle.sol";
import { INAVOracle } from "../../src/interfaces/INAVOracle.sol";
import { NAVLib } from "../../src/libraries/NAVLib.sol";
import { MockChainlinkFeed } from "../mocks/MockChainlinkFeed.sol";

contract NAVOracleTest is Test {
    NAVOracle public oracle;
    MockChainlinkFeed public mockFeed;

    address public owner = address(0x111);
    address public guardian = address(0x222);
    bytes32 public constant ASSET_ID = keccak256("T_BILL_001");

    function setUp() public {
        // Set fixed timestamp to avoid underflows during staleness checks
        vm.warp(1000000);

        mockFeed = new MockChainlinkFeed(8, "MOCK / USD");
        
        vm.prank(owner);
        oracle = new NAVOracle(guardian);
    }

    // ================================================================
    // FEED REGISTRATION TESTS
    // ================================================================

    function test_RegisterFeed_Success() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        INAVOracle.FeedConfig memory config = oracle.getFeedConfig(ASSET_ID);
        assertEq(config.feed, address(mockFeed));
        assertEq(config.decimals, 8);
        assertTrue(config.active);
    }

    function test_RegisterFeed_RevertZeroAddressOrDuplicate() public {
        vm.startPrank(owner);
        vm.expectRevert(INAVOracle.ZeroAddress.selector);
        oracle.registerFeed(ASSET_ID, address(0));

        oracle.registerFeed(ASSET_ID, address(mockFeed));
        
        vm.expectRevert(abi.encodeWithSelector(INAVOracle.FeedAlreadySet.selector, ASSET_ID));
        oracle.registerFeed(ASSET_ID, address(mockFeed));
        vm.stopPrank();
    }

    // ================================================================
    // GET LATEST NAV TESTS
    // ================================================================

    function test_GetLatestNAV_Success() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        int256 targetPrice = 100000000; // $1.00 (8 decimals)
        
        // Mock chainlink response (valid, not stale)
        mockFeed.setMockData(1, targetPrice, block.timestamp, block.timestamp, 1);

        (int256 price, uint40 updatedAt, uint8 decimals) = oracle.getLatestNAV(ASSET_ID);
        
        assertEq(price, targetPrice);
        assertEq(updatedAt, block.timestamp);
        assertEq(decimals, 8);
    }

    function test_GetLatestNAV_RevertsIfStale() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        uint256 staleTime = block.timestamp - 1.5 hours; // Max staleness is 1 hour
        mockFeed.setMockData(1, 100000000, staleTime, staleTime, 1);

        // Should bubble up StalePriceFeed error from NAVLib
        vm.expectRevert(abi.encodeWithSelector(NAVLib.StalePriceFeed.selector, address(mockFeed), staleTime, 1 hours));
        oracle.getLatestNAV(ASSET_ID);
    }

    // ================================================================
    // CIRCUIT BREAKER / SNAPSHOT TESTS (CRITICAL LOGIC)
    // ================================================================

    function test_RefreshSnapshot_TripsCircuitBreaker() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        // 1. Set initial price to $100 and take snapshot
        int256 initialPrice = 100 * 1e8;
        mockFeed.setMockData(1, initialPrice, block.timestamp, block.timestamp, 1);
        oracle.refreshSnapshot(ASSET_ID);

        NAVLib.NAVSnapshot memory snap = oracle.getSnapshot(ASSET_ID);
        assertEq(snap.price, initialPrice);

        // 👉 FIX: Fast forward time to exceed 24H window so snapshot expires
        vm.warp(block.timestamp + 24 hours + 1 seconds);

        // 2. Drop price by 20% (Threshold is 15%) => Drops to $80
        int256 crashedPrice = 80 * 1e8; 
        
        // Update mock feed with new crashed price and NEW block.timestamp
        mockFeed.setMockData(2, crashedPrice, block.timestamp, block.timestamp, 2);

        // Trigger snapshot refresh again to detect drop (this will now bypass the early return)
        oracle.refreshSnapshot(ASSET_ID);

        // 3. Verify Circuit breaker tripped
        assertTrue(oracle.isCircuitBreakerTripped(ASSET_ID));

        // 4. Any attempt to read NAV should now revert
        vm.expectRevert(abi.encodeWithSelector(INAVOracle.CircuitBreakerTripped.selector, ASSET_ID, 0, 0));
        oracle.getLatestNAV(ASSET_ID);
    }

    function test_GetTotalNAV_ComputesCorrectly() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        // Token supply = 1,000,000 tokens (18 decimals)
        uint256 supply = 1_000_000 * 1e18;
        
        // NAV = $2.50 (8 decimals)
        mockFeed.setMockData(1, 250000000, block.timestamp, block.timestamp, 1);

        uint256 totalNAV = oracle.getTotalNAV(ASSET_ID, supply);

        // Expected: 1,000,000 * 2.50 = $2,500,000 (with 18 decimals scaling)
        assertEq(totalNAV, 2_500_000 * 1e18);
    }

    // ================================================================
    // ADMIN RECOVERY TESTS
    // ================================================================

    function test_Guardian_ResetCircuitBreaker() public {
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));

        // 1. Initial stable setup
        mockFeed.setMockData(1, 100 * 1e8, block.timestamp, block.timestamp, 1);
        oracle.refreshSnapshot(ASSET_ID);

        // 👉 FIX: Advance EVM time to allow snapshot refresh calculation
        vm.warp(block.timestamp + 24 hours + 1 seconds);

        // 2. 50% market crash logic
        mockFeed.setMockData(2, 50 * 1e8, block.timestamp, block.timestamp, 2);
        oracle.refreshSnapshot(ASSET_ID);
        
        // Ensure Breaker actually tripped!
        assertTrue(oracle.isCircuitBreakerTripped(ASSET_ID));

        // 3. Guardian rescues the protocol
        vm.prank(guardian);
        oracle.resetCircuitBreaker(ASSET_ID);

        assertFalse(oracle.isCircuitBreakerTripped(ASSET_ID));
        
        // Validate snapshot was completely wiped during reset
        NAVLib.NAVSnapshot memory snap = oracle.getSnapshot(ASSET_ID);
        assertEq(snap.price, 0);
        assertEq(snap.timestamp, 0);
    }

    function test_Pause_Unpause_Modifiers() public {
        vm.prank(guardian);
        oracle.pause();

        assertTrue(oracle.isPaused());

        vm.expectRevert(INAVOracle.OraclePaused.selector);
        oracle.getLatestNAV(ASSET_ID);

        vm.prank(guardian);
        oracle.unpause();

        assertFalse(oracle.isPaused());
    }
}