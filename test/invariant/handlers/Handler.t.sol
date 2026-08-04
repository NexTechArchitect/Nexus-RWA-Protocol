// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test }            from "forge-std/Test.sol";
import { CommonBase }      from "forge-std/Base.sol";
import { StdCheats }       from "forge-std/StdCheats.sol";
import { StdUtils }        from "forge-std/StdUtils.sol";

import { AssetRegistry }   from "../../../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../../../src/core/ComplianceEngine.sol";
import { RWAToken }        from "../../../src/core/RWAToken.sol";
import { IAssetRegistry }  from "../../../src/interfaces/IAssetRegistry.sol";

/// @title Handler
/// @notice Foundry invariant handler — drives AssetRegistry + ComplianceEngine + RWAToken.
/// @dev All public functions are called randomly by the invariant runner.
///      Ghost variables track expected state for invariant assertions.
contract Handler is CommonBase, StdCheats, StdUtils {

    //=========================================================
    // CONTRACTS UNDER TEST
    //=========================================================

    AssetRegistry   public immutable registry;
    ComplianceEngine public immutable compliance;
    RWAToken        public immutable token;

    //=========================================================
    // GHOST VARIABLES (expected protocol state)
    //=========================================================

    /// @notice Total tokens minted across all handler calls.
    uint256 public ghost_totalMinted;

    /// @notice Total tokens burned across all handler calls.
    uint256 public ghost_totalBurned;

    /// @notice Number of investors currently whitelisted.
    uint256 public ghost_whitelistedCount;

    /// @notice Number of investors currently globally blocked.
    uint256 public ghost_blockedCount;

    /// @notice Tracks whether the asset is currently frozen (compliance-level).
    bool public ghost_assetFrozen;

    /// @notice Sum of all successful mint amounts. Used to verify supply cap is never breached.
    uint256 public ghost_mintedSupplyAccum;

    //=========================================================
    // ACTOR POOL
    //=========================================================

    address[] public actors;
    address   public currentActor;

    // Fixed test accounts for deterministic actor pool
    address internal constant ACTOR_0 = address(0x1001);
    address internal constant ACTOR_1 = address(0x1002);
    address internal constant ACTOR_2 = address(0x1003);
    address internal constant ACTOR_3 = address(0x1004);
    address internal constant ACTOR_4 = address(0x1005);

    //=========================================================
    // PROTOCOL PARAMS (set at deploy, immutable for invariants)
    //=========================================================

    bytes32 public immutable ASSET_ID;
    uint256 public immutable SUPPLY_CAP;
    address public immutable REGISTRAR;
    address public immutable OFFICER;

    //=========================================================
    // WHITELIST TRACKING (mirror of registry state)
    //=========================================================

    mapping(address => bool) public ghost_isWhitelisted;
    mapping(address => bool) public ghost_isBlocked;
    
    // ✅ FIX: Tracks if an actor received tokens via a forced transfer (whitelist bypass)
    mapping(address => bool) public ghost_receivedViaForcedTransfer;

    //=========================================================
    // CALL COUNTERS (for coverage insight)
    //=========================================================

    uint256 public calls_mint;
    uint256 public calls_burn;
    uint256 public calls_transfer;
    uint256 public calls_whitelist;
    uint256 public calls_block;
    uint256 public calls_freeze;

    //=========================================================
    // CONSTRUCTOR
    //=========================================================

    constructor(
        AssetRegistry   registry_,
        ComplianceEngine compliance_,
        RWAToken        token_,
        bytes32         assetId_,
        uint256         supplyCap_,
        address         registrar_,
        address         officer_
    ) {
        registry   = registry_;
        compliance = compliance_;
        token      = token_;
        ASSET_ID   = assetId_;
        SUPPLY_CAP = supplyCap_;
        REGISTRAR  = registrar_;
        OFFICER    = officer_;

        actors.push(ACTOR_0);
        actors.push(ACTOR_1);
        actors.push(ACTOR_2);
        actors.push(ACTOR_3);
        actors.push(ACTOR_4);
    }

    //=========================================================
    // MODIFIERS
    //=========================================================

    modifier useActor(uint256 actorSeed) {
        currentActor = actors[bound(actorSeed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    //=========================================================
    // HANDLER: WHITELIST INVESTOR
    //=========================================================

    /// @notice Whitelists a random actor for the asset. Registrar-gated.
    function whitelistInvestor(uint256 actorSeed, uint16 countryCode) public {
        address investor = actors[bound(actorSeed, 0, actors.length - 1)];

        // Safe country code: non-zero, <= 999, not sanctioned
        countryCode = uint16(bound(countryCode, 1, 190)); // caps below first sanctioned (Cuba=192)

        if (ghost_isWhitelisted[investor]) return; // skip if already listed

        vm.prank(REGISTRAR);
        try registry.whitelistInvestor(ASSET_ID, investor, countryCode, true) {
            ghost_isWhitelisted[investor] = true;
            ghost_whitelistedCount++;
            calls_whitelist++;
        } catch {
            // Registry may be paused or asset not registered — swallow
        }
    }

    //=========================================================
    // HANDLER: MINT
    //=========================================================

    /// @notice Mints tokens to a whitelisted actor. Registry-gated.
    function mint(uint256 actorSeed, uint256 amount) public {
        address to = actors[bound(actorSeed, 0, actors.length - 1)];

        // Only attempt if investor is whitelisted and asset not frozen
        if (!ghost_isWhitelisted[to]) return;
        if (ghost_assetFrozen)        return;
        if (ghost_isBlocked[to])      return;

        // Clamp amount to remaining supply cap
        uint256 currentMinted = registry.getMintedSupply(ASSET_ID);
        uint256 remaining     = SUPPLY_CAP > currentMinted ? SUPPLY_CAP - currentMinted : 0;
        if (remaining == 0) return;

        amount = bound(amount, 1, remaining);

        vm.prank(address(registry));
        try token.mint(to, amount) {
            ghost_totalMinted      += amount;
            ghost_mintedSupplyAccum += amount;
            calls_mint++;
        } catch {
            // Intentionally swallow — invariants will catch unexpected failures
        }
    }

    //=========================================================
    // HANDLER: BURN
    //=========================================================

    /// @notice Burns tokens from a whitelisted actor. Registry/compliance-gated.
    function burn(uint256 actorSeed, uint256 amount) public {
        address from = actors[bound(actorSeed, 0, actors.length - 1)];

        uint256 bal = token.balanceOf(from);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);

        vm.prank(address(registry));
        try token.burn(from, amount) {
            ghost_totalBurned += amount;
            calls_burn++;
        } catch {
            // Swallow — invariants catch any real violations
        }
    }

    //=========================================================
    // HANDLER: P2P TRANSFER
    //=========================================================

    /// @notice Attempts a P2P transfer between two whitelisted actors.
    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) public {
        address from = actors[bound(fromSeed, 0, actors.length - 1)];
        address to   = actors[bound(toSeed,   0, actors.length - 1)];

        if (from == to)                 return;
        if (!ghost_isWhitelisted[from]) return;
        if (!ghost_isWhitelisted[to])   return;
        if (ghost_isBlocked[from])      return;
        if (ghost_isBlocked[to])        return;
        if (ghost_assetFrozen)          return;

        uint256 bal = token.balanceOf(from);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);

        vm.prank(from);
        try token.transfer(to, amount) {
            calls_transfer++;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HANDLER: BLOCK INVESTOR
    //=========================================================

    /// @notice Globally blocks a random actor. Compliance officer-gated.
    function blockInvestor(uint256 actorSeed) public {
        address investor = actors[bound(actorSeed, 0, actors.length - 1)];

        if (ghost_isBlocked[investor]) return; // already blocked

        vm.prank(OFFICER);
        try compliance.blockInvestor(investor) {
            ghost_isBlocked[investor] = true;
            ghost_blockedCount++;
            calls_block++;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HANDLER: UNBLOCK INVESTOR
    //=========================================================

    /// @notice Unblocks a previously blocked actor.
    function unblockInvestor(uint256 actorSeed) public {
        address investor = actors[bound(actorSeed, 0, actors.length - 1)];

        if (!ghost_isBlocked[investor]) return; // not blocked

        vm.prank(OFFICER);
        try compliance.unblockInvestor(investor) {
            ghost_isBlocked[investor] = false;
            if (ghost_blockedCount > 0) ghost_blockedCount--;
            calls_block++;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HANDLER: FREEZE ASSET
    //=========================================================

    /// @notice Freezes the asset via ComplianceEngine.
    function freezeAsset() public {
        if (ghost_assetFrozen) return;

        vm.prank(OFFICER);
        try compliance.freezeAsset(ASSET_ID) {
            ghost_assetFrozen = true;
            calls_freeze++;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HANDLER: UNFREEZE ASSET
    //=========================================================

    /// @notice Unfreezes the asset via ComplianceEngine.
    function unfreezeAsset() public {
        if (!ghost_assetFrozen) return;

        vm.prank(OFFICER);
        try compliance.unfreezeAsset(ASSET_ID) {
            ghost_assetFrozen = false;
            calls_freeze++;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HANDLER: FORCED TRANSFER (compliance)
    //=========================================================

    /// @notice Executes a forced transfer between two actors. Officer-gated.
    function forcedTransfer(uint256 fromSeed, uint256 toSeed, uint256 amount) public {
        address from = actors[bound(fromSeed, 0, actors.length - 1)];
        address to   = actors[bound(toSeed,   0, actors.length - 1)];

        if (from == to) return;

        uint256 bal = token.balanceOf(from);
        if (bal == 0) return;

        amount = bound(amount, 1, bal);

        vm.prank(OFFICER);
        try compliance.executeForcedTransfer(ASSET_ID, address(token), from, to, amount) {
            // ghost_totalMinted/Burned unchanged — forced transfer doesn't change total supply
            // ✅ FIX: Mark receiver as having bypassed the whitelist legally
            ghost_receivedViaForcedTransfer[to] = true;
        } catch {
            // Swallow
        }
    }

    //=========================================================
    // HELPERS
    //=========================================================

    /// @notice Returns current real minted supply from registry.
    function registryMintedSupply() external view returns (uint256) {
        return registry.getMintedSupply(ASSET_ID);
    }

    /// @notice Returns token total supply.
    function tokenTotalSupply() external view returns (uint256) {
        return token.totalSupply();
    }

    /// @notice Returns all actors.
    function getActors() external view returns (address[] memory) {
        return actors;
    }
}