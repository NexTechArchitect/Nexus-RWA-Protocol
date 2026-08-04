// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { JurisdictionLib } from "../libraries/JurisdictionLib.sol";

/// @title IAssetRegistry
/// @notice Interface for the Nexus RWA Asset Registry.
/// @dev Consumed by ComplianceEngine, RWAToken, and YieldDistributor.
interface IAssetRegistry {

    //=================================================
    // ENUMS
    //=================================================

    /// @notice Lifecycle state of a registered RWA asset.
    enum AssetStatus {
        NONE,       // 0 — Not registered
        ACTIVE,     // 1 — Live and tradeable
        PAUSED,     // 2 — Temporarily halted
        FROZEN,     // 3 — Compliance freeze
        REDEEMED    // 4 — Terminal state
    }

    /// @notice Type classification of the RWA asset.
    enum AssetType {
        NONE,
        T_BILL,
        REAL_ESTATE,
        CORPORATE_BOND,
        COMMODITY
    }

    //===================================================
    // STRUCTS
    //===================================================

    /// @notice Core metadata for a registered RWA asset.
    /// @dev Beautifully packed into 6 storage slots for gas optimization.
    struct AssetInfo {
        bytes32     assetId;
        address     token;
        AssetStatus status;
        AssetType   assetType;
        uint8       decimals;
        uint16      issuerCountryCode;
        bool        allowAllJurisdictions;
        uint8       minAccreditationLevel;
        uint256     totalSupplyCap;
        uint256     mintedSupply;
        uint40      registeredAt;
        uint40      maturityDate;
    }

    //==================================================
    // ERRORS
    //==================================================

    error ZeroAddress();
    error ZeroValue();
    error AssetAlreadyRegistered(bytes32 assetId);
    error AssetNotRegistered(bytes32 assetId);
    error AssetNotActive(bytes32 assetId, AssetStatus status);
    error AssetFrozen(bytes32 assetId);
    error AssetRedeemed(bytes32 assetId);
    error AssetMatured(bytes32 assetId, uint40 maturityDate);
    error SupplyCapExceeded(bytes32 assetId, uint256 cap, uint256 requested);
    
    error InvalidAssetType();
    error InvalidAssetStatus(); // Added for accurate status revert
    error InvalidCountryCode(uint16 code);
    error InvalidMaturityDate(uint40 maturityDate);
    error InvalidKYCExpiry(uint40 kycExpiry); // Added for accurate KYC revert
    
    error TokenMismatch(bytes32 assetId, address expected, address provided);
    error InvestorNotWhitelisted(bytes32 assetId, address investor);
    error InvestorAlreadyWhitelisted(bytes32 assetId, address investor);
    error OnlyCompliance();
    error OnlyRegistrar();
    error NewCapBelowMinted(bytes32 assetId, uint256 minted, uint256 newCap);
    
    //======================================================
    // EVENTS
    //======================================================

    event AssetRegistered(
        bytes32 indexed assetId,
        address indexed token,
        AssetType       assetType,
        uint16          issuerCountryCode,
        uint256         totalSupplyCap,
        uint40          maturityDate
    );

    event AssetStatusUpdated(bytes32 indexed assetId, AssetStatus oldStatus, AssetStatus newStatus);
    event SupplyCapUpdated(bytes32 indexed assetId, uint256 oldCap, uint256 newCap);
    event MintedSupplyUpdated(bytes32 indexed assetId, uint256 oldSupply, uint256 newSupply);
    
    event JurisdictionRuleUpdated(
        bytes32 indexed assetId,
        uint16          issuerCountryCode,
        bool            allowAllJurisdictions,
        uint8           minAccreditationLevel
    );

    event InvestorWhitelisted(bytes32 indexed assetId, address indexed investor, uint16 countryCode, bool isAccredited);
    event InvestorRemoved(bytes32 indexed assetId, address indexed investor);
    
    event InvestorKYCUpdated(address indexed investor, uint16 countryCode, bool isAccredited, uint40 kycExpiry);

    event AssetFrozenEvent(bytes32 indexed assetId, address indexed by);
    event AssetUnfrozen(bytes32 indexed assetId, address indexed by);
    
    event RegistrarUpdated(address indexed oldRegistrar, address indexed newRegistrar);
    event ComplianceEngineUpdated(address indexed oldEngine, address indexed newEngine);

    //==========================================================
    // ASSET MANAGEMENT
    //==========================================================

    /// @notice Registers a new RWA asset.
    function registerAsset(
        bytes32   assetId,
        address   token,
        AssetType assetType,
        uint16    issuerCountryCode,
        bool      allowAllJurisdictions,
        uint8     minAccreditationLevel,
        uint256   totalSupplyCap,
        uint40    maturityDate
    ) external;

    /// @notice Updates asset lifecycle status.
    function updateAssetStatus(bytes32 assetId, AssetStatus newStatus) external;

    /// @notice Updates supply cap (must be >= minted).
    function updateSupplyCap(bytes32 assetId, uint256 newCap) external;

    /// @notice Updates jurisdictional compliance rules.
    function updateJurisdictionRule(
        bytes32 assetId,
        uint16  issuerCountryCode,
        bool    allowAllJurisdictions,
        uint8   minAccreditationLevel
    ) external;

    /// @notice Increments minted supply (called by RWAToken).
    function recordMint(bytes32 assetId, uint256 amount) external;

    /// @notice Decrements minted supply (called by RWAToken).
    function recordBurn(bytes32 assetId, uint256 amount) external;

    //=======================================================
    // INVESTOR MANAGEMENT
    //=======================================================

    /// @notice Whitelists an investor for a specific asset.
    function whitelistInvestor(bytes32 assetId, address investor, uint16 countryCode, bool isAccredited) external;

    /// @notice Removes an investor from the asset's whitelist.
    function removeInvestor(bytes32 assetId, address investor) external;

    /// @notice Updates global KYC data for an investor.
    function updateInvestorKYC(address investor, uint16 countryCode, bool isAccredited, uint40 kycExpiry) external;

    //======================================================
    // COMPLIANCE ACTIONS
    //======================================================

    /// @notice Freezes the asset preventing token transfers.
    function freezeAsset(bytes32 assetId) external;

    /// @notice Lifts the freeze on the asset.
    function unfreezeAsset(bytes32 assetId) external;

    //=======================================================
    // VIEW FUNCTIONS
    //=======================================================

    function getAssetInfo(bytes32 assetId) external view returns (AssetInfo memory info);
    function getJurisdictionRule(bytes32 assetId) external view returns (JurisdictionLib.AssetJurisdictionRule memory rule);
    function getInvestorData(address investor) external view returns (JurisdictionLib.InvestorData memory data);
    
    function isWhitelisted(bytes32 assetId, address investor) external view returns (bool);
    function isAssetActive(bytes32 assetId) external view returns (bool);
    function isMintAllowed(bytes32 assetId, uint256 amount) external view returns (bool);
    
    function getMintedSupply(bytes32 assetId) external view returns (uint256);
    function getComplianceEngine() external view returns (address);
    function getRegistrar() external view returns (address);
}