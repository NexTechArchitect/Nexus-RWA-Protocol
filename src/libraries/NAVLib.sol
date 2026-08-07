// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title NAVLib
/// @notice NAV validation, staleness guards, and circuit breaker logic for Nexus RWA.
/// @dev Pure math library, no external calls, no state. Used exclusively by NAVOracle.
library NAVLib {
    //=========================================================
    // CONSTANTS
    //=========================================================

    /// @dev Maximum acceptable Chainlink feed staleness
    uint256 public constant MAX_STALENESS   = 1 hours;

    /// @dev Circuit breaker -15% Nav drop in 24H triggers auto-pause
    uint256 public constant NAV_DROP_BPS    = 1500;

    /// @dev Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @dev Minimum valid NAV — prevents zero/dust prices ($0.000001 with 8 decimals)
    int256 public constant MIN_VALID_PRICE  = 100;

    /// @dev 24H window for NAV drop tracking
    uint256 public constant NAV_DROP_WINDOW = 24 hours;

    //======================================================
    // ERRORS
    //======================================================

    error StalePriceFeed(address feed, uint256 updatedAt, uint256 maxStaleness);
    error InvalidPrice(address feed, int256 price);
    error NegativePrice(int256 price);
    error InvalidRound(uint80 roundId, uint256 startedAt);
    error RoundNotComplete(uint80 roundId, uint80 answeredInRound);
    error NAVDropExceeded(int256 previousNAV, int256 currentNAV, uint256 dropBps);
    error ZeroPrice();

    //======================================================
    // STRUCTS
    //======================================================

    /// @notice Validated NAV price returned after all checks pass.
    struct ValidatedPrice {
        int256   price;
        uint40   updatedAt; // Gas optimized to uint40
        uint8    decimals;
        bool     isValid;
    }

    /// @notice Snapshot for 24H drop circuit breaker tracking
    struct NAVSnapshot{
        int256 price;
        uint40 timestamp;
    }

    /// @notice Raw Chainlink aggregatorV3 round data.
    struct RoundData{
        uint80  roundId;
        int256  answer;
        uint256 startedAt;
        uint256 updatedAt;
        uint80 answeredInRound;
    }

    //========================================================
    // STALENESS & ROUND CHECKS
    //========================================================

    /// @notice Validates Chainlink round data — id, startedAt, completeness, staleness.
   
    function validateStaleness(address feed, RoundData memory data) internal view {
        if(data.roundId == 0 || data.startedAt == 0) revert InvalidRound(data.roundId, data.startedAt);
        if(data.answeredInRound < data.roundId) revert RoundNotComplete(data.roundId, data.answeredInRound);
        if(block.timestamp - data.updatedAt > MAX_STALENESS) revert StalePriceFeed(feed, data.updatedAt, MAX_STALENESS);
    }

    //=======================================================
    // PRICE VALIDATION
    //=======================================================
    
    /// @notice Validates raw price — rejects negative, zero, and dust values.
    function validatePrice(address feed, int256 price) internal pure {
        if (price <= 0) revert NegativePrice(price);
        if (price < MIN_VALID_PRICE) revert InvalidPrice(feed, price);
    }
    
    /// @notice Full Chainlink NAV validation pipeline — round + staleness + price.
 
    function validateNAV(
        address feed,
        RoundData memory data,
        uint8 decimals
    ) internal view returns (ValidatedPrice memory validated) {
        validateStaleness(feed, data);
        validatePrice(feed, data.answer);

        validated =  ValidatedPrice({
            price:      data.answer,
            updatedAt:  uint40(data.updatedAt),
            decimals:   decimals,
            isValid:    true
        });
    }

    //=======================================================
    // NAV DROP CIRCUIT Breaker
    //=======================================================
    
    /// @notice Enforces 15% NAV drop guard within 24H window.
  
    function enforceNAVDropGuard(NAVSnapshot memory snapshot, int256 currentPrice) internal view{
        if(block.timestamp - snapshot.timestamp > NAV_DROP_WINDOW) return;
        if(snapshot.price <=0 || currentPrice <=0) revert ZeroPrice();

        uint256 prev = uint256(snapshot.price);
        uint256 curr = uint256(currentPrice);

        if(curr >= prev) return;
        uint256 dropBps = ((prev - curr) *  BPS_DENOMINATOR) / prev;
        if (dropBps > NAV_DROP_BPS) revert NAVDropExceeded(snapshot.price, currentPrice, dropBps);
    }

    //========================================================
    // NAV MATH HELPERS 
    //========================================================

    /// @notice Normalizes a price from one decimal base to another.
    function normalizeDecimals(int256 price , uint8 fromDecimals, uint8 toDecimals) internal pure returns(int256 normalized){
        if(fromDecimals == toDecimals) return price;

        if(fromDecimals < toDecimals){
            uint256 scale = 10** (toDecimals - fromDecimals);
            normalized = price * int256(scale);
        } else {
            uint256 scale = 10 ** (fromDecimals - toDecimals);
            normalized = price / int256(scale);
        }
    }
    
    /// @notice Checks if a NAV snapshot is expired (outside 24H window).
    
    function isSnapshotExpired(NAVSnapshot memory snapshot) internal view returns (bool expired){
        expired = block.timestamp - snapshot.timestamp > NAV_DROP_WINDOW;
    }
    
    /// @notice Builds a fresh NAVSnapshot from current price and block timestamp.
    function buildSnapshot(int256 currentPrice) internal view returns (NAVSnapshot memory snapshot) {
        if (currentPrice <= 0) revert ZeroPrice();
        snapshot = NAVSnapshot({
            price:     currentPrice,
            timestamp: uint40(block.timestamp)
        });
    }

    /// @notice Computes total protocol NAV — token supply * current NAV price.
    function computeTotalNAV(uint256 totalSupply, int256 navPrice, uint8 navDecimals) internal pure returns (uint256 totalNAV) {
        if (navPrice <= 0) revert ZeroPrice();

        int256 normalizedPrice = normalizeDecimals(navPrice, navDecimals, 18);

        totalNAV = (totalSupply * uint256(normalizedPrice)) / 1e18;
    }
}
