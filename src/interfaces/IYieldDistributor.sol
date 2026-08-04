// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IYieldDistributor
/// @notice Interface for the Nexus RWA Yield Distributor.
/// @dev Handles automated, gas-efficient yield payouts using Merkle Trees for claim verification 
///      and Chainlink Automation for scheduling epoch cycles.
interface IYieldDistributor {

    //==================================================
    // ENUMS
    //==================================================

    /// @notice The lifecycle stages of a single yield distribution period (Epoch).
    enum EpochStatus {
        NONE,       // 0 — Doesn't exist yet.
        ACTIVE,     // 1 — Currently open. The protocol is depositing yield into this epoch.
        FINALIZED,  // 2 — Deposits are locked, Merkle Root is set, and investors can now claim.
        CLOSED      // 3 — The epoch has officially ended. Unclaimed yield is swept back.
    }

    //==================================================
    // STRUCTS
    //==================================================

    /// @notice Core metadata for a specific yield distribution cycle.
    /// @dev Gas Optimized: Packed into 4 storage slots instead of 7.
    ///      Slot 1: epochId (8B) + status (1B) + startTime (5B) + endTime (5B) = 19 Bytes.
    ///      Slot 2: merkleRoot (32B)
    ///      Slot 3: totalYield (32B)
    ///      Slot 4: claimedYield (32B)
    struct Epoch {
        uint64      epochId;
        EpochStatus status;
        uint40      startTime;
        uint40      endTime;
        bytes32     merkleRoot;
        uint256     totalYield;
        uint256     claimedYield;
    }

    //==================================================
    // ERRORS
    //==================================================

    /// @notice Thrown when a zero address (0x0) is provided.
    error ZeroAddress();
    
    /// @notice Thrown when an operation is attempted with zero tokens.
    error ZeroAmount();
    
    /// @notice Thrown when an investor tries to claim yield before the Admin uploads the Merkle Root.
    error EpochNotFinalized(uint64 epochId);
    
    /// @notice Thrown if Admin tries to finalize an epoch that is already finalized.
    error EpochAlreadyFinalized(uint64 epochId);
    
    /// @notice Thrown if Admin tries to deposit yield into an epoch that isn't currently active.
    error EpochNotActive(uint64 epochId);
    
    /// @notice Thrown if attempting to interact with an epoch that has already been swept and closed.
    error EpochAlreadyClosed(uint64 epochId);
    
    /// @notice Thrown to prevent double-spending when an investor tries to claim their yield twice.
    error AlreadyClaimed(uint64 epochId, address investor);
    
    /// @notice Thrown when the cryptographic proof doesn't match. Either the user is not eligible, or the amount is wrong.
    error InvalidMerkleProof(uint64 epochId, address investor);
    
    /// @notice Thrown if an invalid or empty Merkle root is provided during finalization.
    error InvalidMerkleRoot();
    
    /// @notice Thrown if the contract doesn't have enough stablecoins/tokens to payout the yield.
    error InsufficientYieldBalance(uint256 available, uint256 requested);
    
    /// @notice Thrown if Chainlink tries to open a new epoch before the required time interval has passed.
    error EpochIntervalNotReached(uint256 nextEpochTime);
    
    /// @notice Thrown if a regular user tries to call Chainlink's dedicated automation function.
    error OnlyAutomation();
    
    /// @notice Thrown if someone other than the designated Yield Distributor role tries to deposit or finalize.
    error OnlyDistributor();
    
    /// @notice Thrown if a non-KYC/blacklisted investor attempts to claim yield.
    error NotWhitelisted(address investor);
    
    /// @notice Thrown if the yield token (e.g., USDC/USDT) hasn't been configured yet.
    error YieldTokenNotSet();
    
    /// @notice Thrown when Chainlink executes upkeep but the conditions aren't actually met.
    error UpkeepNotNeeded();

    //==================================================
    // EVENTS
    //==================================================

    /// @notice Emitted when a new yield distribution cycle officially starts.
    event EpochOpened(uint64 indexed epochId, uint40 startTime);

    /// @notice Emitted when the calculation period ends and the Merkle root is securely uploaded. Claims open now!
    event EpochFinalized(uint64 indexed epochId, bytes32 merkleRoot, uint256 totalYield);

    /// @notice Emitted when an epoch's claim window closes and remaining funds are recovered.
    event EpochClosed(uint64 indexed epochId, uint256 claimedYield, uint256 unclaimedYield);

    /// @notice Emitted when the protocol treasury deposits real yield (USDC/USDT) into the active epoch.
    event YieldDeposited(uint64 indexed epochId, address indexed from, uint256 amount);

    /// @notice Emitted when an investor successfully proves their allocation and withdraws their yield.
    event YieldClaimed(uint64 indexed epochId, address indexed investor, uint256 amount);

