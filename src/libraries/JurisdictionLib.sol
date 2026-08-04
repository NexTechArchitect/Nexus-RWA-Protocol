// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title JurisdictionLib
/// @notice Core jurisdiction and compliance logic for Nexus RWA transfers.
library JurisdictionLib {

    //================================================================
    // CONSTANTS AND ERRORS
    //================================================================

    uint16 internal constant JURISDICTION_IRAN        = 364;
    uint16 internal constant JURISDICTION_NORTH_KOREA = 408;
    uint16 internal constant JURISDICTION_RUSSIA      = 643;
    uint16 internal constant JURISDICTION_SYRIA       = 760;
    uint16 internal constant JURISDICTION_CUBA        = 192;
    uint16 internal constant JURISDICTION_VENEZUELA   = 862;

    uint16 internal constant MAX_COUNTRY_CODE  = 999;
    uint256 internal constant KYC_EXPIRY_WINDOW = 365 days;

    error InvalidCountryCode(uint16 code);
    error SanctionedJurisdiction(uint16 code);
    error JurisdictionNotAllowed(uint16 fromJurisdiction, uint16 toJurisdiction);
    error KYCExpired(address investor, uint256 expiredAt);
    error NotAccreditedInvestor(address investor);
    error ZeroAddress();

    //================================================================
    // STRUCTS
    //================================================================

    /// @notice Investor compliance data. Packed into 1 storage slot (112 bits).
    struct InvestorData {
        uint16 countryCode;
        bool   isAccredited;
        bool   isKYCVerified;
        uint40 kycExpiry;
        uint40 registeredAt;
    }

    /// @notice Jurisdictional constraints for a specific RWA asset.
    struct AssetJurisdictionRule {
        bool   allowAllJurisdictions;
        uint16 issuerCountryCode;
        uint8  minAccreditationLevel;
    }

    //================================================================
    // VALIDATION FUNCTIONS
    //================================================================

    /// @notice Validates if a country code is within ISO 3166-1 range.
    function validateCountryCode(uint16 countryCode) internal pure {
        if (countryCode == 0 || countryCode > MAX_COUNTRY_CODE) {
            revert InvalidCountryCode(countryCode);
        }
    }

    /// @notice Checks if a jurisdiction is on the OFAC sanction list.
    function isSanctionedJurisdiction(uint16 countryCode) internal pure returns (bool) {
        return (
            countryCode == JURISDICTION_IRAN        ||
            countryCode == JURISDICTION_NORTH_KOREA ||
            countryCode == JURISDICTION_RUSSIA      ||
            countryCode == JURISDICTION_SYRIA       ||
            countryCode == JURISDICTION_CUBA        ||
            countryCode == JURISDICTION_VENEZUELA
        );
    }

    /// @notice Reverts if the country code is sanctioned.
    function enforceSanctionCheck(uint16 countryCode) internal pure {
        if (isSanctionedJurisdiction(countryCode)) revert SanctionedJurisdiction(countryCode);
    }

    /// @notice Validates investor KYC is active and not expired.
    /// @dev memory — compatible with both calldata and memory callers (ComplianceEngine uses memory)
    function isKYCValid(address investor, InvestorData memory data) internal view returns (bool) {
        if (!data.isKYCVerified) return false;
        if (block.timestamp > data.kycExpiry) revert KYCExpired(investor, data.kycExpiry);
        return true;
    }

    /// @notice Enforces minimum accreditation level on investor.
    /// @dev memory — compatible with both calldata and memory callers
    function enforceAccreditation(
        address investor,
        InvestorData memory data,
        uint8 requiredLevel
    ) internal pure {
        if (requiredLevel >= 1 && !data.isAccredited) revert NotAccreditedInvestor(investor);
    }

    //================================================================
    // TRANSFER RESTRICTION CHECKS
    //================================================================

    /// @notice Core CEI-compliant transfer validation used by ComplianceEngine.
    /// @dev memory — works with structs sourced from storage reads or external calls
    function checkTransferCompliance(
        address fromAddr,
        address toAddr,
        InvestorData memory from,
        InvestorData memory to,
        AssetJurisdictionRule memory rule
    ) internal view returns (bool) {
        if (fromAddr == address(0) || toAddr == address(0)) revert ZeroAddress();

        enforceSanctionCheck(from.countryCode);
        enforceSanctionCheck(to.countryCode);

        if (!isKYCValid(fromAddr, from)) revert KYCExpired(fromAddr, from.kycExpiry);
        if (!isKYCValid(toAddr, to))     revert KYCExpired(toAddr, to.kycExpiry);

        if (!rule.allowAllJurisdictions) {
            _enforceJurisdictionPair(from.countryCode, to.countryCode, rule.issuerCountryCode);
        }

        enforceAccreditation(toAddr, to, rule.minAccreditationLevel);
        return true;
    }

    /// @notice Lightweight read-only pre-check for UI simulations — no reverts.
    /// @dev memory — works with structs sourced from storage reads or external calls
    function canTransferView(
        address fromAddr,
        address toAddr,
        InvestorData memory from,
        InvestorData memory to,
        AssetJurisdictionRule memory rule
    ) internal view returns (bool) {
        if (fromAddr == address(0) || toAddr == address(0)) return false;
        if (isSanctionedJurisdiction(from.countryCode)) return false;
        if (isSanctionedJurisdiction(to.countryCode))   return false;
        if (!from.isKYCVerified || block.timestamp > from.kycExpiry) return false;
        if (!to.isKYCVerified   || block.timestamp > to.kycExpiry)   return false;

        if (!rule.allowAllJurisdictions) {
            if (!_jurisdictionPairAllowed(from.countryCode, to.countryCode, rule.issuerCountryCode)) {
                return false;
            }
        }

        if (rule.minAccreditationLevel >= 1 && !to.isAccredited) return false;
        return true;
    }

    //================================================================
    // HELPERS
    //================================================================

    /// @notice Packs two 16-bit country codes into a single 32-bit key.
    function packJurisdictionPair(uint16 fromCode, uint16 toCode) internal pure returns (uint32) {
        return (uint32(fromCode) << 16) | uint32(toCode);
    }

    /// @notice Unpacks a 32-bit key into sender and receiver country codes.
    function unpackJurisdictionPair(uint32 key) internal pure returns (uint16 fromCode, uint16 toCode) {
        fromCode = uint16(key >> 16);
        toCode   = uint16(key & 0xFFFF);
    }

    /// @notice Computes KYC expiry timestamp from registration time.
    function computeKYCExpiry(uint40 registeredAt) internal pure returns (uint40 expiry) {
        unchecked { expiry = registeredAt + uint40(KYC_EXPIRY_WINDOW); }
    }

    //================================================================
    // PRIVATE HELPERS
    //================================================================

    /// @dev Reverts if from→to jurisdiction pair is not allowed.
    function _enforceJurisdictionPair(
        uint16 fromCode,
        uint16 toCode,
        uint16 issuerCode
    ) private pure {
        if (!_jurisdictionPairAllowed(fromCode, toCode, issuerCode)) {
            revert JurisdictionNotAllowed(fromCode, toCode);
        }
    }

    /// @dev Returns true if jurisdiction pair is valid and not sanctioned.
    function _jurisdictionPairAllowed(
        uint16 fromCode,
        uint16 toCode,
        uint16 issuerCode
    ) private pure returns (bool) {
        if (issuerCode == 0 || issuerCode > MAX_COUNTRY_CODE) return false;
        if (fromCode   == 0 || fromCode   > MAX_COUNTRY_CODE) return false;
        if (toCode     == 0 || toCode     > MAX_COUNTRY_CODE) return false;
        if (isSanctionedJurisdiction(fromCode)) return false;
        if (isSanctionedJurisdiction(toCode))   return false;
        return true;
    }
}
