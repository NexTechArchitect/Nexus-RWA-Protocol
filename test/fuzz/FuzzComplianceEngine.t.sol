// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { AssetRegistry }    from "../../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../../src/core/ComplianceEngine.sol";
import { MockRWAToken }     from "../mocks/MockRWAToken.sol";
import { IAssetRegistry }   from "../../src/interfaces/IAssetRegistry.sol";
import { IComplianceEngine } from "../../src/interfaces/IComplianceEngine.sol";
import { JurisdictionLib }  from "../../src/libraries/JurisdictionLib.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// FuzzComplianceEngine
//
// Property-based tests for ComplianceEngine using Foundry's fuzz engine.
// Properties tested:
//   P1  Block / Unblock state is perfectly boolean and globally enforced.
//   P2  Self-transfers always revert.
//   P3  Transfers involving any blocked investor always revert.
//   P4  Forced transfers bypass standard whitelist logic but respect asset mappings.
//   P5  Forced transfers of 0 tokens always revert.
//   P6  Only the Compliance Officer can execute privileged actions.
// ═══════════════════════════════════════════════════════════════════════════════
contract FuzzComplianceEngine is Test {
    
    address internal OWNER = makeAddr("owner");
    address internal REGISTRAR = makeAddr("registrar");
    address internal OFFICER = makeAddr("officer");

    AssetRegistry internal registry;
    ComplianceEngine internal engine;
    MockRWAToken internal token;

    bytes32 internal constant ASSET_ID = keccak256("BOND-1");
    uint16 internal constant SAFE_CODE = 840; // USA

    function setUp() public {
        vm.warp(1_000_000);

        token = new MockRWAToken("Nexus Bond", "NB", ASSET_ID);

        vm.startPrank(OWNER);
        registry = new AssetRegistry(REGISTRAR, address(this)); 
        engine = new ComplianceEngine(address(registry), OFFICER);
        registry.setComplianceEngine(address(engine));
        vm.stopPrank();

        vm.startPrank(REGISTRAR);
        registry.registerAsset(ASSET_ID, address(token), IAssetRegistry.AssetType.CORPORATE_BOND, SAFE_CODE, true, 0, 10_000_000e18, 0);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P1 — Global Block State
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P1_BlockAndUnblockIsConsistent(address investor) public {
        vm.assume(investor != address(0));

        vm.prank(OFFICER);
        engine.blockInvestor(investor);
        assertTrue(engine.isBlocked(investor), "P1: Investor should be blocked");

        vm.prank(OFFICER);
        engine.unblockInvestor(investor);
        assertFalse(engine.isBlocked(investor), "P1: Investor should be unblocked");
    }

    function testFuzz_P1_DoubleBlockReverts(address investor) public {
        vm.assume(investor != address(0));

        vm.prank(OFFICER);
        engine.blockInvestor(investor);

        vm.prank(OFFICER);
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.InvestorAlreadyBlocked.selector, investor));
        engine.blockInvestor(investor);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P2 & P3 — Transfer Invariants
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P2_SelfTransferAlwaysReverts(address user) public {
        vm.assume(user != address(0));
        
        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.SelfTransfer.selector, user));
        engine.enforceTransferCompliance(ASSET_ID, user, user);
    }

    function testFuzz_P3_TransferRevertsIfSenderBlocked(address sender, address receiver) public {
        vm.assume(sender != receiver);
        vm.assume(sender != address(0) && receiver != address(0));

        vm.prank(OFFICER);
        engine.blockInvestor(sender);

        vm.expectRevert(abi.encodeWithSelector(IComplianceEngine.BlockedInvestor.selector, sender));
        engine.enforceTransferCompliance(ASSET_ID, sender, receiver);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P4 & P5 — Forced Transfers (Legal Clawbacks)
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P4_ForcedTransferBalances(address from, address to, uint256 amount) public {
        vm.assume(from != to);
        vm.assume(from != address(0) && to != address(0));
        amount = bound(amount, 1, 1_000_000e18);

        // Pre-mint tokens to 'from' address
        token.mockMint(from, amount);

        vm.prank(OFFICER);
        engine.executeForcedTransfer(ASSET_ID, address(token), from, to, amount);

        assertEq(token.balanceOf(from), 0, "P4: Sender balance should be 0");
        assertEq(token.balanceOf(to), amount, "P4: Receiver balance should match transferred amount");
    }

    function testFuzz_P5_ForcedTransferZeroAmountReverts(address from, address to) public {
        vm.assume(from != to);
        vm.assume(from != address(0) && to != address(0));

        vm.prank(OFFICER);
        vm.expectRevert(IComplianceEngine.ZeroAmount.selector);
        engine.executeForcedTransfer(ASSET_ID, address(token), from, to, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P6 — Role Access Controls
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P6_RandomCallerCannotBlock(address rando, address target) public {
        vm.assume(rando != OFFICER && rando != OWNER);
        
        vm.prank(rando);
        vm.expectRevert(IComplianceEngine.OnlyComplianceOfficer.selector);
        engine.blockInvestor(target);
    }
}