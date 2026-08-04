// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { NAVLib } from "../libraries/NAVLib.sol";

/// @title INAVOracle
/// @notice Interface for the Nexus RWA NAV Oracle contract.
/// @dev Consumers import this — never import NAVOracle directly.
interface INAVOracle {

    // =======================================================================
    // ERRORS
    // =======================================================================

    error OraclePaused();
    error ZeroAddress();
    error FeedAlreadySet(bytes32 assetId);
    error FeedNotRegistered(bytes32 assetId);
    error CircuitBreakerTripped(bytes32 assetId, int256 price, uint256 dropBps);
    error OnlyGuardian();

    // =======================================================================
    // EVENTS
    // =======================================================================

    /// @notice Emitted when a new Chainlink feed is registered for an asset.
    event FeedRegistered(bytes32 indexed assetId, address indexed feed, uint8 decimals);

    /// @notice Emitted when a feed is updated for an asset.
    event FeedUpdated(bytes32 indexed assetId, address indexed oldFeed, address indexed newFeed);

    /// @notice Emitted when NAV is successfully fetched and validated.
    event NAVUpdated(bytes32 indexed assetId, int256 price, uint256 updatedAt);

    /// @notice Emitted when circuit breaker trips due to NAV drop.
    event CircuitBreakerTriggered(bytes32 indexed assetId, int256 previousNAV, int256 currentNAV, uint256 dropBps);

    /// @notice Emitted when circuit breaker is manually reset by guardian.
    event CircuitBreakerReset(bytes32 indexed assetId, address indexed guardian);

    /// @notice Emitted when oracle is paused.
    event OraclePausedEvent(address indexed guardian);

    /// @notice Emitted when oracle is unpaused.
    event OracleUnpaused(address indexed guardian);

    /// @notice Emitted when NAV snapshot is refreshed.
    event SnapshotRefreshed(bytes32 indexed assetId, int256 price, uint40 timestamp);

    // =======================================================================
    // STRUCTS
    // =======================================================================

    /// @notice Feed config per registered asset.
    /// @dev Packed into 2 storage slots.
    struct FeedConfig {
        address feed;       // Chainlink AggregatorV3 address
        uint8   decimals;   // feed decimals
        bool    active;     // feed active flag
    }

    // =======================================================================
    // CORE FUNCTIONS
    // =======================================================================

    /// @notice Returns the latest validated NAV for a registered asset.
    function getLatestNAV(bytes32 assetId)
        external
        view
        returns (int256 price, uint40 updatedAt, uint8 decimals);

    /// @notice Returns total protocol NAV for an asset — supply * NAV price.
    function getTotalNAV(bytes32 assetId, uint256 totalSupply)
        external
        view
        returns (uint256 totalNAV);

    /// @notice Refreshes NAV snapshot for circuit breaker baseline.
    function refreshSnapshot(bytes32 assetId) external;

    // =======================================================================
    // ADMIN FUNCTIONS
    // =======================================================================

    /// @notice Registers a new Chainlink feed for an asset.
    function registerFeed(bytes32 assetId, address feed) external;

    /// @notice Updates an existing feed for an asset.
    function updateFeed(bytes32 assetId, address newFeed) external;

    /// @notice Resets circuit breaker for an asset after manual review.
    /// @param assetId Unique asset identifier
    function resetCircuitBreaker(bytes32 assetId) external;

    /// @notice Pauses the oracle — halts all NAV reads.
    function pause() external;

    /// @notice Unpauses the oracle.
    function unpause() external;

    // =======================================================================
    // VIEW FUNCTIONS
    // =======================================================================

    /// @notice Returns feed config for a registered asset.
    function getFeedConfig(bytes32 assetId) external view returns (FeedConfig memory config);

    /// @notice Returns current NAV snapshot for an asset.
    function getSnapshot(bytes32 assetId) external view returns (NAVLib.NAVSnapshot memory snapshot);

    /// @notice Returns whether circuit breaker is tripped for an asset.
    function isCircuitBreakerTripped(bytes32 assetId) external view returns (bool tripped);

    /// @notice Returns whether oracle is paused.
    function isPaused() external view returns (bool paused);
}