// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable }              from "@openzeppelin/contracts/utils/Pausable.sol";
import { IIdentityRegistry }     from "../interfaces/IIdentityRegistry.sol";
import { JurisdictionLib }       from "../libraries/JurisdictionLib.sol";

/// @title IdentityRegistry
/// @notice Core on-chain identity management for the Nexus RWA Protocol.
/// @dev Implements strict state management for KYC, accreditations, and jurisdictions.
///      Designed for gas efficiency via storage packing. Contains no external calls in mutative paths.
contract IdentityRegistry is IIdentityRegistry, Ownable2Step, Pausable {

    //==================================================
    // STORAGE
    //==================================================

    mapping(address => Identity) private s_identities;
    address private s_verifier;

    //==================================================
    // MODIFIERS
    //==================================================

    modifier onlyVerifier() {
        if (msg.sender != s_verifier && msg.sender != owner()) revert OnlyVerifier();
        _;
    }

    modifier identityExists(address wallet) {
        if (s_identities[wallet].tier == VerificationTier.NONE) revert IdentityNotRegistered(wallet);
        _;
    }

    modifier identityActive(address wallet) {
        if (!s_identities[wallet].isActive) revert IdentityNotActive(wallet);
        _;
    }

    //==================================================
    // CONSTRUCTOR
    //==================================================

    constructor(address verifier_) Ownable(msg.sender) {
        if (verifier_ == address(0)) revert ZeroAddress();
        s_verifier = verifier_;
    }

    //==================================================
    // IDENTITY MANAGEMENT
    //==================================================

    /// @inheritdoc IIdentityRegistry
    function registerIdentity(
        address          wallet,
        uint16           countryCode,
        VerificationTier tier,
        bool             isAccredited,
        uint40           kycExpiry,
        bytes32          identityHash
    )
        external
        override
        onlyVerifier
        whenNotPaused
    {
        if (wallet       == address(0)) revert ZeroAddress();
        if (identityHash == bytes32(0)) revert ZeroHash();
        if (tier         == VerificationTier.NONE) revert InvalidTier(tier);
        if (kycExpiry    <= uint40(block.timestamp)) revert InvalidKYCExpiry(kycExpiry);
        if (s_identities[wallet].tier != VerificationTier.NONE) revert IdentityAlreadyRegistered(wallet);

        JurisdictionLib.validateCountryCode(countryCode);
        JurisdictionLib.enforceSanctionCheck(countryCode);

        s_identities[wallet] = Identity({
            wallet:       wallet,
            tier:         tier,
            countryCode:  countryCode,
            isAccredited: isAccredited,
            kycExpiry:    kycExpiry,
            registeredAt: uint40(block.timestamp),
            isActive:     true,
            identityHash: identityHash
        });

        emit IdentityRegistered(wallet, countryCode, tier, identityHash);
    }

    /// @inheritdoc IIdentityRegistry
    function upgradeTier(address wallet, VerificationTier newTier)
        external
        override
        onlyVerifier
        whenNotPaused
        identityExists(wallet)
        identityActive(wallet)
    {
        if (newTier == VerificationTier.NONE) revert InvalidTier(newTier);

        VerificationTier current = s_identities[wallet].tier;
        if (uint8(newTier) <= uint8(current)) {
            revert TierDowngradeNotAllowed(current, newTier);
        }

        s_identities[wallet].tier         = newTier;
        s_identities[wallet].isAccredited = newTier >= VerificationTier.ACCREDITED;

        emit TierUpgraded(wallet, current, newTier);
    }

    /// @inheritdoc IIdentityRegistry
    function renewKYC(address wallet, uint40 newExpiry)
        external
        override
        onlyVerifier
        whenNotPaused
        identityExists(wallet)
        identityActive(wallet)
    {
        if (newExpiry <= uint40(block.timestamp)) revert InvalidKYCExpiry(newExpiry);

        uint40 oldExpiry = s_identities[wallet].kycExpiry;
        s_identities[wallet].kycExpiry = newExpiry;

        emit KYCRenewed(wallet, oldExpiry, newExpiry);
    }

    /// @inheritdoc IIdentityRegistry
    function updateCountryCode(address wallet, uint16 newCode)
        external
        override
        onlyVerifier
        whenNotPaused
        identityExists(wallet)
        identityActive(wallet)
    {
        JurisdictionLib.validateCountryCode(newCode);
        JurisdictionLib.enforceSanctionCheck(newCode);

        uint16 oldCode = s_identities[wallet].countryCode;
        s_identities[wallet].countryCode = newCode;

        emit CountryCodeUpdated(wallet, oldCode, newCode);
    }

    /// @inheritdoc IIdentityRegistry
    function deactivateIdentity(address wallet)
        external
        override
        onlyVerifier
        whenNotPaused
        identityExists(wallet)
    {
        if (!s_identities[wallet].isActive) revert IdentityNotActive(wallet);

        s_identities[wallet].isActive = false;
        emit IdentityDeactivated(wallet, msg.sender);
    }

    /// @inheritdoc IIdentityRegistry
    function reactivateIdentity(address wallet)
        external
        override
        onlyVerifier
        whenNotPaused
        identityExists(wallet)
    {
        if (s_identities[wallet].isActive) revert IdentityNotActive(wallet);

        s_identities[wallet].isActive = true;
        emit IdentityReactivated(wallet, msg.sender);
    }

    //==================================================
    // COMPLIANCE CHECKS
    //==================================================

    /// @inheritdoc IIdentityRegistry
    function enforceIdentityCompliance(address wallet) external view override {
        Identity storage id = s_identities[wallet];

        if (id.tier == VerificationTier.NONE) revert IdentityNotRegistered(wallet);
        if (!id.isActive) revert IdentityNotActive(wallet);
        if (block.timestamp > id.kycExpiry) revert IdentityExpired(wallet, id.kycExpiry);

        JurisdictionLib.enforceSanctionCheck(id.countryCode);
    }

    /// @inheritdoc IIdentityRegistry
    function isIdentityCompliant(address wallet) external view override returns (bool) {
        Identity storage id = s_identities[wallet];

        if (id.tier == VerificationTier.NONE)              return false;
        if (!id.isActive)                                  return false;
        if (block.timestamp > id.kycExpiry)                return false;
        if (JurisdictionLib.isSanctionedJurisdiction(id.countryCode)) return false;

        return true;
    }

    /// @inheritdoc IIdentityRegistry
    function meetsTier(address wallet, VerificationTier minTier) external view override returns (bool) {
        Identity storage id = s_identities[wallet];
        if (!id.isActive) return false;
        return uint8(id.tier) >= uint8(minTier);
    }

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    /// @inheritdoc IIdentityRegistry
    function setVerifier(address newVerifier) external override onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        address old = s_verifier;
        s_verifier  = newVerifier;
        emit VerifierUpdated(old, newVerifier);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    /// @inheritdoc IIdentityRegistry
    function getIdentity(address wallet) external view override returns (Identity memory) {
        return s_identities[wallet];
    }

    /// @inheritdoc IIdentityRegistry
    function getInvestorData(address wallet) external view override returns (JurisdictionLib.InvestorData memory) {
        Identity storage id = s_identities[wallet];
        return JurisdictionLib.InvestorData({
            countryCode:   id.countryCode,
            isAccredited:  id.isAccredited,
            isKYCVerified: id.isActive && block.timestamp <= id.kycExpiry,
            kycExpiry:     id.kycExpiry,
            registeredAt:  id.registeredAt
        });
    }

    /// @inheritdoc IIdentityRegistry
    function getTier(address wallet) external view override returns (VerificationTier) {
        return s_identities[wallet].tier;
    }

    /// @inheritdoc IIdentityRegistry
    function isRegistered(address wallet) external view override returns (bool) {
        return s_identities[wallet].tier != VerificationTier.NONE;
    }

    /// @inheritdoc IIdentityRegistry
    function getVerifier() external view override returns (address) {
        return s_verifier;
    }
}