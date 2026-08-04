// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { NAVOracle } from "../../src/core/NAVOracle.sol";
import { INAVOracle } from "../../src/interfaces/INAVOracle.sol";
import { NAVLib } from "../../src/libraries/NAVLib.sol";
import { MockChainlinkFeed } from "../mocks/MockChainlinkFeed.sol";

/// @title IntegrationNAVTest
/// @notice End-to-end integration of the NAV Oracle with Chainlink Feeds.
contract IntegrationNAVTest is Test {
    NAVOracle public oracle;
    MockChainlinkFeed public mockFeed;

    address public owner = makeAddr("owner");
    address public guardian = makeAddr("guardian");
    address public protocolUser = makeAddr("protocolUser");

    bytes32 public constant ASSET_ID = keccak256("TOKENIZED_REAL_ESTATE_01");

    uint8 public constant FEED_DECIMALS = 8;
    int256 public constant INITIAL_PRICE = 100 * 1e8; // $100.00

    function setUp() public {
        // Start at a stable, non-zero timestamp
        vm.warp(1_000_000);

        // 1. Deploy Mock Chainlink Feed
        mockFeed = new MockChainlinkFeed(FEED_DECIMALS, "RealEstate / USD");

        // 2. Deploy Oracle
        vm.prank(owner);
        oracle = new NAVOracle(guardian);

        // 3. Register the Feed
        vm.prank(owner);
        oracle.registerFeed(ASSET_ID, address(mockFeed));
    }

    // ================================================================
    // SCENARIO 1: HEALTHY MARKET FLUCTUATIONS
    // ================================================================
    
    function test_HealthyMarket_NormalVolatility() public {
        // Day 1: Initial Price $100
        mockFeed.setMockData(1, INITIAL_PRICE, block.timestamp, block.timestamp, 1);
        oracle.refreshSnapshot(ASSET_ID); 
        
        // Assert state
        (int256 currentPrice, , ) = oracle.getLatestNAV(ASSET_ID);
        assertEq(currentPrice, INITIAL_PRICE);

        // Day 2: Price goes up 5% to $105
        vm.warp(block.timestamp + 1 days);
        int256 day2Price = 105 * 1e8;
        mockFeed.setMockData(2, day2Price, block.timestamp, block.timestamp, 2);
        
        oracle.refreshSnapshot(ASSET_ID);
        (currentPrice, , ) = oracle.getLatestNAV(ASSET_ID);
        assertEq(currentPrice, day2Price);

        // Day 3: Price drops exactly 10% from $105 to $94.50
        vm.warp(block.timestamp + 1 days);
        int256 day3Price = 9450000000; 
        mockFeed.setMockData(3, day3Price, block.timestamp, block.timestamp, 3);
        
        oracle.refreshSnapshot(ASSET_ID);
        (currentPrice, , ) = oracle.getLatestNAV(ASSET_ID);
        assertEq(currentPrice, day3Price);
        assertFalse(oracle.isCircuitBreakerTripped(ASSET_ID), "Circuit breaker tripped incorrectly on safe drop");
    }

    // ================================================================
    // SCENARIO 2: THE BLACK SWAN (FLASH CRASH)
    // ================================================================

    function test_BlackSwan_TriggersCircuitBreaker_BlocksReads() public {
        // Baseline: Price is $100
        mockFeed.setMockData(1, INITIAL_PRICE, block.timestamp, block.timestamp, 1);
        oracle.refreshSnapshot(ASSET_ID);

        // Flash Crash Detected at next snapshot window: Price drops 25% to $75
        // FIX: Advanced time past the 24H window so the Oracle attempts to renew the snapshot
        vm.warp(block.timestamp + 24 hours + 1 seconds); 
        int256 crashedPrice = 75 * 1e8;
        mockFeed.setMockData(2, crashedPrice, block.timestamp, block.timestamp, 2);

        // Oracle should detect this drop and trip the breaker immediately
        oracle.refreshSnapshot(ASSET_ID);

        // Verify breaker is tripped
        assertTrue(oracle.isCircuitBreakerTripped(ASSET_ID));

        // Verify Protocol User CANNOT read the NAV anymore
        vm.prank(protocolUser);
        vm.expectRevert(abi.encodeWithSelector(INAVOracle.CircuitBreakerTripped.selector, ASSET_ID, 0, 0));
        oracle.getLatestNAV(ASSET_ID);
    }

    // ================================================================
    // SCENARIO 3: CHAINLINK NETWORK OUTAGE (STALENESS)
    // ================================================================

    function test_StaleFeed_BlocksReads() public {
        mockFeed.setMockData(1, INITIAL_PRICE, block.timestamp, block.timestamp, 1);
        
        uint256 timePassed = 2 hours;
        vm.warp(block.timestamp + timePassed);

        vm.prank(protocolUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                NAVLib.StalePriceFeed.selector, 
                address(mockFeed), 
                block.timestamp - timePassed, 
                NAVLib.MAX_STALENESS 
            )
        );
        oracle.getLatestNAV(ASSET_ID);
    }

    // ================================================================
    // SCENARIO 4: FULL GUARDIAN RESCUE FLOW
    // ================================================================

    function test_GuardianRecovery_FullLifecycle() public {
        // 1. Initial State
        mockFeed.setMockData(1, INITIAL_PRICE, block.timestamp, block.timestamp, 1);
        oracle.refreshSnapshot(ASSET_ID);
        
        // 2. Refresh baseline at new time
        vm.warp(block.timestamp + 25 hours); 
        mockFeed.setMockData(2, INITIAL_PRICE, block.timestamp, block.timestamp, 2);
        oracle.refreshSnapshot(ASSET_ID);

        // 3. Crash Market by 50% ($100 to $50)
        // FIX: Advanced time past the 24H window so the Oracle attempts to renew the snapshot
        vm.warp(block.timestamp + 24 hours + 1 seconds); 
        int256 crashedPrice = 50 * 1e8; 
        mockFeed.setMockData(3, crashedPrice, block.timestamp, block.timestamp, 3);
        oracle.refreshSnapshot(ASSET_ID);

        assertTrue(oracle.isCircuitBreakerTripped(ASSET_ID), "Circuit Breaker should be tripped");

        // 4. Guardian Intervenes
        vm.prank(guardian);
        oracle.pause();
        assertTrue(oracle.isPaused());

        // 5. Market Recovers to $95
        vm.warp(block.timestamp + 1 days);
        int256 recoveredPrice = 95 * 1e8;
        mockFeed.setMockData(4, recoveredPrice, block.timestamp, block.timestamp, 4);

        // 6. Guardian Resets and Unpauses
        vm.startPrank(guardian);
        oracle.resetCircuitBreaker(ASSET_ID);
        oracle.unpause();
        vm.stopPrank();

        assertFalse(oracle.isCircuitBreakerTripped(ASSET_ID));
        assertFalse(oracle.isPaused());

        // 7. System reads work normally
        oracle.refreshSnapshot(ASSET_ID);
        (int256 activePrice, , ) = oracle.getLatestNAV(ASSET_ID);
        
        assertEq(activePrice, recoveredPrice);
    }
}