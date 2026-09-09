<div align="center">

<img src="https://img.shields.io/badge/🏢_Nexus_RWA-Protocol-0052FF?style=for-the-badge&labelColor=0f172a&color=0052FF" height="36"/>

# Nexus RWA Protocol
### Institutional-Grade Real-World Asset Tokenization · Base Mainnet

<br>

[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](https://opensource.org/licenses/MIT)
[![Foundry](https://img.shields.io/badge/Built_With-Foundry-F0B90B?style=flat-square)](https://book.getfoundry.sh/)
[![Network](https://img.shields.io/badge/Network-Base_Mainnet-0052FF?style=flat-square)](https://basescan.org/)
[![Tests](https://img.shields.io/badge/Tests-219_Passing-22c55e?style=flat-square)](#)
[![Slither](https://img.shields.io/badge/Slither-0_Critical_0_High-22c55e?style=flat-square)](#)

<br>

> **Standard ERC-20 is the wrong primitive for regulated assets.**
> Nexus RWA encodes the compliance rulebook into the token itself. KYC, sanction enforcement,
> jurisdictional restrictions, and yield distribution run entirely on-chain. No off-chain gates.

<br>

[🚀 Live DApp](https://nexus-rwa-protocol.vercel.app/) &nbsp;·&nbsp;
[Assets](https://nexus-rwa-protocol.vercel.app/assets) &nbsp;·&nbsp;
[Identity](https://nexus-rwa-protocol.vercel.app/identity) &nbsp;·&nbsp;
[Compliance](https://nexus-rwa-protocol.vercel.app/compliance) &nbsp;·&nbsp;
[Oracle](https://nexus-rwa-protocol.vercel.app/oracle) &nbsp;·&nbsp;
[Yield](https://nexus-rwa-protocol.vercel.app/yield) &nbsp;·&nbsp;
[Docs](https://nexus-rwa-protocol.vercel.app/docs) &nbsp;·&nbsp;
[🔗 Core Registry on Basescan](https://basescan.org/address/0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594)

</div>


## The Problem

Most RWA tokenization projects bolt compliance on as an afterthought, a centralized server that approves transfers before they land on-chain. The blockchain records the outcome but not the rule. That compliance is invisible, revocable, and not verifiable by anyone reading the chain.

A US T-Bill cannot legally be held by an Iranian national. A corporate bond cannot be sold to an unaccredited investor in a restricted jurisdiction. These rules exist in securities law regardless of what the blockchain does.

Nexus RWA solves this by encoding the compliance rulebook directly into the token. Every mint, burn, and peer-to-peer transfer is evaluated against KYC status, OFAC sanction lists, accreditation tiers, and supply caps in a single atomic transaction. The rule is the contract. There is no off-chain gate to bypass, no approval to revoke, no server to take down.


## How It Works

The protocol is six contracts with strict separation of concerns. Identity does not know about assets. Assets do not execute compliance. Compliance does not hold any funds.

```
INVESTOR / DAPP
        |
        v
  RWAToken._update()           intercepts every balance movement
        |
        v
  ComplianceEngine             blacklist · sanction · whitelist · jurisdiction
     |          |
     v          v
IdentityRegistry   AssetRegistry
KYC · tier ·       supply cap · maturity ·
country · expiry   per-asset whitelist

NAVOracle           YieldDistributor
Chainlink feeds ·   Merkle tree ·
15% circuit breaker Chainlink Automation
```

### Transfer Flow

Every transfer runs four gates in sequence. One fails, the entire transaction reverts.

**Gate 1. Global blacklist and sanction check.** Both wallets checked against the ComplianceEngine blacklist and OFAC-hardcoded jurisdictions in JurisdictionLib. Iran (364), North Korea (408), Russia (643), Syria (760), Cuba (192), Venezuela (862) are permanent constants. No oracle, no feed, no delay.

**Gate 2. Per-asset whitelist.** Each asset has its own whitelist in AssetRegistry. Protocol-level KYC clearance is not sufficient. Per-asset registration is required for every individual security.

**Gate 3. Jurisdiction and accreditation.** JurisdictionLib checks whether the asset allows all jurisdictions or specific pairs. Accreditation level is enforced on the receiver, not the sender.

**Gate 4. Asset lifecycle and KYC expiry.** AssetRegistry confirms the asset is ACTIVE and not past maturity. KYC expiry is checked per wallet. Once expired, transfers revert with `KYCExpired` regardless of whitelist status.

All of this runs inside `_update()`, the same hook OpenZeppelin calls for every ERC-20 balance movement. There is no way to route around it from outside the contract.


## The Six Contracts

### IdentityRegistry

ERC-3643 inspired identity hub. Stores cryptographic commitments to off-chain PII. No raw personal data on-chain. Five verification tiers: NONE, BASIC, KYC, ACCREDITED, INSTITUTIONAL. Tier upgrades are unidirectional by design. A wallet can only move up, never down. KYC expiry is a 365-day window enforced on every transfer; `renewKYC()` refreshes it without re-registration. Identity is registered once and shared across every asset on the protocol.

### AssetRegistry

The supply ledger. Manages lifecycle (ACTIVE, PAUSED, FROZEN, REDEEMED), supply caps, maturity dates, and per-asset jurisdiction rules for four asset classes: T-Bills, real estate, corporate bonds, commodities. `recordMint()` and `recordBurn()` are called by the token on every supply change. The registry is always the source of truth on minted supply.

### ComplianceEngine

The central gatekeeper. Hooks into RWAToken to evaluate every transfer in real time. Manages global investor blacklisting, per-asset freeze/unfreeze, and legal forced transfers. `executeForcedTransfer()` bypasses the whitelist by calling `ERC20._update()` directly. Court-ordered seizures without proxy upgrades or contract migrations.

### RWAToken

Compliance-enforced ERC-20. `_update()` is overridden at the lowest level to call ComplianceEngine before any balance bit moves. `mint()` validates whitelist and supply cap before touching supply. `forcedTransfer()` is gated to ComplianceEngine only. Fully pausable. Supports multiple assets from a single implementation via the `assetId` binding.

### NAVOracle

Chainlink AggregatorV3 integration with a full validation pipeline on every read: round validity, round completeness, staleness guard (1 hour max), negative price rejection, dust price floor. Stores a 24-hour price snapshot per asset. If any subsequent read comes in more than 15% below that snapshot within the same window, the circuit breaker trips autonomously and all reads for that asset revert until the guardian manually resets it. Deliberate friction: automated systems should not silently resume after a 15% NAV crash.

### YieldDistributor

Pull-payment yield distribution that scales to any number of holders. The full allocation list is computed off-chain and committed as a 32-byte Merkle root. Investors claim by submitting their amount and a Merkle proof, constant-gas regardless of protocol size. Epoch cycles advance automatically via Chainlink Automation; no operator calls, no cron jobs. `s_hasClaimed[epochId][investor]` is written before the token transfer. Reentrant claims see the flag and revert with `AlreadyClaimed`. Batch claiming across up to 50 epochs in a single transaction.


## Deployed Contracts · Base Mainnet

| Contract | Address |
| --- | --- |
| **IdentityRegistry** | [`0x18026c0BF58c978caDc8Df7f31b1cbC2f6A94c5A`](https://basescan.org/address/0x18026c0BF58c978caDc8Df7f31b1cbC2f6A94c5A) |
| **AssetRegistry** | [`0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594`](https://basescan.org/address/0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594) |
| **ComplianceEngine** | [`0x00c0E82e0C81c4Df096aAd98f2aA5A399b34131c`](https://basescan.org/address/0x00c0E82e0C81c4Df096aAd98f2aA5A399b34131c) |
| **NAVOracle** | [`0xE4BeA2a081BA5d7137618840aFD012883014cbdD`](https://basescan.org/address/0xE4BeA2a081BA5d7137618840aFD012883014cbdD) |
| **Genesis Token (nUSTB)** | [`0xFDFda5Ca91bDC022EC85C9F2bE5d29A33f874EDE`](https://basescan.org/address/0xFDFda5Ca91bDC022EC85C9F2bE5d29A33f874EDE) |
| **YieldDistributor** | [`0x8cbdAC28819d95b8425a0BdFD37610075F021996`](https://basescan.org/address/0x8cbdAC28819d95b8425a0BdFD37610075F021996) |


## What Can Be Built On This

The compliance infrastructure here is not specific to any one asset class. Any protocol that needs permissioned token transfers with on-chain identity verification can plug into it.

Real estate tokenization with jurisdiction-specific investor pools. Corporate bonds with automated coupon distribution. Stablecoin systems where KYC is a transfer requirement. Lending protocols that want to enforce accreditation on collateral. Tokenized fund shares with automated NAV pricing and monthly yield settlement.

The architecture was deliberately designed with separation so that new asset types, new jurisdiction rules, and new yield strategies can be added without touching the compliance or identity layer.


## Local Setup

```bash
git clone https://github.com/NexTechArchitect/Nexus-RWA-Protocol.git
cd Nexus-RWA-Protocol

forge install
forge build
forge test -vvv
```


<div align="center">

Architected and engineered by [NexTech Architect](https://github.com/NexTechArchitect)

Smart Contract Security · RWA Tokenization · Foundry · Full Stack Web3

</div>
