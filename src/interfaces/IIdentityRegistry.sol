// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { JurisdictionLib } from "../libraries/JurisdictionLib.sol";

/// @title IIdentityRegistry
/// @notice Interface for the Nexus RWA ERC-3643 compliant Identity Registry.
/// @dev Acts as the central identity, KYC, and accreditation verification hub.
interface IIdentityRegistry {

    //==================================================
    // ENUMS
    //==================================================

    /// @notice Defines the level of verification an investor has completed.
    enum VerificationTier {
        NONE,           // Unregistered / Unknown
        BASIC,          // Standard KYC (Name, Email, ID)
        KYC,            // Advanced KYC (Proof of Address, Biometrics)
        ACCREDITED,     // Verified High-Net-Worth Individual
        INSTITUTIONAL   // Verified Corporate/Institutional Entity
    }

    //==================================================
    // STRUCTS
    //==================================================

    /// @notice The authoritative on-chain identity record.
    /// @dev Optimized for 3 EVM storage slots.
    struct Identity {
        address          wallet;
        VerificationTier tier;
        uint16           countryCode;
        bool             isAccredited;
        uint40           kycExpiry;
        uint40           registeredAt;
        bool             isActive;
        bytes32          identityHash; // Cryptographic commitment to off-chain PII data
    }

    //==================================================
    // ERRORS
    //==================================================

    error ZeroAddress();
    error ZeroHash();
    error IdentityAlreadyRegistered(address wallet);
    error IdentityNotRegistered(address wallet);
    error IdentityNotActive(address wallet);
    error IdentityExpired(address wallet, uint40 expiredAt);
    error InvalidCountryCode(uint16 code);
    error InvalidTier(VerificationTier tier);
    error InvalidKYCExpiry(uint40 expiry);
    error SanctionedJurisdiction(uint16 countryCode);
    error OnlyVerifier();
    error TierDowngradeNotAllowed(VerificationTier current, VerificationTier requested);

    //==================================================
    // EVENTS
    //==================================================

    event IdentityRegistered(address indexed wallet, uint16 countryCode, VerificationTier tier, bytes32 identityHash);
    event TierUpgraded(address indexed wallet, VerificationTier oldTier, VerificationTier newTier);
    event KYCRenewed(address indexed wallet, uint40 oldExpiry, uint40 newExpiry);
    event IdentityDeactivated(address indexed wallet, address indexed by);
    event IdentityReactivated(address indexed wallet, address indexed by);
    event CountryCodeUpdated(address indexed wallet, uint16 oldCode, uint16 newCode);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    //==================================================
    // IDENTITY MANAGEMENT
    //==================================================

    /// @notice Registers a new investor identity on-chain.
    function registerIdentity(
        address          wallet,
        uint16           countryCode,
        VerificationTier tier,
        bool             isAccredited,
        uint40           kycExpiry,
        bytes32          identityHash
    ) external;

    /// @notice Upgrades the verification tier of an existing active identity.
    function upgradeTier(address wallet, VerificationTier newTier) external;

    /// @notice Renews the KYC expiration timestamp for an active identity.
    function renewKYC(address wallet, uint40 newExpiry) external;

    /// @notice Updates the physical jurisdiction code of an investor.
    function updateCountryCode(address wallet, uint16 newCode) external;

    /// @notice Temporarily disables an identity, revoking all protocol access.
    function deactivateIdentity(address wallet) external;

    /// @notice Restores access for a previously deactivated identity.
    function reactivateIdentity(address wallet) external;

    //==================================================
    // COMPLIANCE CHECKS
    //==================================================

    /// @notice Asserts full identity compliance. Reverts if constraints fail.
    function enforceIdentityCompliance(address wallet) external view;

    /// @notice Evaluates identity compliance safely without reverting.
    function isIdentityCompliant(address wallet) external view returns (bool ok);

    /// @notice Validates if an investor meets or exceeds a specific verification tier.
    function meetsTier(address wallet, VerificationTier minTier) external view returns (bool meets);

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    /// @notice Updates the designated identity verification authority.
    function setVerifier(address newVerifier) external;

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    /// @notice Retrieves the complete identity record for a given wallet.
    function getIdentity(address wallet) external view returns (Identity memory);

    /// @notice Translates the Identity record into the core JurisdictionLib format.
    function getInvestorData(address wallet) external view returns (JurisdictionLib.InvestorData memory);

    /// @notice Returns the current verification tier of an investor.
    function getTier(address wallet) external view returns (VerificationTier);

    /// @notice Checks if an address possesses a registered identity record.
    function isRegistered(address wallet) external view returns (bool);

    /// @notice Returns the address currently holding the Verifier role.
    function getVerifier() external view returns (address);
}