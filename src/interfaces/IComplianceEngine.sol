// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IComplianceEngine
/// @notice Interface for the Nexus RWA Compliance Engine.
/// @dev Acts as the central rulebook for the protocol. It handles global blacklisting, 
///      asset freezing, legal clawbacks, and real-time transfer verifications.
interface IComplianceEngine {

    //==================================================
    // ERRORS
    //==================================================

    /// @notice Thrown when a zero address (0x0) is accidentally passed.
    error ZeroAddress();
    
    /// @notice Thrown when an action is attempted with an amount of 0.
    error ZeroAmount();
    
    /// @notice Thrown when trying to interact with an asset that hasn't been created yet.
    error AssetNotRegistered(bytes32 assetId);
    
    /// @notice Thrown if the compliance officer tries to block an already blocked investor.
    error InvestorAlreadyBlocked(address investor);
    
    /// @notice Thrown if trying to unblock an investor who is currently active/not blocked.
    error InvestorNotBlocked(address investor);
    
    /// @notice Thrown when a blacklisted/blocked investor tries to send or receive tokens.
    error BlockedInvestor(address investor);
    
    /// @notice Thrown when a transfer violates KYC, Jurisdiction, or Sanction rules.
    error TransferNotCompliant(address from, address to, bytes32 assetId);
    
    /// @notice Thrown when someone other than the designated Compliance Officer tries to call restricted functions.
    error OnlyComplianceOfficer();
    
    /// @notice Thrown when the caller is not the officially recognized Asset Registry.
    error CallerNotRegistry();
    
    /// @notice Thrown when a user tries to send tokens to their own wallet (useless gas waste).
    error SelfTransfer(address account);

    //==================================================
    // EVENTS
    //==================================================

    /// @notice Emitted when a compliance officer officially blacklists an investor globally.
    event InvestorBlocked(address indexed investor, address indexed by);
    
    /// @notice Emitted when an investor's global blacklist status is removed.
    event InvestorUnblocked(address indexed investor, address indexed by);
    
    /// @notice Emitted when tokens are legally clawed back from one wallet and sent to another.
    event ForcedTransferExecuted(bytes32 indexed assetId, address indexed from, address indexed to, uint256 amount);
    
    /// @notice Emitted when an entire asset market is frozen for legal or security reasons.
    event AssetFrozen(bytes32 indexed assetId, address indexed by);
    
    /// @notice Emitted when a previously frozen asset is reopened for trading.
    event AssetUnfrozen(bytes32 indexed assetId, address indexed by);
    
    /// @notice Emitted when the contract owner assigns a new address as the Compliance Officer.
    event ComplianceOfficerUpdated(address indexed oldOfficer, address indexed newOfficer);
    
    /// @notice Emitted when the linked Asset Registry contract address is updated.
    event AssetRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);

    //==================================================
    // TRANSFER COMPLIANCE
    //==================================================

    /// @notice The main gatekeeper. Called before any P2P token transfer to ensure both parties meet all legal rules.
    /// @dev Reverts with a specific error if the transfer is not allowed.
    /// @param assetId The unique ID of the RWA being transferred.
    /// @param from The wallet address sending the tokens.
    /// @param to The wallet address receiving the tokens.
    function enforceTransferCompliance(bytes32 assetId, address from, address to) external view;

    /// @notice A "dry-run" version of transfer verification. Safe to use in UI/frontends.
    /// @dev Does not revert. Returns a simple true/false so DApps can disable transfer buttons if false.
    /// @param assetId The unique ID of the RWA being transferred.
    /// @param from The wallet address sending the tokens.
    /// @param to The wallet address receiving the tokens.
    /// @return ok Returns true if the transfer is 100% legally compliant, otherwise false.
    function canTransfer(bytes32 assetId, address from, address to) external view returns (bool ok);

    //==================================================
    // INVESTOR & ASSET CONTROLS
    //==================================================

    /// @notice Globally restricts an investor from interacting with any asset on the protocol.
    /// @param investor The wallet address to be blacklisted.
    function blockInvestor(address investor) external;

    /// @notice Lifts the global restriction from an investor, allowing them to trade again.
    /// @param investor The wallet address to be un-blacklisted.
    function unblockInvestor(address investor) external;

    /// @notice Read-only check to see if a specific investor is currently blocked.
    /// @param investor The wallet address to check.
    function isBlocked(address investor) external view returns (bool);

    /// @notice Halts all minting, burning, and transfers for a specific real-world asset.
    /// @param assetId The unique ID of the asset to freeze.
    function freezeAsset(bytes32 assetId) external;

    /// @notice Lifts the freeze on a specific asset, resuming normal market operations.
    /// @param assetId The unique ID of the asset to unfreeze.
    function unfreezeAsset(bytes32 assetId) external;

    //==================================================
    // FORCED TRANSFER & ADMIN
    //==================================================

    /// @notice The legal clawback function. Moves tokens forcefully bypassing standard whitelist checks.
    /// @dev Used for court orders, wallet recovery, or confiscating funds from hackers/sanctioned entities.
    /// @param assetId The unique ID of the asset.
    /// @param token The deployed ERC20 smart contract address of the asset.
    /// @param from The wallet address to seize tokens from.
    /// @param to The recovery wallet address where tokens will be sent.
    /// @param amount The number of tokens to forcefully move.
    function executeForcedTransfer(
        bytes32 assetId,
        address token,
        address from,
        address to,
        uint256 amount
    ) external;

    /// @notice Allows the contract owner to change the Compliance Officer address.
    /// @param newOfficer The address of the new compliance authority.
    function setComplianceOfficer(address newOfficer) external;

    /// @notice Allows the contract owner to point to a new Asset Registry contract.
    /// @param newRegistry The address of the new registry.
    function setAssetRegistry(address newRegistry) external;

    /// @notice Returns the address currently holding the Compliance Officer role.
    function getComplianceOfficer() external view returns (address);

    /// @notice Returns the address of the linked Asset Registry contract.
    function getAssetRegistry() external view returns (address);
}