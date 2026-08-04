// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable }   from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable }                from "@openzeppelin/contracts/utils/Pausable.sol";
import { AggregatorV3Interface }   from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { INAVOracle }              from "../interfaces/INAVOracle.sol";
import { NAVLib }                  from "../libraries/NAVLib.sol";

/// @title NAVOracle
/// @notice Chainlink-powered NAV oracle for Nexus RWA Protocol.
/// @dev Implements staleness guards, 15% circuit breaker, and asset feed registry.
contract NAVOracle is INAVOracle, Ownable2Step, Pausable {

    using NAVLib for NAVLib.NAVSnapshot;

    //=======================================================================
    // STORAGE & IMMUTABLES
    //=======================================================================

    /// @notice The guardian address authorized to pause the oracle and reset circuit breakers.
    /// @dev Gas Optimization: Marked as immutable since it's only set once during deployment.
    address public immutable i_guardian;

    mapping(bytes32 => FeedConfig) private s_feedConfigs;
    mapping(bytes32 => NAVLib.NAVSnapshot) private s_snapshots;
    mapping(bytes32 => bool) private s_circuitBreakers;

    //=======================================================================
    // MODIFIERS
    //=======================================================================

    modifier notPaused() {
        if (paused()) revert OraclePaused();
        _;
    }

    modifier onlyGuardian() {
        // Now using the gas-optimized immutable variable
        if (msg.sender != i_guardian && msg.sender != owner()) revert OnlyGuardian();
        _;
    }

    modifier feedExists(bytes32 assetId) {
        if (!s_feedConfigs[assetId].active) revert FeedNotRegistered(assetId);
        _;
    }

    modifier circuitBreakerOff(bytes32 assetId) {
        if (s_circuitBreakers[assetId]) revert CircuitBreakerTripped(assetId, 0, 0);
        _;
    }

    //=======================================================================
    // CONSTRUCTOR
    //=======================================================================

    constructor(address guardian) Ownable(msg.sender) {
        if (guardian == address(0)) revert ZeroAddress();
        i_guardian = guardian;
    }

    //=======================================================================
    // CORE FUNCTIONS
    //=======================================================================

    /// @inheritdoc INAVOracle
    function getLatestNAV(bytes32 assetId)
        external
        view
        override
        notPaused
        feedExists(assetId)
        circuitBreakerOff(assetId)
        returns (int256 price, uint40 updatedAt, uint8 decimals)
    {
        FeedConfig memory config = s_feedConfigs[assetId];
        NAVLib.RoundData memory roundData;

        // @dev Scoped block to avoid EVM "Stack Too Deep" error
        {
            (
                uint80 roundId,
                int256 answer,
                uint256 startedAt,
                uint256 feedUpdatedAt,
                uint80 answeredInRound
            ) = AggregatorV3Interface(config.feed).latestRoundData();

            roundData = NAVLib.RoundData({
                roundId:         roundId,
                answer:          answer,
                startedAt:       startedAt,
                updatedAt:       feedUpdatedAt,
                answeredInRound: answeredInRound
            });
        } // The 5 raw variables are immediately destroyed from stack here!

        NAVLib.ValidatedPrice memory validated = NAVLib.validateNAV(config.feed, roundData, config.decimals);

        NAVLib.NAVSnapshot memory snapshot = s_snapshots[assetId];
        if (snapshot.timestamp != 0) {
            NAVLib.enforceNAVDropGuard(snapshot, validated.price);
        }

        return (validated.price, uint40(validated.updatedAt), validated.decimals);
    }

    /// @inheritdoc INAVOracle
    function getTotalNAV(bytes32 assetId, uint256 totalSupply)
        external
        view
        override
        notPaused
        feedExists(assetId)
        circuitBreakerOff(assetId)
        returns (uint256 totalNAV)
    {
        (int256 price, , uint8 decimals) = this.getLatestNAV(assetId);
        totalNAV = NAVLib.computeTotalNAV(totalSupply, price, decimals);
    }

    /// @inheritdoc INAVOracle
    function refreshSnapshot(bytes32 assetId)
        external
        override
        notPaused
        feedExists(assetId)
    {
        NAVLib.NAVSnapshot memory snapshot = s_snapshots[assetId];

        if (!NAVLib.isSnapshotExpired(snapshot)) return;

        FeedConfig memory config = s_feedConfigs[assetId];
        NAVLib.RoundData memory roundData;

        {
            (
                uint80 roundId,
                int256 answer,
                uint256 startedAt,
                uint256 feedUpdatedAt,
                uint80 answeredInRound
            ) = AggregatorV3Interface(config.feed).latestRoundData();

            roundData = NAVLib.RoundData({
                roundId:         roundId,
                answer:          answer,
                startedAt:       startedAt,
                updatedAt:       feedUpdatedAt,
                answeredInRound: answeredInRound
            });
        } 

        NAVLib.ValidatedPrice memory validated = NAVLib.validateNAV(config.feed, roundData, config.decimals);

        if (snapshot.timestamp != 0 && validated.price < snapshot.price) {
            uint256 prev = uint256(snapshot.price);
            uint256 curr = uint256(validated.price);
            
            uint256 dropBps = ((prev - curr) * NAVLib.BPS_DENOMINATOR) / prev;
            
            if (dropBps > NAVLib.NAV_DROP_BPS) {
                _tripCircuitBreaker(assetId, snapshot.price, validated.price, dropBps);
                return;
            }
        }

        NAVLib.NAVSnapshot memory newSnapshot = NAVLib.buildSnapshot(validated.price);
        s_snapshots[assetId] = newSnapshot;

        emit SnapshotRefreshed(assetId, validated.price, newSnapshot.timestamp);
    }

    //=======================================================================
    // ADMIN FUNCTIONS
    //=======================================================================

    /// @inheritdoc INAVOracle
    function registerFeed(bytes32 assetId, address feed) external override onlyOwner {
        if (feed == address(0)) revert ZeroAddress();
        if (s_feedConfigs[assetId].active) revert FeedAlreadySet(assetId);

        uint8 decimals = AggregatorV3Interface(feed).decimals();

        s_feedConfigs[assetId] = FeedConfig({
            feed:     feed,
            decimals: decimals,
            active:   true
        });

        emit FeedRegistered(assetId, feed, decimals);
    }

    /// @inheritdoc INAVOracle
    function updateFeed(bytes32 assetId, address newFeed) external override onlyOwner feedExists(assetId) {
        if (newFeed == address(0)) revert ZeroAddress();

        address oldFeed = s_feedConfigs[assetId].feed;
        uint8 decimals  = AggregatorV3Interface(newFeed).decimals();

        s_feedConfigs[assetId].feed     = newFeed;
        s_feedConfigs[assetId].decimals = decimals;

        emit FeedUpdated(assetId, oldFeed, newFeed);
    }

    /// @inheritdoc INAVOracle
    function resetCircuitBreaker(bytes32 assetId) external override onlyGuardian feedExists(assetId) {
        s_circuitBreakers[assetId] = false;
        s_snapshots[assetId] = NAVLib.NAVSnapshot({ price: 0, timestamp: 0 });
        
        emit CircuitBreakerReset(assetId, msg.sender);
    }

    /// @inheritdoc INAVOracle
    function pause() external override onlyGuardian {
        _pause();
        emit OraclePausedEvent(msg.sender);
    }

    /// @inheritdoc INAVOracle
    function unpause() external override onlyGuardian {
        _unpause();
        emit OracleUnpaused(msg.sender);
    }

    //=======================================================================
    // VIEW FUNCTIONS
    //=======================================================================

    /// @inheritdoc INAVOracle
    function getFeedConfig(bytes32 assetId) external view override returns (FeedConfig memory config) {
        config = s_feedConfigs[assetId];
    }

    /// @inheritdoc INAVOracle
    function getSnapshot(bytes32 assetId) external view override returns (NAVLib.NAVSnapshot memory snapshot) {
        snapshot = s_snapshots[assetId];
    }

    /// @inheritdoc INAVOracle
    function isCircuitBreakerTripped(bytes32 assetId) external view override returns (bool tripped) {
        tripped = s_circuitBreakers[assetId];
    }

    /// @inheritdoc INAVOracle
    function isPaused() external view override returns (bool) {
        return paused();
    }

    //=======================================================================
    // INTERNAL CIRCUIT BREAKER TRIGGER
    //=======================================================================

    /// @dev Internal helper to trip the breaker and emit the event
    function _tripCircuitBreaker(
        bytes32 assetId,
        int256 previousNAV,
        int256 currentNAV,
        uint256 dropBps
    ) internal {
        s_circuitBreakers[assetId] = true;
        emit CircuitBreakerTriggered(assetId, previousNAV, currentNAV, dropBps);
    }
}