// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";

// Core Contracts
import { IdentityRegistry } from "../src/core/IdentityRegistry.sol";
import { AssetRegistry }    from "../src/core/AssetRegistry.sol";
import { ComplianceEngine } from "../src/core/ComplianceEngine.sol";
import { NAVOracle }        from "../src/core/NAVOracle.sol";
import { RWAToken }         from "../src/core/RWAToken.sol";
import { YieldDistributor } from "../src/core/YieldDistributor.sol";

// Interfaces
import { IAssetRegistry }   from "../src/interfaces/IAssetRegistry.sol";

/// @title Nexus RWA Protocol Deployment Script
/// @notice Production-ready deployment script for local testnet & Mainnets.
/// @dev Reads all critical addresses exclusively from the .env file.
contract DeployScript is Script {
    
    // Roles & Configuration
    address public registrar;
    address public complianceOfficer;
    address public verifier;
    address public guardian;
    address public yieldDistributorRole;
    address public automationNode;
    address public yieldToken;

    // Genesis Asset Details (US Treasury Bill Token)
    bytes32 public constant GENESIS_ASSET_ID = keccak256("NEXUS_US_TBILL_01");
    uint256 public constant GENESIS_SUPPLY_CAP = 50_000_000 * 1e18; // 50M Cap
    uint16  public constant USA_COUNTRY_CODE = 840;
    uint256 public constant EPOCH_DURATION = 30 days;

    function setUp() public {
        // Load all configuration directly from the .env file (No hardcoded addresses)
        registrar            = vm.envAddress("REGISTRAR_ADDRESS");
        complianceOfficer    = vm.envAddress("COMPLIANCE_OFFICER_ADDRESS");
        verifier             = vm.envAddress("VERIFIER_ADDRESS");
        guardian             = vm.envAddress("GUARDIAN_ADDRESS");
        yieldDistributorRole = vm.envAddress("YIELD_DISTRIBUTOR_ROLE");
        automationNode       = vm.envAddress("AUTOMATION_NODE_ADDRESS");
        yieldToken           = vm.envAddress("YIELD_TOKEN_ADDRESS");
    }

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);

        console2.log("=========================================");
        console2.log(" DEPLOYING NEXUS RWA PROTOCOL");
        console2.log("=========================================");
        console2.log("Deployer Address:    ", deployerAddress);
        console2.log("Yield Token (USDC):  ", yieldToken);

        vm.startBroadcast(deployerPrivateKey);

        // --------------------------------------------------------------------
        // PHASE 1: BASE INFRASTRUCTURE
        // --------------------------------------------------------------------
        console2.log("\n[Phase 1] Deploying Registries & Oracle...");
        
        IdentityRegistry identityRegistry = new IdentityRegistry(verifier);
        console2.log(" -> IdentityRegistry: ", address(identityRegistry));

        NAVOracle navOracle = new NAVOracle(guardian);
        console2.log(" -> NAVOracle:        ", address(navOracle));

        // --------------------------------------------------------------------
        // PHASE 2: CORE & COMPLIANCE ENGINE
        // --------------------------------------------------------------------
        console2.log("\n[Phase 2] Linking Compliance Engine...");

        // Deploy AssetRegistry with dummy compliance pointer to bypass 0x0 validation
        address dummyCompliance = address(0xDEAD);
        AssetRegistry assetRegistry = new AssetRegistry(registrar, dummyCompliance);
        console2.log(" -> AssetRegistry:    ", address(assetRegistry));

        // Deploy ComplianceEngine with real AssetRegistry
        ComplianceEngine complianceEngine = new ComplianceEngine(address(assetRegistry), complianceOfficer);
        console2.log(" -> ComplianceEngine: ", address(complianceEngine));

        // Link real ComplianceEngine back to AssetRegistry
        assetRegistry.setComplianceEngine(address(complianceEngine));
        console2.log(" -> [Wired] AssetRegistry <-> ComplianceEngine linked.");

        // --------------------------------------------------------------------
        // PHASE 3: GENESIS ASSET (US T-Bill Token)
        // --------------------------------------------------------------------
        console2.log("\n[Phase 3] Deploying Genesis RWA Token...");

        RWAToken genesisToken = new RWAToken(
            "Nexus US Treasury Bill",
            "nUSTB",
            GENESIS_ASSET_ID,
            address(assetRegistry),
            address(complianceEngine)
        );
        console2.log(" -> RWAToken (nUSTB): ", address(genesisToken));

        // Register asset in registry
        assetRegistry.registerAsset(
            GENESIS_ASSET_ID,
            address(genesisToken),
            IAssetRegistry.AssetType.T_BILL,
            USA_COUNTRY_CODE,
            true,                // allowAllJurisdictions
            0,                   // minAccreditationLevel
            GENESIS_SUPPLY_CAP,
            0                    // Perpetual
        );
        console2.log(" -> [Registered] Genesis Asset registered in AssetRegistry.");

        // --------------------------------------------------------------------
        // PHASE 4: YIELD DISTRIBUTOR
        // --------------------------------------------------------------------
        console2.log("\n[Phase 4] Deploying Yield Distributor...");

        YieldDistributor yieldDistributor = new YieldDistributor(
            GENESIS_ASSET_ID,
            address(assetRegistry),
            yieldToken,
            yieldDistributorRole,
            automationNode,
            EPOCH_DURATION
        );
        console2.log(" -> YieldDistributor: ", address(yieldDistributor));

        vm.stopBroadcast();

        console2.log("\n=========================================");
        console2.log(" DEPLOYMENT SUCCESSFUL!");
        console2.log("=========================================");
    }
}