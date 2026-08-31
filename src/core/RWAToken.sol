// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 }           from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Pausable }   from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IRWAToken }       from "../interfaces/IRWAToken.sol";
import { IAssetRegistry }  from "../interfaces/IAssetRegistry.sol";
import { IComplianceEngine } from "../interfaces/IComplianceEngine.sol";

/// @title RWAToken
/// @notice Compliance-enforced ERC-20 for Nexus RWA Protocol.
contract RWAToken is IRWAToken, ERC20, ERC20Pausable, Ownable2Step, ReentrancyGuard {

    //==================================================
    // STORAGE
    //==================================================

    bytes32 private immutable i_assetId;
    address private s_assetRegistry;
    address private s_complianceEngine;

    //==================================================
    // MODIFIERS
    //==================================================

    modifier onlyCompliance() {
        if (msg.sender != s_complianceEngine) revert CallerNotCompliance();
        _;
    }

    modifier onlyRegistryOrCompliance() {
        if (msg.sender != s_assetRegistry && msg.sender != s_complianceEngine) {
            revert CallerNotRegistry();
        }
        _;
    }

    //==================================================
    // CONSTRUCTOR
    //==================================================

    constructor(
        string memory name_,
        string memory symbol_,
        bytes32       assetId_,
        address      assetRegistry_,
        address       complianceEngine_
    )
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        if (assetRegistry_    == address(0)) revert ZeroAddress();
        if (complianceEngine_ == address(0)) revert ZeroAddress();
        if (assetId_          == bytes32(0)) revert ZeroAmount();

        i_assetId          = assetId_;
        s_assetRegistry    = assetRegistry_;
        s_complianceEngine = complianceEngine_;
    }

    //==================================================
    // CORE FUNCTIONS
    //==================================================

    /// @notice Mints new tokens. 
    function mint(address to, uint256 amount) external override onlyOwner whenNotPaused nonReentrant {
        if (to == address(0))  revert ZeroAddress();
        if (amount == 0)       revert ZeroAmount();

        IAssetRegistry registry = IAssetRegistry(s_assetRegistry);

        if (!registry.isAssetActive(i_assetId)) revert AssetNotActive(i_assetId);
        if (!registry.isWhitelisted(i_assetId, to)) revert NotWhitelisted(to);
        
        if (!registry.isMintAllowed(i_assetId, amount)) {
            uint256 currentCap = registry.getAssetInfo(i_assetId).totalSupplyCap;
            revert MintCapExceeded(i_assetId, currentCap, amount);
        }

        _mint(to, amount);
        
        registry.recordMint(i_assetId, amount);

        emit Minted(i_assetId, to, amount);
    }

    /// @notice Burns tokens from an investor. Allowed for both registry and compliance engine.
    function burn(address from, uint256 amount) external override onlyRegistryOrCompliance whenNotPaused nonReentrant {
        if (from   == address(0)) revert ZeroAddress();
        if (amount == 0)          revert ZeroAmount(); 

        uint256 bal = balanceOf(from);
        if (bal < amount) revert BurnExceedsBalance(from, bal, amount);

        _burn(from, amount);

        IAssetRegistry(s_assetRegistry).recordBurn(i_assetId, amount);

        emit Burned(i_assetId, from, amount);
    }

    /// @notice Forcefully moves tokens for legal/compliance reasons, bypassing the whitelist.
    function forcedTransfer(address from, address to, uint256 amount) external override onlyCompliance nonReentrant {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 bal = balanceOf(from);
        if (bal < amount) revert BurnExceedsBalance(from, bal, amount);

        ERC20._update(from, to, amount);

        emit ForcedTransfer(i_assetId, from, to, amount);
    }

    //==================================================
    // TRANSFER HOOK
    //==================================================

    /// @notice Ensures all P2P transfers happen only between legally compliant accounts.
    function _update(
        address from, 
        address to,
        uint256 amount
    ) internal override(ERC20, ERC20Pausable) {

        if (from != address(0) && to != address(0)) {
            IComplianceEngine(s_complianceEngine).enforceTransferCompliance(i_assetId, from, to);
        }

        super._update(from, to, amount);
    }

    //==================================================
    // ADMIN FUNCTIONS
    //==================================================

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    function setComplianceEngine(address newEngine) external override onlyOwner {
        if (newEngine == address(0)) revert ZeroAddress();
        address old = s_complianceEngine;
        s_complianceEngine = newEngine;
        emit ComplianceEngineUpdated(old, newEngine);
    }

    function setAssetRegistry(address newRegistry) external override onlyOwner {
        if (newRegistry == address(0)) revert ZeroAddress();
        address old = s_assetRegistry;
        s_assetRegistry = newRegistry;
        emit AssetRegistryUpdated(old, newRegistry);
    }

    //==================================================
    // VIEW FUNCTIONS
    //==================================================

    function assetId() external view override returns (bytes32) {
        return i_assetId;
    }

    function getAssetRegistry() external view override returns (address) {
        return s_assetRegistry;
    }

    function getComplianceEngine() external view override returns (address) {
        return s_complianceEngine;
    }

    function isWhitelisted(address account) external view override returns (bool) {
        return IAssetRegistry(s_assetRegistry).isWhitelisted(i_assetId, account);
    }
}
