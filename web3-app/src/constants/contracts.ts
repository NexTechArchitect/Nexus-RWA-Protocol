import IdentityRegistryABI from './abis/IdentityRegistry.json';
import NAVOracleABI from './abis/NAVOracle.json';
import AssetRegistryABI from './abis/AssetRegistry.json';
import ComplianceEngineABI from './abis/ComplianceEngine.json';
import RWATokenABI from './abis/RWAToken.json';
import YieldDistributorABI from './abis/YieldDistributor.json';

export const BASE_CHAIN_ID = 8453;

export const CONTRACT_ADDRESSES = {
  IDENTITY_REGISTRY: '0x18026c0BF58c978caDc8Df7f31b1cbC2f6A94c5A' as `0x${string}`,
  NAV_ORACLE: '0xE4BeA2a081BA5d7137618840aFD012883014cbdD' as `0x${string}`,
  ASSET_REGISTRY: '0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594' as `0x${string}`,
  COMPLIANCE_ENGINE: '0x00c0E82e0C81c4Df096aAd98f2aA5A399b34131c' as `0x${string}`,
  RWA_TOKEN: '0xFDFda5Ca91bDC022EC85C9F2bE5d29A33f874EDE' as `0x${string}`,
  YIELD_DISTRIBUTOR: '0x8cbdAC28819d95b8425a0BdFD37610075F021996' as `0x${string}`,
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
};

export const CONTRACT_ABIS = {
  IDENTITY_REGISTRY: IdentityRegistryABI,
  NAV_ORACLE: NAVOracleABI,
  ASSET_REGISTRY: AssetRegistryABI,
  COMPLIANCE_ENGINE: ComplianceEngineABI,
  RWA_TOKEN: RWATokenABI,
  YIELD_DISTRIBUTOR: YieldDistributorABI,
};