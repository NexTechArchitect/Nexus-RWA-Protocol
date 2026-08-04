// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IRWAToken } from "../../src/interfaces/IRWAToken.sol";

/// @title MockRWAToken
/// @notice A simplified RWA Token for unit testing integrations.
/// @dev Bypasses strict compliance checks internally so parent contracts can be tested in isolation.
contract MockRWAToken is ERC20 {
    
    bytes32 private immutable i_assetId;
    address public complianceEngine;
    address public assetRegistry;

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_
    ) ERC20(name_, symbol_) {
        i_assetId = assetId_;
    }

    /// @notice Exposes assetId for ComplianceEngine checks
    function assetId() external view returns (bytes32) {
        return i_assetId;
    }

    /// @notice Unrestricted mint for test setup
    function mockMint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Unrestricted burn for test setup
    function mockBurn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    /// @notice Simulates forced transfer endpoint called by ComplianceEngine
    function forcedTransfer(address from, address to, uint256 amount) external {
        _transfer(from, to, amount);
    }

    /// @notice Mock setters for interface parity
    function setComplianceEngine(address newEngine) external {
        complianceEngine = newEngine;
    }

    function setAssetRegistry(address newRegistry) external {
        assetRegistry = newRegistry;
    }
}