    /// @notice Emitted when leftover funds from lazy/inactive investors are swept back to the treasury.
    event UnclaimedYieldSwept(uint64 indexed epochId, uint256 amount);

    /// @notice Emitted when Chainlink's bot successfully pings and triggers the next lifecycle event.
    event UpkeepPerformed(uint64 indexed epochId, uint256 timestamp);

    /// @notice Emitted when the underlying payout token is changed (e.g., migrating from USDT to USDC).
    event YieldTokenUpdated(address indexed oldToken, address indexed newToken);

    /// @notice Emitted when the Chainlink Automation registry address is updated.
    event AutomationUpdated(address indexed oldAutomation, address indexed newAutomation);

    /// @notice Emitted when the distributor role (treasury manager) is updated.
    event DistributorUpdated(address indexed oldDistributor, address indexed newDistributor);
    
    //==================================================
    // CHAINLINK AUTOMATION
    //==================================================

    /// @notice Chainlink's scheduled check. It asks the contract: "Is it time to open a new epoch?"
    /// @dev Runs completely off-chain to save gas until `upkeepNeeded` returns true.
    /// @param checkData Unused/empty bytes, standard Chainlink interface requirement.
    /// @return upkeepNeeded True if the time interval has passed.
    /// @return performData The encoded epochId that needs to be opened next.
    function checkUpkeep(bytes calldata checkData)
        external
        view
        returns (bool upkeepNeeded, bytes memory performData);

    /// @notice Chainlink's action function. When `checkUpkeep` is true, Chainlink calls this to officially open the new epoch.
    /// @param performData The encoded instruction payload returned by `checkUpkeep`.
    function performUpkeep(bytes calldata performData) external;

    //==================================================
    // EPOCH MANAGEMENT
    //==================================================

    /// @notice Allows the protocol treasury to funnel generated real-world yield into the current cycle.
    /// @param epochId The active epoch receiving the funds.
    /// @param amount The number of tokens being deposited.
    function depositYield(uint64 epochId, uint256 amount) external;

    /// @notice Locks the epoch, uploads the cryptographically proven distribution list (Merkle Root), and opens the gates for claiming.
    /// @param epochId The epoch to finalize.
    /// @param merkleRoot The root hash containing everyone's exact claimable amounts.
    /// @param totalYield The total funds allocated for this specific cycle.
    function finalizeEpoch(uint64 epochId, bytes32 merkleRoot, uint256 totalYield) external;

    /// @notice Ends an old epoch and sweeps any yield that users forgot to claim back to the treasury.
    /// @param epochId The finalized epoch to close.
    function closeEpoch(uint64 epochId) external;

    //==================================================
    // YIELD CLAIMING
    //==================================================

    /// @notice The main withdrawal function. Investors use this to pull their earned yield into their wallet.
    /// @param epochId The distribution cycle they are claiming from.
    /// @param amount The exact amount they are owed (must match the Merkle tree).
    /// @param merkleProof The cryptographic proof array generated by the frontend to verify their allocation.
    function claimYield(
        uint64          epochId,
        uint256         amount,
        bytes32[] calldata merkleProof
    ) external;

    /// @notice A gas-saving function allowing users to claim payouts from multiple missed epochs in a single transaction.
    /// @param epochIds An array of epochs the user is claiming from.
    /// @param amounts An array of respective amounts owed per epoch.
    /// @param merkleProofs A 2D array containing the Merkle proofs for each respective epoch.
    function claimYieldBatch(
        uint64[]          calldata epochIds,
        uint256[]         calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external;

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    /// @notice Changes the stablecoin/token used for paying out yield.
    function setYieldToken(address newToken) external;

    /// @notice Updates the trusted Chainlink Automation node address.
    function setAutomation(address newAutomation) external;

    /// @notice Emergency stop button. Halts all claims and deposits globally.
    function pause() external;

    /// @notice Lifts the emergency stop and resumes normal protocol operations.
    function unpause() external;

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    /// @notice Retrieves the full details of a specific epoch.
    function getEpoch(uint64 epochId) external view returns (Epoch memory);

    /// @notice Returns the ID of the currently active yield cycle.
    function getCurrentEpochId() external view returns (uint64);

    /// @notice Checks if an investor has already withdrawn their yield for a specific epoch to prevent double-spending.
    function hasClaimed(uint64 epochId, address investor) external view returns (bool);

    /// @notice Returns the contract address of the token currently used for yield payouts (e.g., USDC).
    function getYieldToken() external view returns (address);

    /// @notice Returns the exact UNIX timestamp when Chainlink is scheduled to open the next epoch.
    function getNextEpochTime() external view returns (uint256);
}