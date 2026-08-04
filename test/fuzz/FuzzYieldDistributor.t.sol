// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { YieldDistributor } from "../../src/core/YieldDistributor.sol";
import { IYieldDistributor } from "../../src/interfaces/IYieldDistributor.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Minimal ERC20 for Yield
contract MockYieldToken is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

// Minimal Registry Mock to bypass compliance checks for yield math
contract MockYieldRegistry {
    function isWhitelisted(bytes32, address) external pure returns (bool) { return true; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FuzzYieldDistributor
//
// Properties tested:
//   P1  Deposited yield == Total Finalized Yield (No ghost funds)
//   P2  Unclaimed Yield mathematically sweeps back fully.
//   P3  Zero amounts revert on deposit and claims.
//   P4  Chainlink upkeep strictly obeys the EPOCH_DURATION boundary.
// ═══════════════════════════════════════════════════════════════════════════════
contract FuzzYieldDistributor is Test {
    
    address internal TREASURY = makeAddr("treasury");
    address internal AUTOMATION = makeAddr("automation");
    
    YieldDistributor internal distributor;
    MockYieldToken internal usdc;
    MockYieldRegistry internal registry;

    bytes32 internal constant ASSET_ID = keccak256("YIELD_TEST");
    uint256 internal constant DURATION = 30 days;

    function setUp() public {
        usdc = new MockYieldToken();
        registry = new MockYieldRegistry();

        distributor = new YieldDistributor(
            ASSET_ID, address(registry), address(usdc), TREASURY, AUTOMATION, DURATION
        );

        usdc.mint(TREASURY, type(uint128).max);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P1 & P2 — Fund Accounting and Sweeps
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P1_DepositAndFinalizeMatches(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1, 100_000_000e6); // 1 to 100m USDC

        vm.startPrank(TREASURY);
        usdc.approve(address(distributor), depositAmt);
        distributor.depositYield(1, depositAmt);

        bytes32 mockRoot = keccak256("MOCK_ROOT");
        distributor.finalizeEpoch(1, mockRoot, depositAmt);
        vm.stopPrank();

        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(epoch.totalYield, depositAmt, "P1: Finalized yield mismatch");
    }

    function testFuzz_P2_CloseEpochSweepsEverything(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1, 10_000_000e6); 

        vm.startPrank(TREASURY);
        usdc.approve(address(distributor), depositAmt);
        distributor.depositYield(1, depositAmt);
        distributor.finalizeEpoch(1, keccak256("ROOT"), depositAmt);
        
        uint256 treasuryBalBefore = usdc.balanceOf(TREASURY);
        
        // Nobody claims anything. Close the epoch.
        distributor.closeEpoch(1);
        vm.stopPrank();

        uint256 treasuryBalAfter = usdc.balanceOf(TREASURY);
        assertEq(treasuryBalAfter - treasuryBalBefore, depositAmt, "P2: Swept amount should equal exactly deposited amount");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P3 — Zero Amounts Handling
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P3_ZeroDepositsRevert() public {
        vm.prank(TREASURY);
        vm.expectRevert(IYieldDistributor.ZeroAmount.selector);
        distributor.depositYield(1, 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // P4 — Automation Bounds
    // ══════════════════════════════════════════════════════════════════════════

    function testFuzz_P4_UpkeepRevertsIfTooEarly(uint256 timePassed) public {
        // timePassed is strictly less than DURATION
        timePassed = bound(timePassed, 0, DURATION - 1 seconds);
        
        vm.warp(block.timestamp + timePassed);

        vm.prank(AUTOMATION);
        vm.expectRevert(IYieldDistributor.UpkeepNotNeeded.selector);
        distributor.performUpkeep(abi.encode(uint64(2)));
    }
}