// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable }              from "@openzeppelin/contracts/utils/Pausable.sol";
import { IAssetRegistry }        from "../interfaces/IAssetRegistry.sol";
import { JurisdictionLib }       from "../libraries/JurisdictionLib.sol";

/// @title AssetRegistry
/// @notice Central registry for RWA assets — KYC, jurisdiction, supply cap enforcement.
/// @dev Ownable2Step + Pausable. No external calls in state-changing paths.
contract AssetRegistry is IAssetRegistry, Ownable2Step, Pausable {

    //==================================================
    // STORAGE
    //==================================================

    /// @dev assetId => AssetInfo
    mapping(bytes32 => AssetInfo) private s_assets;
 
    /// @dev assetId => investor => whitelisted
    mapping(bytes32 => mapping(address => bool)) private s_whitelist;

    /// @dev investor => global KYC data (shared across all assets)
    mapping(address => JurisdictionLib.InvestorData) private s_investorData;

    /// @dev assetId → jurisdiction rule
    mapping(bytes32 => JurisdictionLib.AssetJurisdictionRule) private s_jurisdictionRules;

    /// @dev address authorized to register assets (protocol deployer / multisig)
    address private s_registrar;

    /// @dev ComplianceEngine contract address
    address private s_complianceEngine;

    //==================================================
    // MODIFIERS
    //==================================================

    /// @dev Reverts if caller is not registrar or owner.
    modifier onlyRegistrar() {
        if (msg.sender != s_registrar && msg.sender != owner()) revert OnlyRegistrar();
        _;
    }

    /// @dev Reverts if caller is not compliance engine or owner.
    modifier onlyCompliance() {
        if (msg.sender != s_complianceEngine && msg.sender != owner()) revert OnlyCompliance();
        _;
    }

    /// @dev Reverts if asset is not registered.
    modifier assetRegistered(bytes32 assetId) {
        if (s_assets[assetId].status == AssetStatus.NONE) revert AssetNotRegistered(assetId);
        _;
    }

    /// @dev Reverts if asset is not in ACTIVE status.
    modifier assetActive(bytes32 assetId) {
        AssetStatus status = s_assets[assetId].status;
        if (status != AssetStatus.ACTIVE) revert AssetNotActive(assetId, status);
        _;
    }

    /// @dev Reverts if asset is frozen.
    modifier notFrozen(bytes32 assetId) {
        if (s_assets[assetId].status == AssetStatus.FROZEN) revert AssetFrozen(assetId);
        _;
    }

    //==================================================
    // CONSTRUCTOR
    //==================================================

    /// @param registrar  Address authorized to register assets
    /// @param compliance ComplianceEngine contract address
    constructor(address registrar, address compliance) Ownable(msg.sender){
        if (registrar  == address(0)) revert ZeroAddress();
        if (compliance == address(0)) revert ZeroAddress();
        s_registrar        = registrar;
        s_complianceEngine = compliance;
    } 

    //==================================================
    // ASSET MANAGEMENT
    //==================================================

    /// @notice Registers a new RWA asset in the protocol.
    function registerAsset(
        bytes32   assetId,
        address   token,
        AssetType assetType,
        uint16    issuerCountryCode,
        bool      allowAllJurisdictions,
        uint8     minAccreditationLevel,
        uint256   totalSupplyCap,
        uint40    maturityDate
    )   
        external
        override
        onlyRegistrar
        whenNotPaused
    {   
        if (token == address(0))                             revert ZeroAddress();
        if (totalSupplyCap == 0)                             revert ZeroValue();
        if (assetType == AssetType.NONE)                     revert InvalidAssetType();
        if (s_assets[assetId].status != AssetStatus.NONE)    revert AssetAlreadyRegistered(assetId);
        if (maturityDate != 0 && maturityDate <= uint40(block.timestamp)) {
            revert InvalidMaturityDate(maturityDate);
        }

        JurisdictionLib.validateCountryCode(issuerCountryCode);
        JurisdictionLib.enforceSanctionCheck(issuerCountryCode);

        s_assets[assetId] = AssetInfo({
            assetId:               assetId,
            token:                 token,
            status:                AssetStatus.ACTIVE,
            assetType:             assetType,
            decimals:              18,
            issuerCountryCode:     issuerCountryCode,
            allowAllJurisdictions: allowAllJurisdictions,
            minAccreditationLevel: minAccreditationLevel,
            totalSupplyCap:        totalSupplyCap,
            mintedSupply:          0,
            registeredAt:          uint40(block.timestamp),
            maturityDate:          maturityDate
        });

        s_jurisdictionRules[assetId] = JurisdictionLib.AssetJurisdictionRule({
            allowAllJurisdictions:  allowAllJurisdictions,
            issuerCountryCode:      issuerCountryCode,
            minAccreditationLevel:  minAccreditationLevel
        });

        emit AssetRegistered(
            assetId,
            token,
            assetType,
            issuerCountryCode,
            totalSupplyCap,
            maturityDate
        );
    }

    /// @notice Updates the lifecycle status of a registered asset.
    function updateAssetStatus(bytes32 assetId, AssetStatus newStatus)
        external
        override
        onlyRegistrar
        whenNotPaused
        assetRegistered(assetId)
    {
        AssetStatus current = s_assets[assetId].status;
        if(current == AssetStatus.REDEEMED) revert AssetRedeemed(assetId);
        if(newStatus == AssetStatus.NONE) revert InvalidAssetStatus();

        s_assets[assetId].status = newStatus;

        emit AssetStatusUpdated(assetId, current, newStatus);
    }    

    /// @notice Updates the supply cap — cannot go below already minted supply.
    function updateSupplyCap(bytes32 assetId, uint256 newCap)
        external
        override
        onlyRegistrar
        whenNotPaused
        assetRegistered(assetId)
    {
        if (newCap == 0) revert ZeroValue();

        uint256 minted = s_assets[assetId].mintedSupply;
        if (newCap < minted) revert NewCapBelowMinted(assetId, minted, newCap);

        uint256 oldCap = s_assets[assetId].totalSupplyCap;
        s_assets[assetId].totalSupplyCap = newCap;

        emit SupplyCapUpdated(assetId, oldCap, newCap);
    }

    /// @notice Updates jurisdiction rules for a registered asset.
    function updateJurisdictionRule(
        bytes32 assetId,
        uint16  issuerCountryCode,
        bool    allowAllJurisdictions,
        uint8   minAccreditationLevel
    ) 
        external 
        override
        onlyRegistrar
        whenNotPaused
        assetRegistered(assetId)
    {
        JurisdictionLib.validateCountryCode(issuerCountryCode);
        JurisdictionLib.enforceSanctionCheck(issuerCountryCode);

        s_assets[assetId].issuerCountryCode     = issuerCountryCode;
        s_assets[assetId].allowAllJurisdictions = allowAllJurisdictions;
        s_assets[assetId].minAccreditationLevel = minAccreditationLevel;

        s_jurisdictionRules[assetId] = JurisdictionLib.AssetJurisdictionRule({
               allowAllJurisdictions : allowAllJurisdictions,
               issuerCountryCode     : issuerCountryCode,
               minAccreditationLevel : minAccreditationLevel
        });

        emit JurisdictionRuleUpdated(
            assetId,
            issuerCountryCode,
            allowAllJurisdictions,
            minAccreditationLevel
        );
    }    

    /// @notice Called by RWAToken on mint — increments minted supply counter.
    function recordMint(bytes32 assetId, uint256 amount)
        external
        override
        whenNotPaused
        assetActive(assetId)
    {
        if(amount == 0) revert ZeroValue();
        if(msg.sender != s_assets[assetId].token) {
            revert TokenMismatch(assetId, s_assets[assetId].token, msg.sender);
        }

        uint256 newSupply = s_assets[assetId].mintedSupply + amount;
        if(newSupply > s_assets[assetId].totalSupplyCap) {
            revert SupplyCapExceeded(assetId, s_assets[assetId].totalSupplyCap, newSupply);
        }

        uint40 maturity = s_assets[assetId].maturityDate;
        if(maturity != 0 && uint40(block.timestamp) >= maturity){
            revert AssetMatured(assetId, maturity);
        }

        uint256 oldSupply = s_assets[assetId].mintedSupply;
        s_assets[assetId].mintedSupply = newSupply;
        emit MintedSupplyUpdated(assetId, oldSupply, newSupply);
    }    

    /// @notice Called by RWAToken on burn — decrements minted supply counter.
    function recordBurn(bytes32 assetId, uint256 amount)
        external
        override
        whenNotPaused
        assetRegistered(assetId)
    {
        if(amount == 0) revert ZeroValue();
        if(msg.sender != s_assets[assetId].token) {
            revert TokenMismatch(assetId, s_assets[assetId].token, msg.sender);
        }

        uint256 oldSupply = s_assets[assetId].mintedSupply;

        unchecked {
            s_assets[assetId].mintedSupply = oldSupply - amount;
        }

        emit MintedSupplyUpdated(assetId, oldSupply, oldSupply - amount);
    }    

    //==================================================
    // INVESTOR MANAGEMENT
    //==================================================

    /// @notice Whitelists an investor for a specific asset with KYC data.
    function whitelistInvestor(
        bytes32 assetId,
        address investor,
        uint16  countryCode,
        bool    isAccredited
    ) 
        external
        override
        onlyRegistrar
        whenNotPaused
        assetRegistered(assetId)
    {
        if(investor == address(0)) revert ZeroAddress();
        if(s_whitelist[assetId][investor]) revert InvestorAlreadyWhitelisted(assetId,investor);

        JurisdictionLib.validateCountryCode(countryCode);
        JurisdictionLib.enforceSanctionCheck(countryCode);

        s_whitelist[assetId][investor] = true;

        uint40 expiry = JurisdictionLib.computeKYCExpiry(uint40(block.timestamp));
        s_investorData[investor] = JurisdictionLib.InvestorData({
            countryCode    : countryCode,
            isAccredited   : isAccredited,
            isKYCVerified  : true,
            kycExpiry      : expiry,
            registeredAt   : uint40(block.timestamp)
        });

        emit InvestorWhitelisted(assetId, investor, countryCode, isAccredited);
    }    

    /// @notice Removes an investor from whitelist for a specific asset.
    function removeInvestor(bytes32 assetId, address investor) 
        external
        override
        onlyRegistrar
        whenNotPaused
        assetRegistered(assetId)
    {
        if(investor == address(0)) revert ZeroAddress();
        if(!s_whitelist[assetId][investor]) revert InvestorNotWhitelisted(assetId, investor);

        s_whitelist[assetId][investor] = false;

        emit InvestorRemoved(assetId, investor);
    } 

    /// @notice Updates KYC data for an investor globally.
    function updateInvestorKYC(
        address investor,
        uint16  countryCode,
        bool    isAccredited,
        uint40  kycExpiry
    ) 
        external
        override
        onlyRegistrar
        whenNotPaused
    {
        if(investor == address(0)) revert ZeroAddress();
        if(kycExpiry <= uint40(block.timestamp)) revert InvalidKYCExpiry(kycExpiry);

        JurisdictionLib.validateCountryCode(countryCode);
        JurisdictionLib.enforceSanctionCheck(countryCode);

        s_investorData[investor].countryCode   = countryCode;
        s_investorData[investor].isAccredited  = isAccredited;
        s_investorData[investor].isKYCVerified = true;
        s_investorData[investor].kycExpiry     = kycExpiry;

        emit InvestorKYCUpdated(investor, countryCode, isAccredited, kycExpiry);
    }

    //==================================================
    // COMPLIANCE ACTIONS
    //==================================================

    /// @notice Freezes asset — halts all transfers. Only compliance engine.
    function freezeAsset(bytes32 assetId)
        external
        override
        onlyCompliance
        whenNotPaused
        assetRegistered(assetId)
    {
        if(s_assets[assetId].status == AssetStatus.REDEEMED) revert AssetRedeemed(assetId);
        if(s_assets[assetId].status == AssetStatus.FROZEN)   revert AssetFrozen(assetId);

        s_assets[assetId].status = AssetStatus.FROZEN;

        emit AssetFrozenEvent(assetId, msg.sender);
    }    

    /// @notice Unfreezes asset. Only compliance engine.
    function unfreezeAsset(bytes32 assetId)
        external    
        override
        onlyCompliance
        whenNotPaused
        assetRegistered(assetId)
    {
        if (s_assets[assetId].status != AssetStatus.FROZEN) revert AssetNotActive(assetId, s_assets[assetId].status);
        
        s_assets[assetId].status = AssetStatus.ACTIVE;

        emit AssetUnfrozen(assetId, msg.sender);
    }

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    /// @notice Updates the registrar address.
    function setRegistrar(address newRegistrar) external onlyOwner {
        if (newRegistrar == address(0)) revert ZeroAddress();
        address old = s_registrar;
        s_registrar = newRegistrar;
        emit RegistrarUpdated(old, newRegistrar);
    }

    /// @notice Updates the compliance engine address.
    function setComplianceEngine(address newEngine) external onlyOwner {
        if (newEngine == address(0)) revert ZeroAddress();
        address old = s_complianceEngine;
        s_complianceEngine = newEngine;
        emit ComplianceEngineUpdated(old, newEngine);
    }

    /// @notice Pauses all state-changing functions.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses all state-changing functions.
    function unpause() external onlyOwner {
        _unpause();
    }

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    /// @notice Returns full asset info struct.
    function getAssetInfo(bytes32 assetId)
        external
        view
        override
        returns (AssetInfo memory info)
    {
        info = s_assets[assetId];
    }

    /// @notice Returns jurisdiction rule for asset.
    function getJurisdictionRule(bytes32 assetId)
        external
        view
        override
        returns (JurisdictionLib.AssetJurisdictionRule memory rule)
    {
        rule = s_jurisdictionRules[assetId];
    }

    /// @notice Returns KYC data for investor.
    function getInvestorData(address investor)
        external
        view
        override
        returns (JurisdictionLib.InvestorData memory data)
    {
        data = s_investorData[investor];
    }

    /// @notice Returns true if investor is whitelisted for asset.
    function isWhitelisted(bytes32 assetId, address investor)
        external
        view
        override
        returns (bool)
    {
        return s_whitelist[assetId][investor];
    }

    /// @notice Returns true if asset is ACTIVE and not matured.
    function isAssetActive(bytes32 assetId)
        external
        view
        override
        returns (bool)
    {
        AssetInfo storage info = s_assets[assetId];
        if (info.status != AssetStatus.ACTIVE) return false;
        if (info.maturityDate != 0 && uint40(block.timestamp) >= info.maturityDate) return false;
        return true;
    }

    /// @notice Returns true if mint amount is within supply cap.
    function isMintAllowed(bytes32 assetId, uint256 amount)
        external
        view
        override
        returns (bool)
    {
        AssetInfo storage info = s_assets[assetId];
        return (info.mintedSupply + amount) <= info.totalSupplyCap;
    }

    /// @notice Returns current minted supply for asset.
    function getMintedSupply(bytes32 assetId)
        external
        view
        override
        returns (uint256)
    {
        return s_assets[assetId].mintedSupply;
    }

    /// @notice Returns compliance engine address.
    function getComplianceEngine() external view override returns (address) {
        return s_complianceEngine;
    }

    /// @notice Returns registrar address.
    function getRegistrar() external view override returns (address) {
        return s_registrar;
    }
}