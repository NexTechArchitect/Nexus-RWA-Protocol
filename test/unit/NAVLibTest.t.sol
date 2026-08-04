// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { NAVLib } from "../../src/libraries/NAVLib.sol";

// ====================================================================
// TEST HARNESS
// ====================================================================
/// @dev Wrapper contract to expose internal library functions for testing
contract NAVLibHarness {
    function validateStaleness(address feed, NAVLib.RoundData memory data) public view {
        NAVLib.validateStaleness(feed, data);
    }

    function validatePrice(address feed, int256 price) public pure {
        NAVLib.validatePrice(feed, price);
    }

    function validateNAV(address feed, NAVLib.RoundData memory data, uint8 decimals) public view returns (NAVLib.ValidatedPrice memory) {
        return NAVLib.validateNAV(feed, data, decimals);
    }

    function enforceNAVDropGuard(NAVLib.NAVSnapshot memory snapshot, int256 currentPrice) public view {
        NAVLib.enforceNAVDropGuard(snapshot, currentPrice);
    }

    function normalizeDecimals(int256 price, uint8 fromDecimals, uint8 toDecimals) public pure returns (int256) {
        return NAVLib.normalizeDecimals(price, fromDecimals, toDecimals);
    }

    function isSnapshotExpired(NAVLib.NAVSnapshot memory snapshot) public view returns (bool) {
        return NAVLib.isSnapshotExpired(snapshot);
    }

    function buildSnapshot(int256 currentPrice) public view returns (NAVLib.NAVSnapshot memory) {
        return NAVLib.buildSnapshot(currentPrice);
    }

    function computeTotalNAV(uint256 totalSupply, int256 navPrice, uint8 navDecimals) public pure returns (uint256) {
        return NAVLib.computeTotalNAV(totalSupply, navPrice, navDecimals);
    }
}

