// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard }       from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IComplianceEngine }     from "../interfaces/IComplianceEngine.sol";
import { IAssetRegistry }        from "../interfaces/IAssetRegistry.sol";
import { IRWAToken }             from "../interfaces/IRWAToken.sol";
import { JurisdictionLib }       from "../libraries/JurisdictionLib.sol";

/// @title ComplianceEngine
/// @notice Central compliance authority for Nexus RWA Protocol.
/// @dev Manages global blacklists, asset freezes, forced transfers, and delegates 
///      jurisdictional validation to the JurisdictionLib.
contract ComplianceEngine is IComplianceEngine, Ownable2Step, ReentrancyGuard {

    //==================================================
    // STORAGE
    //==================================================

    /// @notice Tracks globally blocked investors (investor => isBlocked)
    mapping(address => bool) private s_blocked;
    
    /// @notice Address of the core Asset Registry
    address private s_assetRegistry;
    
    /// @notice Address holding the exclusive Compliance Officer role
    address private s_complianceOfficer;

    //==================================================
    // MODIFIERS
    //==================================================

    /// @dev Restricts execution to the designated Compliance Officer or the Contract Owner.
    modifier onlyOfficer() {
        if (msg.sender != s_complianceOfficer && msg.sender != owner()) {
            revert OnlyComplianceOfficer();
        }
        _;
    }

    //==================================================
    // CONSTRUCTOR
    //==================================================

    constructor(address assetRegistry_, address complianceOfficer_) Ownable(msg.sender) {
        if (assetRegistry_     == address(0)) revert ZeroAddress();
        if (complianceOfficer_ == address(0)) revert ZeroAddress();
        
        s_assetRegistry     = assetRegistry_;
        s_complianceOfficer = complianceOfficer_;
    }

    //==================================================
    // TRANSFER COMPLIANCE
    //==================================================

    /// @inheritdoc IComplianceEngine
    function enforceTransferCompliance(
        bytes32 assetId,
        address from,
        address to
    ) external view override {
        if (from == to) revert SelfTransfer(from);
        if (s_blocked[from]) revert BlockedInvestor(from);
        if (s_blocked[to])   revert BlockedInvestor(to);

        IAssetRegistry registry = IAssetRegistry(s_assetRegistry);

        if (!registry.isWhitelisted(assetId, from)) revert TransferNotCompliant(from, to, assetId);
        if (!registry.isWhitelisted(assetId, to))   revert TransferNotCompliant(from, to, assetId);
        if (!registry.isAssetActive(assetId)) revert AssetNotRegistered(assetId);

        JurisdictionLib.InvestorData memory fromData = registry.getInvestorData(from);
        JurisdictionLib.InvestorData memory toData   = registry.getInvestorData(to);
        JurisdictionLib.AssetJurisdictionRule memory rule = registry.getJurisdictionRule(assetId);

        bool isCompliant = JurisdictionLib.checkTransferCompliance(from, to, fromData, toData, rule);
        if (!isCompliant) {
            revert TransferNotCompliant(from, to, assetId);
        }
    }

    /// @inheritdoc IComplianceEngine
    function canTransfer(
        bytes32 assetId,
        address from,
        address to
    ) external view override returns (bool ok) {
        if (from == to)        return false;
        if (s_blocked[from])   return false;
        if (s_blocked[to])     return false;

        IAssetRegistry registry = IAssetRegistry(s_assetRegistry);

        if (!registry.isWhitelisted(assetId, from)) return false;
        if (!registry.isWhitelisted(assetId, to))   return false;
        if (!registry.isAssetActive(assetId))       return false;

        JurisdictionLib.InvestorData memory fromData = registry.getInvestorData(from);
        JurisdictionLib.InvestorData memory toData   = registry.getInvestorData(to);
        JurisdictionLib.AssetJurisdictionRule memory rule = registry.getJurisdictionRule(assetId);

        return JurisdictionLib.canTransferView(from, to, fromData, toData, rule);
    }

    //==================================================
    // INVESTOR CONTROLS
    //==================================================

    /// @inheritdoc IComplianceEngine
    function blockInvestor(address investor) external override onlyOfficer {
        if (investor == address(0))  revert ZeroAddress();
        if (s_blocked[investor])     revert InvestorAlreadyBlocked(investor);

        s_blocked[investor] = true;
        emit InvestorBlocked(investor, msg.sender);
    }

    /// @inheritdoc IComplianceEngine
    function unblockInvestor(address investor) external override onlyOfficer {
        if (investor == address(0)) revert ZeroAddress();
        if (!s_blocked[investor])   revert InvestorNotBlocked(investor);

        s_blocked[investor] = false;
        emit InvestorUnblocked(investor, msg.sender);
    }

    //==================================================
    // ASSET CONTROLS
    //==================================================

    /// @inheritdoc IComplianceEngine
    function freezeAsset(bytes32 assetId) external override onlyOfficer {
        if (assetId == bytes32(0)) revert AssetNotRegistered(assetId);

        emit AssetFrozen(assetId, msg.sender);
        
        // Interaction after Effect (CEI)
        IAssetRegistry(s_assetRegistry).freezeAsset(assetId);
    }

    /// @inheritdoc IComplianceEngine
    function unfreezeAsset(bytes32 assetId) external override onlyOfficer {
        if (assetId == bytes32(0)) revert AssetNotRegistered(assetId);

        emit AssetUnfrozen(assetId, msg.sender);
        
        // Interaction after Effect (CEI)
        IAssetRegistry(s_assetRegistry).unfreezeAsset(assetId);
    }

    //==================================================
    // FORCED TRANSFER
    //==================================================

    /// @inheritdoc IComplianceEngine
    function executeForcedTransfer(
        bytes32 assetId,
        address token,
        address from,
        address to,
        uint256 amount
    ) external override onlyOfficer nonReentrant {
        if (token   == address(0))  revert ZeroAddress();
        if (from    == address(0))  revert ZeroAddress();
        if (to      == address(0))  revert ZeroAddress();
        if (amount  == 0)           revert ZeroAmount();
        if (from    == to)          revert SelfTransfer(from);
        if (assetId == bytes32(0))  revert AssetNotRegistered(assetId);

        // Security Check: Verify token actually belongs to the assetId
        if (IRWAToken(token).assetId() != assetId) {
            revert AssetNotRegistered(assetId);
        }

        emit ForcedTransferExecuted(assetId, from, to, amount);
        
        // External call strictly at the end (CEI)
        IRWAToken(token).forcedTransfer(from, to, amount);
    }

    //==================================================
    // ADMIN & VIEW FUNCTIONS
    //==================================================

    /// @inheritdoc IComplianceEngine
    function setComplianceOfficer(address newOfficer) external override onlyOwner {
        if (newOfficer == address(0)) revert ZeroAddress();
        address old         = s_complianceOfficer;
        s_complianceOfficer = newOfficer;
        emit ComplianceOfficerUpdated(old, newOfficer);
    }

    /// @inheritdoc IComplianceEngine
    function setAssetRegistry(address newRegistry) external override onlyOwner {
        if (newRegistry == address(0)) revert ZeroAddress();
        address old     = s_assetRegistry;
        s_assetRegistry = newRegistry;
        emit AssetRegistryUpdated(old, newRegistry);
    }

    /// @inheritdoc IComplianceEngine
    function isBlocked(address investor) external view override returns (bool) {
        return s_blocked[investor];
    }

    /// @inheritdoc IComplianceEngine
    function getComplianceOfficer() external view override returns (address) {
        return s_complianceOfficer;
    }

    /// @inheritdoc IComplianceEngine
    function getAssetRegistry() external view override returns (address) {
        return s_assetRegistry;
    }
}
