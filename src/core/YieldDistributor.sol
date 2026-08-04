// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 }            from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }         from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { MerkleProof }       from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable }          from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard }   from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IYieldDistributor } from "../interfaces/IYieldDistributor.sol";
import { IAssetRegistry }    from "../interfaces/IAssetRegistry.sol";

/// @title YieldDistributor
/// @notice Secure, Merkle-based pull-payment yield distribution for Nexus RWA.
/// @dev Implements strict CEI pattern, SafeERC20, and Chainlink Automation compatibility.
contract YieldDistributor is IYieldDistributor, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    //==================================================
    // CONSTANTS
    //==================================================

    /// @dev Gas protection: Maximum epochs an investor can claim in a single batch transaction.
    ///      Prevents Out-Of-Gas (OOG) errors if a user tries to claim 100+ epochs at once.
    uint256 private constant MAX_BATCH_SIZE = 50;

    //==================================================
    // IMMUTABLES (Gas Optimizations)
    //==================================================

    /// @notice Links this distributor to a specific Real-World Asset ID.
    bytes32 private immutable i_assetId;
    
    /// @notice The fixed duration (in seconds) of each yield cycle.
    uint256 private immutable i_epochDuration;

    /// @notice Core registry for checking whitelists and active status.
    address private immutable i_assetRegistry;

    //==================================================
    // STORAGE
    //==================================================

    /// @notice Epoch mapping: epochId => Epoch Data
    mapping(uint64 => Epoch) private s_epochs;

    /// @notice Claim tracking: epochId => investor => true/false
    /// @dev Prevents double-spending attacks per epoch.
    mapping(uint64 => mapping(address => bool)) private s_hasClaimed;

    uint64  private s_currentEpochId;
    uint256 private s_nextEpochTime;

    address private s_yieldToken;
    address private s_distributor; // Role allowed to deposit and finalize
    address private s_automation;  // Chainlink automation forwarder

    //==================================================
    // MODIFIERS
    //==================================================

    modifier onlyAutomation() {
        if (msg.sender != s_automation) revert OnlyAutomation();
        _;
    }

    modifier onlyDistributor() {
        if (msg.sender != s_distributor && msg.sender != owner()) revert OnlyDistributor();
        _;
    }

    //==================================================
    // CONSTRUCTOR
    //==================================================

    constructor(
        bytes32 assetId_,
        address assetRegistry_,
        address yieldToken_,
        address distributor_,
        address automation_,
        uint256 epochDuration_
    ) Ownable(msg.sender) {
        if (assetRegistry_ == address(0)) revert ZeroAddress();
        if (yieldToken_    == address(0)) revert ZeroAddress();
        if (distributor_   == address(0)) revert ZeroAddress();
        if (automation_    == address(0)) revert ZeroAddress();
        if (epochDuration_ == 0)          revert ZeroAmount();

        // Initialize immutables (Saves massive gas on every read)
        i_assetId       = assetId_;
        i_assetRegistry = assetRegistry_;
        i_epochDuration = epochDuration_;

        // Initialize mutable state
        s_yieldToken    = yieldToken_;
        s_distributor   = distributor_;
        s_automation    = automation_;

        s_currentEpochId = 1;
        s_nextEpochTime  = block.timestamp + epochDuration_;
        
        // Auto-open the very first epoch
        s_epochs[1] = Epoch({
            epochId:      1,
            status:       EpochStatus.ACTIVE,
            startTime:    uint40(block.timestamp),
            endTime:      uint40(s_nextEpochTime),
            merkleRoot:   bytes32(0),
            totalYield:   0,
            claimedYield: 0
        });

        emit EpochOpened(1, uint40(block.timestamp));
    }

    //==================================================
    // CHAINLINK AUTOMATION
    //==================================================

    /// @inheritdoc IYieldDistributor
    function checkUpkeep(bytes calldata /* checkData */)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        upkeepNeeded = block.timestamp >= s_nextEpochTime;
        performData  = abi.encode(s_currentEpochId + 1);
    }

    /// @inheritdoc IYieldDistributor
    function performUpkeep(bytes calldata performData) external override onlyAutomation {
        if (block.timestamp < s_nextEpochTime) revert UpkeepNotNeeded();

        uint64 nextEpochId = abi.decode(performData, (uint64));

        s_nextEpochTime += i_epochDuration; // Now using gas-optimized immutable
        s_currentEpochId = nextEpochId;

        s_epochs[nextEpochId] = Epoch({
            epochId:      nextEpochId,
            status:       EpochStatus.ACTIVE,
            startTime:    uint40(block.timestamp),
            endTime:      uint40(s_nextEpochTime),
            merkleRoot:   bytes32(0),
            totalYield:   0,
            claimedYield: 0
        });

        emit EpochOpened(nextEpochId, uint40(block.timestamp));
        emit UpkeepPerformed(nextEpochId, block.timestamp);
    }

    //==================================================
    // EPOCH MANAGEMENT (DISTRIBUTOR ROLE)
    //==================================================

    /// @inheritdoc IYieldDistributor
    function depositYield(uint64 epochId, uint256 amount) external override onlyDistributor whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        
        Epoch storage epochInfo = s_epochs[epochId];
        if (epochInfo.status != EpochStatus.ACTIVE) revert EpochNotActive(epochId);

        // Pull real yield from treasury into this contract
        IERC20(s_yieldToken).safeTransferFrom(msg.sender, address(this), amount);

        emit YieldDeposited(epochId, msg.sender, amount);
    }

    /// @inheritdoc IYieldDistributor
    function finalizeEpoch(uint64 epochId, bytes32 merkleRoot, uint256 totalYield) external override onlyDistributor {
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalYield == 0)          revert ZeroAmount();

        Epoch storage epochInfo = s_epochs[epochId];
        if (epochInfo.status == EpochStatus.FINALIZED) revert EpochAlreadyFinalized(epochId);
        if (epochInfo.status != EpochStatus.ACTIVE)    revert EpochNotActive(epochId);

        // Lock the epoch and open claims
        epochInfo.status     = EpochStatus.FINALIZED;
        epochInfo.merkleRoot = merkleRoot;
        epochInfo.totalYield = totalYield;

        emit EpochFinalized(epochId, merkleRoot, totalYield);
    }

    /// @inheritdoc IYieldDistributor
    function closeEpoch(uint64 epochId) external override onlyDistributor nonReentrant {
        Epoch storage epochInfo = s_epochs[epochId];
        if (epochInfo.status == EpochStatus.CLOSED)    revert EpochAlreadyClosed(epochId);
        if (epochInfo.status != EpochStatus.FINALIZED) revert EpochNotFinalized(epochId);

        uint256 unclaimedYield = epochInfo.totalYield - epochInfo.claimedYield;

        // Terminal state update
        epochInfo.status = EpochStatus.CLOSED;

        // Sweep leftover funds to treasury
        if (unclaimedYield > 0) {
            IERC20(s_yieldToken).safeTransfer(s_distributor, unclaimedYield);
            emit UnclaimedYieldSwept(epochId, unclaimedYield);
        }

        emit EpochClosed(epochId, epochInfo.claimedYield, unclaimedYield);
    }

    //==================================================
    // YIELD CLAIMING (INVESTOR)
    //==================================================

    /// @inheritdoc IYieldDistributor
    function claimYield(
        uint64 epochId,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external override whenNotPaused nonReentrant {
        _processClaim(epochId, msg.sender, amount, merkleProof);
        
        // Interaction (Transfer) happens ONLY after state updates
        IERC20(s_yieldToken).safeTransfer(msg.sender, amount);
        emit YieldClaimed(epochId, msg.sender, amount);
    }

    /// @inheritdoc IYieldDistributor
    function claimYieldBatch(
        uint64[] calldata epochIds,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external override whenNotPaused nonReentrant {
        uint256 length = epochIds.length;
        if (length == 0 || length != amounts.length || length != merkleProofs.length) revert ZeroAmount();
        if (length > MAX_BATCH_SIZE) revert("Batch limit exceeded"); 

        uint256 totalAmountToTransfer = 0;

        for (uint256 i = 0; i < length; ) {
            uint64 epochId = epochIds[i];
            uint256 amount = amounts[i];

            // Verify and update state
            _processClaim(epochId, msg.sender, amount, merkleProofs[i]);
            totalAmountToTransfer += amount;

            emit YieldClaimed(epochId, msg.sender, amount);
            
            unchecked { ++i; } 
        }

        // Single external call for efficiency
        IERC20(s_yieldToken).safeTransfer(msg.sender, totalAmountToTransfer);
    }

    /// @dev Internal logic to verify whitelist, proof, and update claim state.
    ///      Adheres strictly to Checks-Effects-Interactions (CEI).
    function _processClaim(
        uint64 epochId,
        address investor,
        uint256 amount,
        bytes32[] calldata proof
    ) internal {
        if (amount == 0) revert ZeroAmount();

        Epoch storage epochInfo = s_epochs[epochId];
        
        // 1. CHECKS
        if (epochInfo.status != EpochStatus.FINALIZED) revert EpochNotFinalized(epochId);
        if (s_hasClaimed[epochId][investor])           revert AlreadyClaimed(epochId, investor);

        // Verify investor is legally allowed to hold assets (using optimized immutable registry)
        if (!IAssetRegistry(i_assetRegistry).isWhitelisted(i_assetId, investor)) {
            revert NotWhitelisted(investor);
        }

        // Verify cryptographic Merkle inclusion
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(investor, amount))));
        if (!MerkleProof.verify(proof, epochInfo.merkleRoot, leaf)) {
            revert InvalidMerkleProof(epochId, investor);
        }

        // Ensure contract liquidity
        if (IERC20(s_yieldToken).balanceOf(address(this)) < amount) {
            revert InsufficientYieldBalance(IERC20(s_yieldToken).balanceOf(address(this)), amount);
        }

        // 2. EFFECTS
        s_hasClaimed[epochId][investor] = true;
        epochInfo.claimedYield += amount;
    }

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    function setYieldToken(address newToken) external override onlyOwner {
        if (newToken == address(0)) revert ZeroAddress();
        address old  = s_yieldToken;
        s_yieldToken = newToken;
        emit YieldTokenUpdated(old, newToken);
    }

    function setAutomation(address newAutomation) external override onlyOwner {
        if (newAutomation == address(0)) revert ZeroAddress();
        address old  = s_automation;
        s_automation = newAutomation;
        emit AutomationUpdated(old, newAutomation);
    }

    function setDistributor(address newDistributor) external onlyOwner {
        if (newDistributor == address(0)) revert ZeroAddress();
        address old = s_distributor;
        s_distributor = newDistributor;
        // Fix applied: Correctly tracks distributor rotation
        emit DistributorUpdated(old, newDistributor); 
    }
    
    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    function getEpoch(uint64 epochId) external view override returns (Epoch memory) {
        return s_epochs[epochId];
    }

    function getCurrentEpochId() external view override returns (uint64) {
        return s_currentEpochId;
    }

    function hasClaimed(uint64 epochId, address investor) external view override returns (bool) {
        return s_hasClaimed[epochId][investor];
    }

    function getYieldToken() external view override returns (address) {
        return s_yieldToken;
    }

    function getNextEpochTime() external view override returns (uint256) {
        return s_nextEpochTime;
    }
}