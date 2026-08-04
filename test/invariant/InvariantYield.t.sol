// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test }           from "forge-std/Test.sol";
import { CommonBase }     from "forge-std/Base.sol";
import { StdCheats }      from "forge-std/StdCheats.sol";
import { StdUtils }       from "forge-std/StdUtils.sol";

import { ERC20 }          from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { MerkleProof }    from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { YieldDistributor }  from "../../src/core/YieldDistributor.sol";
import { AssetRegistry }     from "../../src/core/AssetRegistry.sol";
import { IYieldDistributor } from "../../src/interfaces/IYieldDistributor.sol";

/// @dev Minimal mintable ERC-20 used as the yield payout token in tests.
contract MockYieldToken is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title YieldHandler
/// @notice Foundry invariant handler that drives every meaningful state transition
///         of `YieldDistributor`. Ghost variables shadow every on-chain write so
///         the invariant suite can assert correctness without any on-chain reads
///         inside the invariant functions themselves (keeping them O(1) and cheap).
///
/// GHOST ACCOUNTING MODEL
/// ───────────────────────
///  ghost_totalDeposited   = Σ all successful depositYield() amounts
///  ghost_totalClaimed     = Σ all successful claimYield() amounts
///  ghost_totalSwept       = Σ all unclaimed yield swept back via closeEpoch()
///  ghost_contractBalance  = ghost_totalDeposited - ghost_totalClaimed - ghost_totalSwept
///
///  The above must always equal the real ERC-20 balance held by YieldDistributor.
///
contract YieldHandler is CommonBase, StdCheats, StdUtils {

    // =========================================================
    // CONTRACTS UNDER TEST
    // =========================================================

    YieldDistributor public immutable distributor;
    AssetRegistry    public immutable registry;
    MockYieldToken   public immutable yieldToken;

    // =========================================================
    // PROTOCOL ROLES
    // =========================================================

    address public immutable OWNER;
    address public immutable DISTRIBUTOR_ROLE; // the address holding the distributor role
    address public immutable AUTOMATION;
    address public immutable REGISTRAR;

    bytes32 public immutable ASSET_ID;

    // =========================================================
    // ACTOR POOL — investors that can claim
    // =========================================================

    address[] public actors;

    address internal constant INVESTOR_0 = address(0x2001);
    address internal constant INVESTOR_1 = address(0x2002);
    address internal constant INVESTOR_2 = address(0x2003);
    address internal constant INVESTOR_3 = address(0x2004);

    // =========================================================
    // GHOST VARIABLES
    // =========================================================

    /// @notice Running total of all yield successfully deposited into the contract.
    uint256 public ghost_totalDeposited;

    /// @notice Running total of all yield successfully claimed by investors.
    uint256 public ghost_totalClaimed;

    /// @notice Running total of all unclaimed yield swept back to distributor.
    uint256 public ghost_totalSwept;

    /// @notice Expected ERC-20 balance of the YieldDistributor contract at any point.
    ///         invariant: ghost_contractBalance == yieldToken.balanceOf(address(distributor))
    uint256 public ghost_contractBalance;

    /// @notice Mirror of s_currentEpochId — updated every time performUpkeep succeeds.
    uint64 public ghost_currentEpochId;

    /// @notice How many epochs have ever been opened (including epoch 1 from constructor).
    uint64 public ghost_epochsOpened;

    /// @notice Per-investor total yield ever successfully claimed.
    mapping(address => uint256) public ghost_investorClaimed;

    /// @notice Per-epoch: whether it has been finalized (true = claims are open).
    mapping(uint64 => bool) public ghost_epochFinalized;

    /// @notice Per-epoch: the total yield value set during finalization.
    mapping(uint64 => uint256) public ghost_epochTotalYield;

    /// @notice Per-epoch: running sum of successful claims against that epoch.
    mapping(uint64 => uint256) public ghost_epochClaimedYield;

    /// @notice Per-epoch: whether it has been closed.
    mapping(uint64 => bool) public ghost_epochClosed;

    /// @notice Per-(epoch,investor): whether they have successfully claimed.
    mapping(uint64 => mapping(address => bool)) public ghost_hasClaimed;

    /// @notice How many epochs are currently in FINALIZED status (claims open, not yet closed).
    uint256 public ghost_finalizedCount;

    /// @notice How many epochs have been closed.
    uint256 public ghost_closedCount;

    // =========================================================
    // MERKLE TREE HELPERS
    // =========================================================

    /// @notice Stored leaves per epoch so we can generate valid proofs later.
    ///         epoch => investor => leaf (double-keccak encoded)
    mapping(uint64 => mapping(address => bytes32)) public ghost_epochLeaf;

    /// @notice Simplified 2-leaf Merkle root: root = hash(leaf[investor0], leaf[investor1]).
    ///         We use a deterministic 2-investor tree so proofs are always computable.
    mapping(uint64 => bytes32) public ghost_epochRoot;

    /// @notice Allocated yield per investor per epoch (what the leaf commits to).
    mapping(uint64 => mapping(address => uint256)) public ghost_epochAllocation;

    // Canonical "claim pair" that finalizes each epoch — always INVESTOR_0 and INVESTOR_1
    address internal constant CLAIM_A = INVESTOR_0;
    address internal constant CLAIM_B = INVESTOR_1;

    // =========================================================
    // CALL COUNTERS — useful for coverage introspection
    // =========================================================

    uint256 public calls_deposit;
    uint256 public calls_finalize;
    uint256 public calls_close;
    uint256 public calls_claim;
    uint256 public calls_batchClaim;
    uint256 public calls_upkeep;
    uint256 public calls_pause;

    // =========================================================
    // CONSTRUCTOR
    // =========================================================

    constructor(
        YieldDistributor distributor_,
        AssetRegistry    registry_,
        MockYieldToken   yieldToken_,
        bytes32          assetId_,
        address          owner_,
        address          distributorRole_,
        address          automation_,
        address          registrar_
    ) {
        distributor      = distributor_;
        registry         = registry_;
        yieldToken       = yieldToken_;
        ASSET_ID         = assetId_;
        OWNER            = owner_;
        DISTRIBUTOR_ROLE = distributorRole_;
        AUTOMATION       = automation_;
        REGISTRAR        = registrar_;

        actors.push(INVESTOR_0);
        actors.push(INVESTOR_1);
        actors.push(INVESTOR_2);
        actors.push(INVESTOR_3);

        // Epoch 1 is opened by the constructor — mirror that in ghost state.
        ghost_currentEpochId = 1;
        ghost_epochsOpened   = 1;
    }

    // =========================================================
    // INTERNAL: MERKLE HELPERS
    // =========================================================

    /// @dev Builds a deterministic leaf: double-keccak(abi.encode(investor, amount)).
    ///      Mirrors the exact encoding inside YieldDistributor._processClaim().
    function _buildLeaf(address investor, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(investor, amount))));
    }

    /// @dev Computes a 2-leaf Merkle root from two leaves (sorted ascending for consistency).
    function _buildRoot(bytes32 leafA, bytes32 leafB) internal pure returns (bytes32) {
        if (leafA <= leafB) {
            return keccak256(abi.encodePacked(leafA, leafB));
        } else {
            return keccak256(abi.encodePacked(leafB, leafA));
        }
    }

    /// @dev Returns the 1-element sibling proof for leafA given a 2-leaf tree {leafA, leafB}.
    function _proofFor(bytes32 leafA, bytes32 leafB) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = leafB; // sibling is the other leaf
    }

    // =========================================================
    // HANDLER: PERFORM UPKEEP (advance epoch)
    // =========================================================

    /// @notice Advances time past the epoch boundary and triggers Chainlink upkeep.
    ///         This is the only way a new epoch gets opened.
    function performUpkeep() public {
        uint256 nextTime = distributor.getNextEpochTime();

        // Warp to exactly the next epoch boundary
        vm.warp(nextTime);

        uint64 nextEpochId = ghost_currentEpochId + 1;

        vm.prank(AUTOMATION);
        try distributor.performUpkeep(abi.encode(nextEpochId)) {
            ghost_currentEpochId = nextEpochId;
            ghost_epochsOpened++;
            calls_upkeep++;
        } catch {
            // Already failed — upkeep conditions not met or paused
        }
    }

    // =========================================================
    // HANDLER: DEPOSIT YIELD
    // =========================================================

    /// @notice Deposits yield into the current active epoch.
    ///         Mints yieldToken to distributor role first to ensure the transfer succeeds.
    function depositYield(uint256 amountSeed) public {
        // ✅ FIX: changed isPaused() to paused()
        if (distributor.paused()) return;

        uint64 epochId = ghost_currentEpochId;
        if (ghost_epochFinalized[epochId]) return; // can't deposit into finalized
        if (ghost_epochClosed[epochId])    return;

        uint256 amount = bound(amountSeed, 1 ether, 100_000 ether);

        // Fund the distributor role
        yieldToken.mint(DISTRIBUTOR_ROLE, amount);

        vm.startPrank(DISTRIBUTOR_ROLE);
        yieldToken.approve(address(distributor), amount);
        try distributor.depositYield(epochId, amount) {
            ghost_totalDeposited  += amount;
            ghost_contractBalance += amount;
            calls_deposit++;
        } catch {
            // Swallow — invariants will catch any unexpected state drift
        }
        vm.stopPrank();
    }

    // =========================================================
    // HANDLER: FINALIZE EPOCH
    // =========================================================

    /// @notice Finalizes the current active epoch with a deterministic 2-investor Merkle tree.
    ///         Allocation: 60% to CLAIM_A, 40% to CLAIM_B.
    function finalizeEpoch(uint256 totalYieldSeed) public {
        uint64 epochId = ghost_currentEpochId;

        if (ghost_epochFinalized[epochId]) return;
        if (ghost_epochClosed[epochId])    return;

        uint256 totalYield = bound(totalYieldSeed, 2 ether, 50_000 ether);

        uint256 allocA = (totalYield * 60) / 100;
        uint256 allocB = totalYield - allocA; // 40%

        bytes32 leafA = _buildLeaf(CLAIM_A, allocA);
        bytes32 leafB = _buildLeaf(CLAIM_B, allocB);
        bytes32 root  = _buildRoot(leafA, leafB);

        vm.prank(DISTRIBUTOR_ROLE);
        try distributor.finalizeEpoch(epochId, root, totalYield) {
            ghost_epochFinalized[epochId]  = true;
            ghost_epochTotalYield[epochId] = totalYield;
            ghost_epochRoot[epochId]       = root;

            // Store leaves and allocations for proof generation in claimYield()
            ghost_epochLeaf[epochId][CLAIM_A]       = leafA;
            ghost_epochLeaf[epochId][CLAIM_B]       = leafB;
            ghost_epochAllocation[epochId][CLAIM_A] = allocA;
            ghost_epochAllocation[epochId][CLAIM_B] = allocB;

            ghost_finalizedCount++;
            calls_finalize++;
        } catch {
            // Swallow
        }
    }

    // =========================================================
    // HANDLER: CLOSE EPOCH
    // =========================================================

    /// @notice Closes a finalized epoch and sweeps unclaimed yield back.
    ///         Targets the epoch before current so we never close an active one.
    function closeEpoch(uint64 epochSeed) public {
        if (ghost_currentEpochId < 2) return; // need at least 2 epochs to close previous

        // Close any finalized-but-not-closed epoch below the current one
        uint64 epochId = uint64(bound(uint256(epochSeed), 1, ghost_currentEpochId - 1));

        if (!ghost_epochFinalized[epochId]) return;
        if (ghost_epochClosed[epochId])     return;

        // Must have enough token balance to cover sweep
        uint256 unclaimed = ghost_epochTotalYield[epochId] - ghost_epochClaimedYield[epochId];

        vm.prank(DISTRIBUTOR_ROLE);
        try distributor.closeEpoch(epochId) {
            ghost_epochClosed[epochId] = true;
            ghost_totalSwept          += unclaimed;
            ghost_contractBalance     -= unclaimed;

            if (ghost_finalizedCount > 0) ghost_finalizedCount--;
            ghost_closedCount++;
            calls_close++;
        } catch {
            // Swallow
        }
    }

    // =========================================================
    // HANDLER: CLAIM YIELD (single)
    // =========================================================

    /// @notice Executes a single-epoch yield claim for CLAIM_A or CLAIM_B.
    function claimYield(uint256 actorSeed, uint64 epochSeed) public {
        // ✅ FIX: changed isPaused() to paused()
        if (distributor.paused()) return;

        // Only CLAIM_A and CLAIM_B have valid allocations in the Merkle tree
        address investor = actorSeed % 2 == 0 ? CLAIM_A : CLAIM_B;

        // Clamp epoch to a finalized, non-closed one
        if (ghost_currentEpochId == 0) return;
        uint64 epochId = uint64(bound(uint256(epochSeed), 1, ghost_currentEpochId));

        if (!ghost_epochFinalized[epochId]) return;
        if (ghost_epochClosed[epochId])     return;
        if (ghost_hasClaimed[epochId][investor]) return;

        uint256 amount = ghost_epochAllocation[epochId][investor];
        if (amount == 0) return;

        // Build the proof: sibling is the other leaf
        bytes32 myLeaf      = ghost_epochLeaf[epochId][investor];
        bytes32 siblingLeaf = investor == CLAIM_A
            ? ghost_epochLeaf[epochId][CLAIM_B]
            : ghost_epochLeaf[epochId][CLAIM_A];

        if (myLeaf == bytes32(0) || siblingLeaf == bytes32(0)) return;

        bytes32[] memory proof = _proofFor(myLeaf, siblingLeaf);

        // The contract must hold enough tokens — top it up if needed
        uint256 contractBal = yieldToken.balanceOf(address(distributor));
        if (contractBal < amount) {
            uint256 needed = amount - contractBal;
            yieldToken.mint(address(distributor), needed);
            ghost_contractBalance += needed;
            ghost_totalDeposited  += needed;
        }

        vm.prank(investor);
        try distributor.claimYield(epochId, amount, proof) {
            ghost_hasClaimed[epochId][investor] = true;
            ghost_totalClaimed                 += amount;
            ghost_contractBalance              -= amount;
            ghost_investorClaimed[investor]    += amount;
            ghost_epochClaimedYield[epochId]   += amount;
            calls_claim++;
        } catch {
            // Swallow
        }
    }

    // =========================================================
    // HANDLER: BATCH CLAIM
    // =========================================================

    /// @notice Claims from up to 3 finalized epochs in a single batch call.
    ///         Investor is always CLAIM_A to keep proof generation deterministic.
    function claimYieldBatch(uint64 e1Seed, uint64 e2Seed, uint64 e3Seed) public {
        // ✅ FIX: changed isPaused() to paused()
        if (distributor.paused()) return;
        if (ghost_currentEpochId < 3) return; // need at least 3 epochs for a meaningful batch

        address investor = CLAIM_A;

        // Collect up to 3 distinct finalized epochs that haven't been claimed
        uint64[] memory candidates = new uint64[](3);
        candidates[0] = uint64(bound(uint256(e1Seed), 1, ghost_currentEpochId));
        candidates[1] = uint64(bound(uint256(e2Seed), 1, ghost_currentEpochId));
        candidates[2] = uint64(bound(uint256(e3Seed), 1, ghost_currentEpochId));

        uint256 count = 0;
        uint64[]    memory epochIds    = new uint64[](3);
        uint256[]   memory amounts     = new uint256[](3);
        bytes32[][] memory proofs      = new bytes32[][](3);

        for (uint256 i = 0; i < 3; i++) {
            uint64 eid = candidates[i];

            // Deduplicate
            bool dup = false;
            for (uint256 j = 0; j < count; j++) {
                if (epochIds[j] == eid) { dup = true; break; }
            }
            if (dup) continue;

            if (!ghost_epochFinalized[eid])          continue;
            if (ghost_epochClosed[eid])              continue;
            if (ghost_hasClaimed[eid][investor])     continue;

            uint256 alloc = ghost_epochAllocation[eid][investor];
            if (alloc == 0) continue;

            bytes32 myLeaf  = ghost_epochLeaf[eid][investor];
            bytes32 sibling = ghost_epochLeaf[eid][CLAIM_B];
            if (myLeaf == bytes32(0) || sibling == bytes32(0)) continue;

            epochIds[count]  = eid;
            amounts[count]   = alloc;
            proofs[count]    = _proofFor(myLeaf, sibling);
            count++;
        }

        if (count == 0) return;

        // Trim arrays to actual count
        uint64[]    memory finalEpochs = new uint64[](count);
        uint256[]   memory finalAmounts = new uint256[](count);
        bytes32[][] memory finalProofs  = new bytes32[][](count);
        uint256 totalNeeded = 0;

        for (uint256 i = 0; i < count; i++) {
            finalEpochs[i]  = epochIds[i];
            finalAmounts[i] = amounts[i];
            finalProofs[i]  = proofs[i];
            totalNeeded     += amounts[i];
        }

        // Top up contract balance if needed
        uint256 contractBal = yieldToken.balanceOf(address(distributor));
        if (contractBal < totalNeeded) {
            uint256 needed = totalNeeded - contractBal;
            yieldToken.mint(address(distributor), needed);
            ghost_contractBalance += needed;
            ghost_totalDeposited  += needed;
        }

        vm.prank(investor);
        try distributor.claimYieldBatch(finalEpochs, finalAmounts, finalProofs) {
            for (uint256 i = 0; i < count; i++) {
                uint64  eid    = finalEpochs[i];
                uint256 amount = finalAmounts[i];

                ghost_hasClaimed[eid][investor]    = true;
                ghost_epochClaimedYield[eid]       += amount;
                ghost_totalClaimed                 += amount;
                ghost_contractBalance              -= amount;
                ghost_investorClaimed[investor]    += amount;
            }
            calls_batchClaim++;
        } catch {
            // Swallow
        }
    }

    // =========================================================
    // HANDLER: PAUSE / UNPAUSE
    // =========================================================

    /// @notice Toggles the contract pause state. Owner-gated.
    function togglePause() public {
        vm.startPrank(OWNER);
        // ✅ FIX: changed isPaused() to paused()
        if (distributor.paused()) {
            try distributor.unpause() { calls_pause++; } catch {}
        } else {
            try distributor.pause() { calls_pause++; } catch {}
        }
        vm.stopPrank();
    }

    // =========================================================
    // HANDLER: DOUBLE-CLAIM ATTEMPT (should always fail)
    // =========================================================

    /// @notice Deliberately attempts a double-claim on the same (epoch, investor).
    ///         This MUST always revert — it's a core protocol security guarantee.
    function attemptDoubleClaim(uint64 epochSeed) public {
        address investor = CLAIM_A;
        uint64 epochId   = uint64(bound(uint256(epochSeed), 1, ghost_currentEpochId));

        if (!ghost_hasClaimed[epochId][investor]) return; // only attempt if already claimed

        uint256 amount = ghost_epochAllocation[epochId][investor];
        if (amount == 0) return;

        bytes32 myLeaf  = ghost_epochLeaf[epochId][investor];
        bytes32 sibling = ghost_epochLeaf[epochId][CLAIM_B];
        if (myLeaf == bytes32(0) || sibling == bytes32(0)) return;

        bytes32[] memory proof = _proofFor(myLeaf, sibling);

        vm.prank(investor);
        // This MUST fail — if it succeeds the double-spend invariant is broken
        // We don't catch here intentionally; the invariant test checks ghost_hasClaimed
        (bool success, ) = address(distributor).call(
            abi.encodeWithSelector(
                IYieldDistributor.claimYield.selector,
                epochId,
                amount,
                proof
            )
        );

        // Store result so invariant can assert it was false
        ghost_lastDoubleClaimSucceeded = success;
    }

    /// @notice True if the most recent attemptDoubleClaim() call succeeded (MUST always be false).
    bool public ghost_lastDoubleClaimSucceeded;

    // =========================================================
    // HANDLER: CLAIM FROM CLOSED EPOCH (should always fail)
    // =========================================================

    /// @notice Attempts to claim from a closed epoch — must always revert.
    function attemptClaimFromClosedEpoch(uint64 epochSeed) public {
        if (ghost_currentEpochId < 2) return;

        uint64 epochId = uint64(bound(uint256(epochSeed), 1, ghost_currentEpochId));
        if (!ghost_epochClosed[epochId]) return;

        address investor = CLAIM_A;
        uint256 amount   = ghost_epochAllocation[epochId][investor];
        if (amount == 0) amount = 1 ether; // dummy amount

        bytes32 myLeaf  = ghost_epochLeaf[epochId][investor];
        bytes32 sibling = ghost_epochLeaf[epochId][CLAIM_B];

        bytes32[] memory proof;
        if (myLeaf != bytes32(0) && sibling != bytes32(0)) {
            proof = _proofFor(myLeaf, sibling);
        } else {
            proof = new bytes32[](1);
        }

        vm.prank(investor);
        (bool success, ) = address(distributor).call(
            abi.encodeWithSelector(
                IYieldDistributor.claimYield.selector,
                epochId,
                amount,
                proof
            )
        );

        ghost_lastClosedEpochClaimSucceeded = success;
    }

    /// @notice True if the most recent attemptClaimFromClosedEpoch() call succeeded (MUST be false).
    bool public ghost_lastClosedEpochClaimSucceeded;

    // =========================================================
    // HELPERS
    // =========================================================

    /// @notice Returns current real ERC-20 balance of the distributor contract.
    function realContractBalance() external view returns (uint256) {
        return yieldToken.balanceOf(address(distributor));
    }

    /// @notice Returns all investor actors.
    function getActors() external view returns (address[] memory) {
        return actors;
    }
}