// ====================================================================
// TEST SUITE
// ====================================================================
contract NAVLibTest is Test {
    NAVLibHarness public harness;
    address public constant MOCK_FEED = address(0x123);

    function setUp() public {
        harness = new NAVLibHarness();
        // Set a fixed timestamp so calculations are predictable
        vm.warp(1000000); 
    }

    // ================================================================
    // STALENESS VALIDATION TESTS
    // ================================================================
    
    function test_ValidateStaleness_Success() public view {
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 1,
            answer: 1000,
            startedAt: block.timestamp - 100,
            updatedAt: block.timestamp - 100,
            answeredInRound: 1
        });
        harness.validateStaleness(MOCK_FEED, data); // Should not revert
    }

    function test_ValidateStaleness_RevertZeroRoundId() public {
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 0,
            answer: 1000,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: 0
        });
        vm.expectRevert(abi.encodeWithSelector(NAVLib.InvalidRound.selector, 0, block.timestamp));
        harness.validateStaleness(MOCK_FEED, data);
    }

    function test_ValidateStaleness_RevertZeroStartedAt() public {
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 1,
            answer: 1000,
            startedAt: 0,
            updatedAt: block.timestamp,
            answeredInRound: 1
        });
        vm.expectRevert(abi.encodeWithSelector(NAVLib.InvalidRound.selector, 1, 0));
        harness.validateStaleness(MOCK_FEED, data);
    }

    function test_ValidateStaleness_RevertRoundNotComplete() public {
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 5,
            answer: 1000,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: 4 // answeredInRound < roundId
        });
        vm.expectRevert(abi.encodeWithSelector(NAVLib.RoundNotComplete.selector, 5, 4));
        harness.validateStaleness(MOCK_FEED, data);
    }

    function test_ValidateStaleness_RevertStaleFeed() public {
        uint256 maxStaleness = 1 hours;
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 1,
            answer: 1000,
            startedAt: block.timestamp - maxStaleness - 1,
            updatedAt: block.timestamp - maxStaleness - 1, // Exceeds 1 hour staleness
            answeredInRound: 1
        });
        vm.expectRevert(abi.encodeWithSelector(NAVLib.StalePriceFeed.selector, MOCK_FEED, data.updatedAt, maxStaleness));
        harness.validateStaleness(MOCK_FEED, data);
    }

    // ================================================================
    // PRICE VALIDATION TESTS
    // ================================================================

    // CHANGED from pure to view because calling `harness` reads state
    function test_ValidatePrice_Success() public view {
        harness.validatePrice(MOCK_FEED, 100); // Exact MIN_VALID_PRICE
        harness.validatePrice(MOCK_FEED, 1000000); 
    }

    function test_ValidatePrice_RevertNegativeOrZero() public {
        vm.expectRevert(abi.encodeWithSelector(NAVLib.NegativePrice.selector, 0));
        harness.validatePrice(MOCK_FEED, 0);

        vm.expectRevert(abi.encodeWithSelector(NAVLib.NegativePrice.selector, -10));
        harness.validatePrice(MOCK_FEED, -10);
    }

    function test_ValidatePrice_RevertDustPrice() public {
        vm.expectRevert(abi.encodeWithSelector(NAVLib.InvalidPrice.selector, MOCK_FEED, 99)); // < 100
        harness.validatePrice(MOCK_FEED, 99);
    }

    // ================================================================
    // NAV VALIDATION (PIPELINE) TESTS
    // ================================================================

    function test_ValidateNAV_Success() public view {
        NAVLib.RoundData memory data = NAVLib.RoundData({
            roundId: 2,
            answer: 5000,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: 2
        });

        NAVLib.ValidatedPrice memory validated = harness.validateNAV(MOCK_FEED, data, 8);
        assertEq(validated.price, 5000);
        assertEq(validated.updatedAt, block.timestamp);
        assertEq(validated.decimals, 8);
        assertTrue(validated.isValid);
    }

    // ================================================================
    // CIRCUIT BREAKER (NAV DROP GUARD) TESTS
    // ================================================================

    function test_EnforceNAVDropGuard_SuccessNoDrop() public view {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({
            price: 10000,
            timestamp: uint40(block.timestamp)
        });
        // Price increased, should not trip
        harness.enforceNAVDropGuard(snapshot, 10500);
        // Price equal, should not trip
        harness.enforceNAVDropGuard(snapshot, 10000);
    }

    function test_EnforceNAVDropGuard_SuccessExact15PercentDrop() public view {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({
            price: 10000,
            timestamp: uint40(block.timestamp)
        });
        // 15% of 10000 is 1500. Exact limit drop -> 8500. Should not revert.
        harness.enforceNAVDropGuard(snapshot, 8500); 
    }

    function test_EnforceNAVDropGuard_RevertExceeds15Percent() public {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({
            price: 10000,
            timestamp: uint40(block.timestamp)
        });
        // 15.01% drop -> 8499
        uint256 expectedDropBps = 1501;
        vm.expectRevert(abi.encodeWithSelector(NAVLib.NAVDropExceeded.selector, 10000, 8499, expectedDropBps));
        harness.enforceNAVDropGuard(snapshot, 8499); 
    }

    function test_EnforceNAVDropGuard_WindowExpired() public {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({
            price: 10000,
            timestamp: uint40(block.timestamp)
        });
        
        vm.warp(block.timestamp + 24 hours + 1 seconds); // Exceeds 24H NAV_DROP_WINDOW

        // Even with a 99% drop, it should not revert because the snapshot is expired
        harness.enforceNAVDropGuard(snapshot, 100);
    }

    function test_EnforceNAVDropGuard_RevertZeroPrice() public {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({ price: 0, timestamp: uint40(block.timestamp) });
        vm.expectRevert(NAVLib.ZeroPrice.selector);
        harness.enforceNAVDropGuard(snapshot, 5000);

        snapshot = NAVLib.NAVSnapshot({ price: 10000, timestamp: uint40(block.timestamp) });
        vm.expectRevert(NAVLib.ZeroPrice.selector);
        harness.enforceNAVDropGuard(snapshot, 0);
    }

    // ================================================================
    // NORMALIZATION TESTS
    // ================================================================

    function test_NormalizeDecimals_SameDecimals() public view {
        assertEq(harness.normalizeDecimals(1000, 8, 8), 1000);
    }

    function test_NormalizeDecimals_ScaleUp() public view {
        assertEq(harness.normalizeDecimals(1, 8, 18), 10 ** 10);
        assertEq(harness.normalizeDecimals(500, 6, 18), 500 * (10 ** 12));
    }

    function test_NormalizeDecimals_ScaleDown() public view {
        assertEq(harness.normalizeDecimals(10 ** 18, 18, 8), 10 ** 8);
        
        assertEq(harness.normalizeDecimals(150000000, 8, 6), 1500000);
    }

    // ================================================================
    // SNAPSHOT LOGIC TESTS
    // ================================================================

    function test_IsSnapshotExpired() public {
        NAVLib.NAVSnapshot memory snapshot = NAVLib.NAVSnapshot({
            price: 1000,
            timestamp: uint40(block.timestamp)
        });
        assertFalse(harness.isSnapshotExpired(snapshot));

        vm.warp(block.timestamp + 24 hours + 1 seconds);
        assertTrue(harness.isSnapshotExpired(snapshot));
    }

    function test_BuildSnapshot() public view {
        NAVLib.NAVSnapshot memory snapshot = harness.buildSnapshot(5555);
        assertEq(snapshot.price, 5555);
        assertEq(snapshot.timestamp, block.timestamp);
    }

    function test_BuildSnapshot_RevertZeroPrice() public {
        vm.expectRevert(NAVLib.ZeroPrice.selector);
        harness.buildSnapshot(0);
    }

    // ================================================================
    // TOTAL NAV COMPUTATION TESTS
    // ================================================================

    // CHANGED from pure to view
    function test_ComputeTotalNAV_Success() public view {
        uint256 totalSupply = 100 * 1e18; // 100 tokens
        int256 price = 250000000;         // $2.50 (8 decimals)
        
        uint256 totalNAV = harness.computeTotalNAV(totalSupply, price, 8);
        
        // 100 * 2.5 = $250 total NAV
        assertEq(totalNAV, 250 * 1e18);
    }

    function test_ComputeTotalNAV_RevertZeroPrice() public {
        vm.expectRevert(NAVLib.ZeroPrice.selector);
        harness.computeTotalNAV(100 * 1e18, 0, 8);
    }
}