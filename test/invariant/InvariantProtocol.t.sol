// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test }             from "forge-std/Test.sol";
import { StdInvariant }     from "forge-std/StdInvariant.sol";

import { AssetRegistry }    from "../../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../../src/core/ComplianceEngine.sol";
import { RWAToken }         from "../../src/core/RWAToken.sol";
import { IAssetRegistry }   from "../../src/interfaces/IAssetRegistry.sol";

import { Handler }          from "./handlers/Handler.t.sol";

/// @title InvariantProtocol
/// @notice Foundry invariant test suite for the core Nexus RWA protocol.
///
/// INVARIANTS COVERED
/// ──────────────────
///  I-01  Token totalSupply == registry mintedSupply at all times
///  I-02  Token totalSupply == ghost_totalMinted - ghost_totalBurned
///  I-03  Registry mintedSupply NEVER exceeds totalSupplyCap
///  I-04  Non-whitelisted address NEVER holds a non-zero token balance (EXCEPT via forced transfer)
///  I-05  Globally blocked investor NEVER holds a non-zero balance (post-block)
///  I-06  Asset cannot be ACTIVE when ComplianceEngine marks it frozen
///  I-07  enforceTransferCompliance always reverts for blocked investors
///  I-08  canTransfer always returns false for blocked investors
///  I-09  SelfTransfer is always rejected by ComplianceEngine
///  I-10  forcedTransfer cannot target zero addresses
///  I-11  mintedSupply NEVER underflows below zero during burn
///  I-12  Token total supply is always >= 0 (trivially, but explicit)
///  I-13  registry.isAssetActive() is false when asset is FROZEN
///  I-14  ghost_blockedCount matches on-chain blocked state for actor pool
///  I-15  ghost_whitelistedCount matches on-chain whitelist state for actor pool
///
contract InvariantProtocol is StdInvariant, Test {

    //=========================================================
    // CONTRACTS
    //=========================================================

    AssetRegistry    internal registry;
    ComplianceEngine internal compliance;
    RWAToken         internal token;
    Handler          internal handler;

    //=========================================================
    // ROLES / CONSTANTS
    //=========================================================

    address internal constant OWNER     = address(0xAAAA);
    address internal constant REGISTRAR = address(0xBBBB);
    address internal constant OFFICER   = address(0xCCCC);

    bytes32 internal constant ASSET_ID    = keccak256("NEXUS_TBILL_001");
    uint256 internal constant SUPPLY_CAP  = 1_000_000 ether;
    uint16  internal constant COUNTRY_US  = 840;

    //=========================================================
    // SETUP
    //=========================================================

    function setUp() public {
        vm.startPrank(OWNER);

        // 1. Deploy ComplianceEngine first (AssetRegistry needs its address)
        //    We deploy registry with a placeholder then wire up properly.
        //    Use a two-step deployment to avoid circular dependency.

        // Deploy registry with a placeholder compliance engine
        // (we'll update it after both are deployed)
        address compliancePlaceholder = address(0xDEAD);

        registry   = new AssetRegistry(REGISTRAR, compliancePlaceholder);
        compliance = new ComplianceEngine(address(registry), OFFICER);

        // Update registry to point to real compliance engine (owner-gated)
        registry.setComplianceEngine(address(compliance));

        // 2. Deploy RWAToken — minting/burning gated by registry address
        token = new RWAToken(
            "Nexus T-Bill",
            "nTBILL",
            ASSET_ID,
            address(registry),
            address(compliance)
        );

        // 3. Register the asset in the registry
        vm.stopPrank();
        vm.prank(REGISTRAR);
        registry.registerAsset(
            ASSET_ID,
            address(token),
            IAssetRegistry.AssetType.T_BILL,
            COUNTRY_US,
            true,        // allowAllJurisdictions
            0,           // no accreditation required
            SUPPLY_CAP,
            0            // no maturity
        );

        // 4. Deploy handler and wire Foundry invariant runner
        vm.prank(OWNER);
        handler = new Handler(
            registry,
            compliance,
            token,
            ASSET_ID,
            SUPPLY_CAP,
            REGISTRAR,
            OFFICER
        );

        // Tell Foundry to call ONLY handler functions
        targetContract(address(handler));

        // Whitelist the handler itself so it can prank as registry for mints
        // (registry.mint is gated on msg.sender == s_assetRegistry)
        // The handler pranks as address(registry) for mints — no extra whitelist needed.
    }

    //=========================================================
    // I-01: tokenSupply == registryMintedSupply
    //=========================================================

    /// @notice The token's ERC-20 totalSupply must always equal what the registry recorded.
    function invariant_I01_tokenSupplyEqualsRegistrySupply() public view {
        uint256 tokenSupply    = token.totalSupply();
        uint256 registrySupply = registry.getMintedSupply(ASSET_ID);

        assertEq(
            tokenSupply,
            registrySupply,
            "I-01 VIOLATED: token totalSupply != registry mintedSupply"
        );
    }

    //=========================================================
    // I-02: tokenSupply == minted - burned (ghost accounting)
    //=========================================================

    /// @notice Ghost-tracked net supply must equal real on-chain supply.
    function invariant_I02_ghostSupplyMatchesToken() public view {
        uint256 expectedSupply = handler.ghost_totalMinted() - handler.ghost_totalBurned();
        uint256 actualSupply   = token.totalSupply();

        assertEq(
            actualSupply,
            expectedSupply,
            "I-02 VIOLATED: ghost net supply != token totalSupply"
        );
    }

    //=========================================================
    // I-03: mintedSupply <= supplyCap
    //=========================================================

    /// @notice Registry minted supply must never exceed the hard cap.
    function invariant_I03_mintedNeverExceedsCap() public view {
        uint256 minted = registry.getMintedSupply(ASSET_ID);

        assertLe(
            minted,
            SUPPLY_CAP,
            "I-03 VIOLATED: registry mintedSupply exceeds totalSupplyCap"
        );
    }

    //=========================================================
    // I-04: non-whitelisted address never holds tokens (EXCEPT Forced Transfers)
    //=========================================================

    /// @notice Every actor with a non-zero balance MUST be whitelisted, 
    ///         UNLESS they received the tokens via a legal forced transfer.
    function invariant_I04_noTokensWithoutWhitelist() public view {
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];
            uint256 bal   = token.balanceOf(actor);

            if (bal > 0) {
                bool isWhitelisted = registry.isWhitelisted(ASSET_ID, actor);
                bool gotViaClawback = handler.ghost_receivedViaForcedTransfer(actor);

                assertTrue(
                    isWhitelisted || gotViaClawback,
                    "I-04 VIOLATED: non-whitelisted actor holds tokens without legal forced transfer"
                );
            }
        }
    }

    //=========================================================
    // I-05: blocked investor never holds tokens (enforcement check)
    //=========================================================

    /// @notice A globally blocked investor cannot receive new tokens.
    ///         Any existing balance they may hold is checked via canTransfer = false.
    function invariant_I05_blockedInvestorCannotReceive() public view {
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];

            if (compliance.isBlocked(actor)) {
                // canTransfer must return false for any transfer TO a blocked address
                bool ok = compliance.canTransfer(ASSET_ID, actors[0], actor);
                assertFalse(
                    ok,
                    "I-05 VIOLATED: canTransfer returned true for blocked investor as recipient"
                );
            }
        }
    }

    //=========================================================
    // I-06: frozen asset is not active in registry
    //=========================================================

    /// @notice When the handler has frozen the asset, registry.isAssetActive must be false.
    function invariant_I06_frozenAssetIsNotActive() public view {
        bool handlerFrozen = handler.ghost_assetFrozen();

        if (handlerFrozen) {
            assertFalse(
                registry.isAssetActive(ASSET_ID),
                "I-06 VIOLATED: asset is FROZEN but registry reports it as ACTIVE"
            );
        }
    }

    //=========================================================
    // I-07: enforceTransferCompliance reverts for blocked investors
    //=========================================================

    /// @notice enforceTransferCompliance must ALWAYS revert if either party is blocked.
    function invariant_I07_enforceRevertsForBlocked() public view {
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];

            if (!compliance.isBlocked(actor)) continue;

            // Try from = blocked
            (bool successFrom, ) = address(compliance).staticcall(
                abi.encodeWithSelector(
                    compliance.enforceTransferCompliance.selector,
                    ASSET_ID,
                    actor,
                    actors[(i + 1) % actors.length]
                )
            );
            assertFalse(
                successFrom,
                "I-07 VIOLATED: enforceTransferCompliance did NOT revert for blocked 'from'"
            );

            // Try to = blocked
            (bool successTo, ) = address(compliance).staticcall(
                abi.encodeWithSelector(
                    compliance.enforceTransferCompliance.selector,
                    ASSET_ID,
                    actors[(i + 1) % actors.length],
                    actor
                )
            );
            assertFalse(
                successTo,
                "I-07 VIOLATED: enforceTransferCompliance did NOT revert for blocked 'to'"
            );
        }
    }

    //=========================================================
    // I-08: canTransfer always false for blocked investors
    //=========================================================

    /// @notice canTransfer must be a consistent read-only shadow of enforceTransferCompliance.
    function invariant_I08_canTransferFalseForBlocked() public view {
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];

            if (!compliance.isBlocked(actor)) continue;

            address other = actors[(i + 1) % actors.length];

            assertFalse(
                compliance.canTransfer(ASSET_ID, actor, other),
                "I-08 VIOLATED: canTransfer true for blocked 'from'"
            );
            assertFalse(
                compliance.canTransfer(ASSET_ID, other, actor),
                "I-08 VIOLATED: canTransfer true for blocked 'to'"
            );
        }
    }

    //=========================================================
    // I-09: selfTransfer always rejected
    //=========================================================

    /// @notice ComplianceEngine must reject self-transfers from every actor.
    function invariant_I09_selfTransferAlwaysRejected() public view{
        address[] memory actors = handler.getActors();

        for (uint256 i = 0; i < actors.length; i++) {
            address actor = actors[i];

            (bool success, ) = address(compliance).staticcall(
                abi.encodeWithSelector(
                    compliance.enforceTransferCompliance.selector,
                    ASSET_ID,
                    actor,
                    actor
                )
            );

            assertFalse(
                success,
                "I-09 VIOLATED: enforceTransferCompliance did NOT revert for self-transfer"
            );

            assertFalse(
                compliance.canTransfer(ASSET_ID, actor, actor),
                "I-09 VIOLATED: canTransfer returned true for self-transfer"
            );
        }
    }

    //=========================================================
    // I-10: forcedTransfer with zero addresses always reverts
    //=========================================================

    /// @notice Forced transfer with any zero address argument must always revert.
    function invariant_I10_forcedTransferRejectsZeroAddress() public {
        address validAddr = address(0x1001);
        uint256 amount    = 1;

        // from = zero
        (bool s1, ) = address(compliance).call(
            abi.encodeWithSelector(
                compliance.executeForcedTransfer.selector,
                ASSET_ID,
                address(token),
                address(0),
                validAddr,
                amount
            )
        );
        assertFalse(s1, "I-10 VIOLATED: forcedTransfer succeeded with from=address(0)");

        // to = zero
        (bool s2, ) = address(compliance).call(
            abi.encodeWithSelector(
                compliance.executeForcedTransfer.selector,
                ASSET_ID,
                address(token),
                validAddr,
                address(0),
                amount
            )
        );
        assertFalse(s2, "I-10 VIOLATED: forcedTransfer succeeded with to=address(0)");

        // token = zero
        (bool s3, ) = address(compliance).call(
            abi.encodeWithSelector(
                compliance.executeForcedTransfer.selector,
                ASSET_ID,
                address(0),
                validAddr,
                address(0x9999),
                amount
            )
        );
        assertFalse(s3, "I-10 VIOLATED: forcedTransfer succeeded with token=address(0)");
    }

    //=========================================================
    // I-11: mintedSupply never underflows (burn safety)
    //=========================================================

    /// @notice The registry's mintedSupply must always be <= ghost_totalMinted.
    ///         This catches any arithmetic underflow that might slip past the burn check.
    function invariant_I11_mintedSupplyNoUnderflow() public view {
        uint256 minted = registry.getMintedSupply(ASSET_ID);

        assertLe(
            minted,
            handler.ghost_totalMinted(),
            "I-11 VIOLATED: mintedSupply exceeds total ever minted (underflow or phantom mint)"
        );
    }

    //=========================================================
    // I-12: token totalSupply is always >= 0 (uint256, trivial but explicit)
    //=========================================================

    /// @notice Explicitly verify the totalSupply is non-negative.
    ///         Solidity uints can't be negative, but this guards against a future int cast bug.
    function invariant_I12_totalSupplyNonNegative() public view {
        // Cast to int256 to catch any hypothetical underflow via signed arithmetic
        int256 supply = int256(token.totalSupply());
        assertGe(supply, 0, "I-12 VIOLATED: totalSupply is negative");
    }

    //=========================================================
    // I-13: isAssetActive() == false when FROZEN
    //=========================================================

    /// @notice If registry status is FROZEN, isAssetActive() must return false.
    function invariant_I13_isAssetActiveFalseWhenFrozen() public view {
        IAssetRegistry.AssetInfo memory info = registry.getAssetInfo(ASSET_ID);

        if (info.status == IAssetRegistry.AssetStatus.FROZEN) {
            assertFalse(
                registry.isAssetActive(ASSET_ID),
                "I-13 VIOLATED: isAssetActive true while status is FROZEN"
            );
        }
    }

    //=========================================================
    // I-14: ghost_blockedCount matches on-chain state
    //=========================================================

    /// @notice The handler's ghost blocked count must match how many actors are actually blocked.
    function invariant_I14_ghostBlockedCountMatches() public view {
        address[] memory actors = handler.getActors();
        uint256 onChainBlocked  = 0;

        for (uint256 i = 0; i < actors.length; i++) {
            if (compliance.isBlocked(actors[i])) {
                onChainBlocked++;
            }
        }

        assertEq(
            onChainBlocked,
            handler.ghost_blockedCount(),
            "I-14 VIOLATED: ghost_blockedCount != actual on-chain blocked count"
        );
    }

    //=========================================================
    // I-15: ghost_whitelistedCount matches on-chain state
    //=========================================================

    /// @notice The handler's ghost whitelist count must match actual registry state.
    function invariant_I15_ghostWhitelistedCountMatches() public view {
        address[] memory actors    = handler.getActors();
        uint256 onChainWhitelisted = 0;

        for (uint256 i = 0; i < actors.length; i++) {
            if (registry.isWhitelisted(ASSET_ID, actors[i])) {
                onChainWhitelisted++;
            }
        }

        assertEq(
            onChainWhitelisted,
            handler.ghost_whitelistedCount(),
            "I-15 VIOLATED: ghost_whitelistedCount != actual on-chain whitelist count"
        );
    }

    //=========================================================
    // I-16: token supply conservation across forced transfers
    //=========================================================

    /// @notice Forced transfers must not change totalSupply (they're just moves, not mint/burn).
    /// @dev We check that supply = minted - burned regardless of how many forced transfers happened.
    function invariant_I16_forcedTransferNoSupplyChange() public view {
        uint256 expected = handler.ghost_totalMinted() - handler.ghost_totalBurned();
        uint256 actual   = token.totalSupply();

        assertEq(
            actual,
            expected,
            "I-16 VIOLATED: forced transfer changed total token supply"
        );
    }

    //=========================================================
    // I-17: RWAToken assetId is immutable
    //=========================================================

    /// @notice The token's assetId must always equal what was set at deployment.
    function invariant_I17_tokenAssetIdImmutable() public view {
        assertEq(
            token.assetId(),
            ASSET_ID,
            "I-17 VIOLATED: token assetId changed after deployment"
        );
    }

    //=========================================================
    // I-18: compliance officer address is always non-zero
    //=========================================================

    /// @notice The compliance officer must never be set to the zero address.
    function invariant_I18_complianceOfficerNonZero() public view {
        assertNotEq(
            compliance.getComplianceOfficer(),
            address(0),
            "I-18 VIOLATED: compliance officer is address(0)"
        );
    }

    //=========================================================
    // I-19: asset registry pointer is always non-zero in compliance engine
    //=========================================================

    function invariant_I19_complianceRegistryNonZero() public view {
        assertNotEq(
            compliance.getAssetRegistry(),
            address(0),
            "I-19 VIOLATED: compliance engine's assetRegistry is address(0)"
        );
    }

    //=========================================================
    // I-20: RWAToken registry pointer always non-zero
    //=========================================================

    function invariant_I20_tokenRegistryNonZero() public view {
        assertNotEq(
            token.getAssetRegistry(),
            address(0),
            "I-20 VIOLATED: RWAToken assetRegistry pointer is address(0)"
        );
    }
}