// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { YieldDistributor } from "../../src/core/YieldDistributor.sol";
import { IYieldDistributor } from "../../src/interfaces/IYieldDistributor.sol";
import { MockAavePool } from "../mocks/MockAavePool.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ====================================================================
// MOCK USDC TOKEN
// ====================================================================
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ====================================================================
// MOCK REGISTRY FOR YIELD (To bypass heavy compliance setup)
// ====================================================================
contract MockRegistryForYield {
    function isWhitelisted(bytes32, address) external pure returns (bool) {
        return true; // Assume all test users are whitelisted for this yield test
    }
}

contract IntegrationYieldTest is Test {
    YieldDistributor public distributor;
    MockAavePool public aavePool;
    MockUSDC public usdc;
    MockRegistryForYield public registry;

    address public owner = makeAddr("owner");
    address public treasury = makeAddr("treasury");
    address public automationNode = makeAddr("automationNode");
    
    // Investors
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    bytes32 public constant ASSET_ID = keccak256("YIELD-ASSET-01");
    uint256 public constant EPOCH_DURATION = 30 days;

    function setUp() public {
        usdc = new MockUSDC();
        aavePool = new MockAavePool();
        registry = new MockRegistryForYield();

        vm.prank(owner);
        distributor = new YieldDistributor(
            ASSET_ID,
            address(registry),
            address(usdc),
            treasury, // Treasury has the 'Distributor' role
            automationNode,
            EPOCH_DURATION
        );

        // Seed Treasury with initial USDC to supply to Aave
        usdc.mint(treasury, 100_000 * 1e6); // $100k USDC
    }

    /// @dev Helper to generate a single leaf Merkle Root for Alice
    function _generateSingleLeafRoot(address _investor, uint256 _amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(_investor, _amount))));
    }

    // ================================================================
    // END-TO-END YIELD INTEGRATION FLOW
    // ================================================================

    function test_FullYieldLifecycle_AaveToInvestor() public {
        // ---------------------------------------------------------
        // STEP 1: Treasury supplies initial capital to Aave
        // ---------------------------------------------------------
        uint256 initialCapital = 100_000 * 1e6;
        
        vm.startPrank(treasury);
        usdc.approve(address(aavePool), initialCapital);
        aavePool.supply(address(usdc), initialCapital, treasury, 0);
        vm.stopPrank();

        // Treasury's USDC should be 0, but Aave balance should be 100k
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(aavePool.supplierBalances(address(usdc), treasury), initialCapital);

        // ---------------------------------------------------------
        // STEP 2: Time passes, Protocol generates Yield in Aave
        // ---------------------------------------------------------
        uint256 yieldGenerated = 5_000 * 1e6; // $5k yield generated over time
        
        // We use our MockAavePool helper to simulate interest accrual
        aavePool.addSimulatedYield(address(usdc), treasury, yieldGenerated);
        
        assertEq(aavePool.supplierBalances(address(usdc), treasury), initialCapital + yieldGenerated);

        // ---------------------------------------------------------
        // STEP 3: Treasury harvests ONLY the yield from Aave
        // ---------------------------------------------------------
        vm.prank(treasury);
        aavePool.withdraw(address(usdc), yieldGenerated, treasury);

        // Treasury now has $5k USDC liquid in hand
        assertEq(usdc.balanceOf(treasury), yieldGenerated);

        // ---------------------------------------------------------
        // STEP 4: Treasury deposits harvested yield to Distributor
        // ---------------------------------------------------------
        vm.startPrank(treasury);
        usdc.approve(address(distributor), yieldGenerated);
        distributor.depositYield(1, yieldGenerated);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(distributor)), yieldGenerated);

        // ---------------------------------------------------------
        // STEP 5: Calculate Merkle Root & Finalize Epoch
        // ---------------------------------------------------------
        // Let's say ALL $5k yield belongs to Alice for this asset
        bytes32 root = _generateSingleLeafRoot(alice, yieldGenerated);

        vm.prank(treasury);
        distributor.finalizeEpoch(1, root, yieldGenerated);

        IYieldDistributor.Epoch memory epoch = distributor.getEpoch(1);
        assertEq(uint8(epoch.status), uint8(IYieldDistributor.EpochStatus.FINALIZED));

        // ---------------------------------------------------------
        // STEP 6: Alice Claims her Yield!
        // ---------------------------------------------------------
        bytes32[] memory emptyProof = new bytes32[](0); // Single leaf requires no sibling proofs

        vm.prank(alice);
        distributor.claimYield(1, yieldGenerated, emptyProof);

        // Assert Alice got her USDC!
        assertEq(usdc.balanceOf(alice), yieldGenerated);
        assertTrue(distributor.hasClaimed(1, alice));

        // ---------------------------------------------------------
        // STEP 7: Close Epoch & Cycle completes
        // ---------------------------------------------------------
        vm.prank(treasury);
        distributor.closeEpoch(1);

        epoch = distributor.getEpoch(1);
        assertEq(uint8(epoch.status), uint8(IYieldDistributor.EpochStatus.CLOSED));
        assertEq(epoch.claimedYield, yieldGenerated);
    }
}