// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockAavePool
/// @notice A simple Aave V3 Pool mock for testing yield strategies.
/// @dev Actually pulls and pushes ERC20 tokens to accurately simulate pool mechanics.
contract MockAavePool {
    
    mapping(address => mapping(address => uint256)) public supplierBalances; // asset => user => balance

    /// @notice Simulates supplying an asset to Aave.
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /* referralCode */
    ) external {
        // Pull underlying asset from caller
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        
        // Increase simulated aToken balance
        supplierBalances[asset][onBehalfOf] += amount;
    }

    /// @notice Simulates withdrawing an asset from Aave.
    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        uint256 currentBalance = supplierBalances[asset][msg.sender];
        
        // Handle type(uint256).max which Aave uses to mean "withdraw all"
        uint256 amountToWithdraw = amount == type(uint256).max ? currentBalance : amount;
        
        require(currentBalance >= amountToWithdraw, "MockAavePool: insufficient balance");

        // Decrease simulated aToken balance
        supplierBalances[asset][msg.sender] -= amountToWithdraw;
        
        // Push underlying asset to receiver
        IERC20(asset).transfer(to, amountToWithdraw);

        return amountToWithdraw;
    }

    /// @notice Helper for tests to simulate yield accrual (magically increases a user's balance).
    function addSimulatedYield(address asset, address user, uint256 yieldAmount) external {
        supplierBalances[asset][user] += yieldAmount;
    }
}