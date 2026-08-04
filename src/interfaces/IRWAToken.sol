// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface for the Nexus RWA compliant ERC-20 token.
interface IRWAToken {

    //==================================================
    // ERRORS
    //==================================================

    error ZeroAddress();
    error ZeroAmount();
    error TransferRestricted(address from, address to);
    error NotWhitelisted(address account);
    error CallerNotRegistry();
    error CallerNotCompliance();
    error TokenPaused();
    error AssetNotActive(bytes32 assetId);
    error ForcedTransferFailed(address from, address to, uint256 amount);
    error BurnExceedsBalance(address account, uint256 balance, uint256 amount);
    error MintCapExceeded(bytes32 assetId, uint256 cap, uint256 requested);

    //==================================================
    // EVENTS
    //==================================================

    event Minted(bytes32 indexed assetId, address indexed to, uint256 amount);
    event Burned(bytes32 indexed assetId, address indexed from, uint256 amount);
    event ForcedTransfer(bytes32 indexed assetId, address indexed from, address indexed to, uint256 amount);
    event ComplianceEngineUpdated(address indexed oldEngine, address indexed newEngine);
    event AssetRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    //==================================================
    // CORE FUNCTIONS
    //==================================================

    /// @notice Mints tokens to a whitelisted investor.
    function mint(address to, uint256 amount) external;

    /// @notice Burns tokens from an investor upon redemption.
    function burn(address from, uint256 amount) external;

    /// @notice Moves tokens legally bypassing whitelist checks.
    function forcedTransfer(address from, address to, uint256 amount) external;

    //==================================================
    // ADMIN & VIEW FUNCTIONS
    //==================================================

    function pause() external;
    function unpause() external;
    function setComplianceEngine(address newEngine) external;
    function setAssetRegistry(address newRegistry) external;

    function assetId() external view returns (bytes32);
    function getAssetRegistry() external view returns (address);
    function getComplianceEngine() external view returns (address);
    function isWhitelisted(address account) external view returns (bool);
}