"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContracts, useReadContract } from "wagmi";
import { formatUnits } from "viem";

import { CONTRACT_ADDRESSES } from "@/constants/contracts";

// ---------------------------------------------------------------------------
// KNOWN ASSETS — extend as you deploy more RWATokens
// assetId is the bytes32 used during registerAsset()
// ---------------------------------------------------------------------------
const KNOWN_ASSETS = [
  {
    id: "0x5553545249455f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f00" as `0x${string}`,
    label: "US Treasury Bill",
    ticker: "nxTBILL",
  },
  {
    id: "0x5245414c5f45535441544500000000000000000000000000000000000000000000" as `0x${string}`,
    label: "Real Estate Fund",
    ticker: "nxRE",
  },
  {
    id: "0x434f52505f424f4e440000000000000000000000000000000000000000000000" as `0x${string}`,
    label: "Corporate Bond",
    ticker: "nxCORPB",
  },
] as const;

// ---------------------------------------------------------------------------
// DISPLAY MAPS
// ---------------------------------------------------------------------------
const ASSET_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: "Unregistered", color: "#9ca3af" },
  1: { label: "Active",       color: "#4ade80" },
  2: { label: "Paused",       color: "#fbbf24" },
  3: { label: "Frozen",       color: "#f87171" },
  4: { label: "Redeemed",     color: "#a78bfa" },
};

const ASSET_TYPE: Record<number, string> = {
  0: "None",
  1: "T-Bill",
  2: "Real Estate",
  3: "Corporate Bond",
  4: "Commodity",
};

const COUNTRY_CODES: Record<number, string> = {
  840: "US", 826: "GB", 276: "DE",
  392: "JP", 344: "HK", 702: "SG",
  356: "IN", 124: "CA", 36: "AU",
};

// ---------------------------------------------------------------------------
// MINIMAL ABI SLICES — typed inline so no cast needed
// ---------------------------------------------------------------------------
const REGISTRY_ABI = [
  {
    name: "getAssetInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{
      name: "info", type: "tuple",
      components: [
        { name: "assetId",               type: "bytes32"  },
        { name: "token",                 type: "address"  },
        { name: "status",                type: "uint8"    },
        { name: "assetType",             type: "uint8"    },
        { name: "decimals",              type: "uint8"    },
        { name: "issuerCountryCode",     type: "uint16"   },
        { name: "allowAllJurisdictions", type: "bool"     },
        { name: "minAccreditationLevel", type: "uint8"    },
        { name: "totalSupplyCap",        type: "uint256"  },
        { name: "mintedSupply",          type: "uint256"  },
        { name: "registeredAt",          type: "uint40"   },
        { name: "maturityDate",          type: "uint40"   },
      ],
    }],
  },
  {
    name: "isWhitelisted",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "assetId",  type: "bytes32" },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getInvestorData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{
      name: "data", type: "tuple",
      components: [
        { name: "countryCode",  type: "uint16" },
        { name: "isAccredited", type: "bool"   },
        { name: "isKYCVerified",type: "bool"   },
        { name: "kycExpiry",    type: "uint40" },
        { name: "registeredAt", type: "uint40" },
      ],
    }],
  },
] as const;

const COMPLIANCE_ABI = [
  {
    name: "isBlocked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getComplianceOfficer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const NAV_ABI = [
  {
    name: "getLatestNAV",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [
      { name: "price",     type: "int256"  },
      { name: "updatedAt", type: "uint40"  },
      { name: "decimals",  type: "uint8"   },
    ],
  },
  {
    name: "isCircuitBreakerTripped",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{ name: "tripped", type: "bool" }],
  },
  {
    name: "isPaused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type AssetInfo = {
  assetId: `0x${string}`;
  token: `0x${string}`;
  status: number;
  assetType: number;
  decimals: number;
  issuerCountryCode: number;
  allowAllJurisdictions: boolean;
  minAccreditationLevel: number;
  totalSupplyCap: bigint;
  mintedSupply: bigint;
  registeredAt: number;
  maturityDate: number;
};

type InvestorData = {
  countryCode: number;
  isAccredited: boolean;
  isKYCVerified: boolean;
  kycExpiry: number;
  registeredAt: number;
};

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function fmtAddr(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

function fmtSupply(raw: bigint, dec = 18) {
  const n = Number(formatUnits(raw, dec));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtNAV(price: bigint, dec: number) {
  return `$${Number(formatUnits(price, dec)).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  })}`;
}

function fmtDate(ts: number) {
  if (!ts) return "None";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function utilPct(minted: bigint, cap: bigint): number {
  if (!cap || cap === BigInt(0)) return 0;
  return Number((minted * BigInt(10000)) / cap) / 100;
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

function UtilBar({ pct }: { pct: number }) {
  const color = pct > 90 ? "#f87171" : pct > 70 ? "#fbbf24" : "#4ade80";
  return (
    <div className="util-track">
      <div className="util-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function Skeleton({ w = 72 }: { w?: number }) {
  return <span className="skel" style={{ width: w }} />;
}

function NavBadge({ price, decimals, tripped, oraclePaused }: {
  price?: bigint; decimals?: number; tripped?: boolean; oraclePaused?: boolean;
}) {
  if (oraclePaused) return <span className="badge-warn">Oracle paused</span>;
  if (tripped)      return <span className="badge-err"><IconAlert />Circuit open</span>;
  if (price === undefined || decimals === undefined) return <Skeleton />;
  return <span className="nav-val">{fmtNAV(price, decimals)}</span>;
}

// ---------------------------------------------------------------------------
// ASSET CARD
// ---------------------------------------------------------------------------
function AssetCard({
  meta,
  userAddr,
}: {
  meta: (typeof KNOWN_ASSETS)[number];
  userAddr?: `0x${string}`;
}) {
  // All reads in one multicall batch per card
  const registryCalls = useMemo(() => {
    const calls: any[] = [
      { address: CONTRACT_ADDRESSES.ASSET_REGISTRY, abi: REGISTRY_ABI, functionName: "getAssetInfo", args: [meta.id] },
    ];
    if (userAddr) {
      calls.push(
        { address: CONTRACT_ADDRESSES.ASSET_REGISTRY, abi: REGISTRY_ABI, functionName: "isWhitelisted", args: [meta.id, userAddr] },
      );
    }
    return calls;
  }, [meta.id, userAddr]);

  const navCalls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.NAV_ORACLE, abi: NAV_ABI, functionName: "getLatestNAV",           args: [meta.id] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE, abi: NAV_ABI, functionName: "isCircuitBreakerTripped", args: [meta.id] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE, abi: NAV_ABI, functionName: "isPaused",                args: [] },
  ], [meta.id]);

  const { data: regData, isLoading: regLoading } = useReadContracts({ contracts: registryCalls });
  const { data: navData }                         = useReadContracts({ contracts: navCalls });

  // Token balance + paused (only when we have the token address from info)
  const info        = regData?.[0]?.result as AssetInfo | undefined;
  const whitelisted = userAddr ? (regData?.[1]?.result as boolean | undefined) : undefined;

  const tokenCalls = useMemo(() => {
    if (!info?.token || !userAddr) return [];
    return [
      { address: info.token as `0x${string}`, abi: TOKEN_ABI, functionName: "balanceOf", args: [userAddr] },
      { address: info.token as `0x${string}`, abi: TOKEN_ABI, functionName: "paused",    args: [] },
    ];
  }, [info?.token, userAddr]);

  const { data: tokenData } = useReadContracts({ contracts: tokenCalls });

  const navResult   = navData?.[0]?.result as [bigint, number, number] | undefined;
  const cbTripped   = navData?.[1]?.result as boolean | undefined;
  const oraclePaused= navData?.[2]?.result as boolean | undefined;
  const userBalance = tokenData?.[0]?.result as bigint | undefined;
  const tokenPaused = tokenData?.[1]?.result as boolean | undefined;

  const st   = ASSET_STATUS[info?.status ?? -1] ?? ASSET_STATUS[0];
  const pct  = info ? utilPct(info.mintedSupply, info.totalSupplyCap) : 0;
  const isFrozen = info?.status === 3;

  return (
    <article className={`card${isFrozen ? " card-frozen" : ""}`}>
      {/* ── HEAD ── */}
      <div className="card-head">
        <div className="card-icon" data-type={info?.assetType ?? 0}>
          {info?.assetType === 1 && <IconTBill />}
          {info?.assetType === 2 && <IconRE />}
          {info?.assetType === 3 && <IconBond />}
          {(!info?.assetType || info.assetType > 3) && <IconGeneric />}
        </div>
        <div className="card-title-group">
          <span className="card-ticker">{meta.ticker}</span>
          <span className="card-label">{meta.label}</span>
        </div>
        <div className="card-badges">
          <span className="status-badge" style={{ "--dot": st.color } as React.CSSProperties}>
            <i className="status-dot" />
            {regLoading ? <Skeleton w={48} /> : st.label}
          </span>
          {tokenPaused && <span className="badge-warn-sm">Token paused</span>}
          {userAddr && whitelisted !== undefined && (
            <span className={`wl-badge${whitelisted ? " ok" : " no"}`}>
              {whitelisted ? "Whitelisted" : "Not listed"}
            </span>
          )}
        </div>
      </div>

      {/* ── NAV + META ROW ── */}
      <div className="data-row">
        <div className="data-cell">
          <span className="cell-label">NAV / unit</span>
          <NavBadge
            price={navResult?.[0]}
            decimals={navResult?.[2]}
            tripped={cbTripped}
            oraclePaused={oraclePaused}
          />
        </div>
        <div className="data-cell">
          <span className="cell-label">Type</span>
          <span className="cell-val">{ASSET_TYPE[info?.assetType ?? 0] ?? "—"}</span>
        </div>
        <div className="data-cell">
          <span className="cell-label">Issuer</span>
          <span className="cell-val">
            {COUNTRY_CODES[info?.issuerCountryCode ?? 0] ??
              (info?.issuerCountryCode ? `CC${info.issuerCountryCode}` : "—")}
          </span>
        </div>
        {userAddr && userBalance !== undefined && (
          <div className="data-cell">
            <span className="cell-label">Your balance</span>
            <span className="cell-val accent">
              {fmtSupply(userBalance, info?.decimals)} {meta.ticker}
            </span>
          </div>
        )}
      </div>

      {/* ── SUPPLY UTIL ── */}
      <div className="supply-block">
        <div className="supply-header">
          <span className="cell-label">Supply utilisation</span>
          <span className="supply-pct">{pct.toFixed(1)}%</span>
        </div>
        <UtilBar pct={pct} />
        <div className="supply-nums">
          <span>{info ? fmtSupply(info.mintedSupply, info.decimals) : "—"} minted</span>
          <span>{info ? fmtSupply(info.totalSupplyCap, info.decimals) : "—"} cap</span>
        </div>
      </div>

      {/* ── META TABLE ── */}
      <dl className="meta-table">
        <div className="meta-row">
          <dt>Token</dt>
          <dd>
            {info ? (
              <a href={`https://basescan.org/address/${info.token}`}
                 target="_blank" rel="noopener noreferrer" className="mono-link">
                {fmtAddr(info.token)}
                <IconExternal />
              </a>
            ) : "—"}
          </dd>
        </div>
        <div className="meta-row">
          <dt>Maturity</dt>
          <dd>{info ? fmtDate(info.maturityDate) : "—"}</dd>
        </div>
        <div className="meta-row">
          <dt>Registered</dt>
          <dd>{info ? fmtDate(info.registeredAt) : "—"}</dd>
        </div>
        <div className="meta-row">
          <dt>Accreditation</dt>
          <dd>{info
            ? info.minAccreditationLevel === 0 ? "None required" : `Level ${info.minAccreditationLevel}+`
            : "—"}
          </dd>
        </div>
        <div className="meta-row">
          <dt>Jurisdictions</dt>
          <dd>{info ? (info.allowAllJurisdictions ? "Global" : "Restricted") : "—"}</dd>
        </div>
      </dl>

      {/* ── FOOTER ── */}
      <div className="card-footer">
        <a href={`https://basescan.org/address/${info?.token ?? ""}`}
           target="_blank" rel="noopener noreferrer" className="btn-ghost">
          BaseScan <IconExternal />
        </a>
        <button className="btn-dark" disabled={!whitelisted || isFrozen || !!tokenPaused}>
          {isFrozen ? "Asset frozen" : tokenPaused ? "Token paused" : whitelisted ? "Manage" : "KYC required"}
        </button>
      </div>

      {regLoading && <div className="card-shimmer" />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// IDENTITY PANEL
// ---------------------------------------------------------------------------
function IdentityPanel({ address }: { address: `0x${string}` }) {
  const calls = useMemo(() => [
    {
      address: CONTRACT_ADDRESSES.ASSET_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "getInvestorData" as const,
      args: [address] as [`0x${string}`],
    },
    {
      address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE,
      abi: COMPLIANCE_ABI,
      functionName: "isBlocked" as const,
      args: [address] as [`0x${string}`],
    },
  ], [address]);

  const { data, isLoading } = useReadContracts({ contracts: calls });

  const inv     = data?.[0]?.result as InvestorData | undefined;
  const blocked = data?.[1]?.result as boolean | undefined;

  const kycOk    = inv?.isKYCVerified && (inv.kycExpiry * 1000) > Date.now();
  const expiringSoon = kycOk && (inv!.kycExpiry * 1000 - Date.now()) < 30 * 86400 * 1000;

  return (
    <div className="id-panel">
      <div className="id-head">
        <div className="id-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div>
          <p className="id-addr">{fmtAddr(address)}</p>
          <p className="id-net">Base Mainnet · ERC-3643</p>
        </div>
        <div className="id-pills">
          {isLoading ? <Skeleton w={80} /> : (
            <>
              <span className={`pill${kycOk ? " ok" : " no"}`}>
                {kycOk ? "KYC active" : "KYC inactive"}
              </span>
              {blocked && <span className="pill err">Blocked</span>}
            </>
          )}
        </div>
      </div>

      {blocked && (
        <div className="alert-err">
          This address is globally blocked by the compliance officer. All transfers are disabled.
        </div>
      )}

      {inv && (
        <div className="id-grid">
          {[
            { label: "Accreditation", val: inv.isAccredited ? "Accredited" : "Standard", ok: inv.isAccredited },
            { label: "Country",       val: COUNTRY_CODES[inv.countryCode] ?? `CC ${inv.countryCode}`, ok: false },
            { label: "KYC expires",   val: fmtDate(inv.kycExpiry), warn: expiringSoon },
            { label: "Registered",    val: fmtDate(inv.registeredAt), ok: false },
          ].map(({ label, val, ok, warn }) => (
            <div key={label} className="id-cell">
              <span className="id-cell-label">{label}</span>
              <span className={`id-cell-val${ok ? " ok" : ""}${warn ? " warn" : ""}`}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {!inv && !isLoading && (
        <p className="id-empty">No identity record found. Contact the registrar to complete KYC onboarding.</p>
      )}

      {expiringSoon && (
        <div className="alert-warn">KYC expires in under 30 days. Renew now to avoid transfer failure.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// STATS STRIP
// ---------------------------------------------------------------------------
function StatsStrip() {
  const { data } = useReadContract({
    address: CONTRACT_ADDRESSES.NAV_ORACLE,
    abi: NAV_ABI,
    functionName: "isPaused",
    args: [],
  });
  const oraclePaused = data as boolean | undefined;

  return (
    <div className="stats-strip">
      {[
        { label: "Protocol",  val: "Nexus RWA" },
        { label: "Network",   val: <><i className="base-dot" />Base Mainnet</> },
        { label: "Standard",  val: "ERC-3643"  },
        { label: "Assets",    val: `${KNOWN_ASSETS.length} live` },
        { label: "Oracle",    val: oraclePaused ? "⚠ Paused" : "Active" },
      ].map(({ label, val }, i, arr) => (
        <div key={label} className="ss-group">
          <div className="ss-item">
            <span className="ss-label">{label}</span>
            <span className="ss-val">{val}</span>
          </div>
          {i < arr.length - 1 && <div className="ss-div" />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONTRACT ADDRESS TABLE
// ---------------------------------------------------------------------------
const CONTRACT_LIST = [
  { name: "Asset Registry",    addr: CONTRACT_ADDRESSES.ASSET_REGISTRY    },
  { name: "Compliance Engine", addr: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE  },
  { name: "NAV Oracle",        addr: CONTRACT_ADDRESSES.NAV_ORACLE        },
  { name: "RWA Token",         addr: CONTRACT_ADDRESSES.RWA_TOKEN         },
  { name: "Yield Distributor", addr: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR },
  { name: "Identity Registry", addr: CONTRACT_ADDRESSES.IDENTITY_REGISTRY },
];

function ContractTable() {
  return (
    <div className="addr-table">
      {CONTRACT_LIST.map(({ name, addr }) => (
        <div className="addr-row" key={name}>
          <span className="addr-name">{name}</span>
          <a href={`https://basescan.org/address/${addr}`}
             target="_blank" rel="noopener noreferrer" className="addr-mono">
            {addr}
            <IconExternal />
          </a>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NAV BAR
// ---------------------------------------------------------------------------
function Nav({ address }: { address?: string }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <header className={`nav${scrolled ? " nav-s" : ""}`}>
      <Link href="/" className="brand">
        <div className="brand-mark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="#fff" opacity=".95" />
            <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="#f97316" />
          </svg>
        </div>
        <span className="brand-name">Nexus RWA</span>
      </Link>

      <nav className="nav-links" aria-label="Main">
        {(["Assets","Identity","Compliance","Oracle","Yield","Docs"] as const).map((l) => (
          <Link key={l} href={`/${l.toLowerCase()}`}
                className={`nav-link${l === "Assets" ? " active" : ""}`}>
            {l}
          </Link>
        ))}
      </nav>

      <div className="nav-end">
        <ConnectButton label="Connect" accountStatus="address" chainStatus="none" showBalance={false} />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
function IconTBill() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v4H3z" /><path d="M12 7v14M8 21h8" /></svg>;
}
function IconRE() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M8 11h2v4H8zM14 11h2v4h-2z" /></svg>;
}
function IconBond() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 8h10M7 12h10M7 16h6" /><rect x="3" y="4" width="18" height="16" rx="2" /></svg>;
}
function IconGeneric() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
}
function IconExternal() {
  return <svg width="10" height="10" viewBox="0 0 11 11" fill="none"><path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconAlert() {
  return <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1L11 10H1L6 1Z" fill="#f87171"/></svg>;
}

// ---------------------------------------------------------------------------
// ROOT
// ---------------------------------------------------------------------------
export default function AssetsPage() {
  const { address } = useAccount();
  const [entered, setEntered] = useState(false);
  useEffect(() => { const t = setTimeout(() => setEntered(true), 60); return () => clearTimeout(t); }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{CSS}</style>
      <Nav address={address} />

      <main className={`main${entered ? " in" : ""}`}>
        {/* Page header */}
        <div className="page-header">
          <div className="page-header-inner">
            <p className="page-tag">Registry</p>
            <h1 className="page-h1">Asset Dashboard</h1>
            <p className="page-sub">
              Live on-chain data direct from deployed contracts on Base.
            </p>
          </div>
          <StatsStrip />
        </div>

        <div className="page-body">
          {/* Identity panel */}
          {address && (
            <section className="section">
              <h2 className="section-label">Your identity</h2>
              <IdentityPanel address={address as `0x${string}`} />
            </section>
          )}

          {!address && (
            <div className="connect-nudge">
              <p>Connect your wallet to see whitelist status, KYC details, and token balances per asset.</p>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className="btn-dark-sm" onClick={openConnectModal}>Connect wallet</button>
                )}
              </ConnectButton.Custom>
            </div>
          )}

          {/* Assets */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Registered assets</h2>
              <span className="count-pill">{KNOWN_ASSETS.length}</span>
            </div>
            <div className="grid">
              {KNOWN_ASSETS.map((a) => (
                <AssetCard key={a.id} meta={a} userAddr={address as `0x${string}` | undefined} />
              ))}
            </div>
          </section>

          {/* Contracts */}
          <section className="section">
            <h2 className="section-label">Contract addresses</h2>
            <ContractTable />
          </section>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:#f9f8f5;font-family:'Inter',sans-serif;color:#18160f;overflow-x:hidden;-webkit-font-smoothing:antialiased}
::selection{background:#f97316;color:#fff}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:#f9f8f5}
::-webkit-scrollbar-thumb{background:#d4d0c8;border-radius:4px}

/* NAV */
.nav{position:fixed;top:0;left:0;right:0;z-index:400;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;height:56px;padding:0 24px;background:rgba(249,248,245,0.9);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border-bottom:1px solid rgba(0,0,0,0.07);transition:box-shadow .25s}
.nav-s{box-shadow:0 2px 20px rgba(0,0,0,0.07)}
.brand{display:flex;align-items:center;gap:9px;text-decoration:none;flex-shrink:0}
.brand-mark{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#f97316,#ef4444);display:grid;place-items:center;flex-shrink:0}
.brand-name{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#18160f;letter-spacing:-0.01em}
.nav-links{display:flex;align-items:center;justify-content:center;gap:2px}
.nav-link{padding:5px 12px;border-radius:7px;font-size:13px;font-weight:500;color:#6b6355;text-decoration:none;transition:color .13s,background .13s;white-space:nowrap}
.nav-link:hover{color:#18160f;background:rgba(0,0,0,0.05)}
.nav-link.active{color:#f97316;background:#fff7ed}
.nav-end{display:flex;align-items:center;gap:9px;flex-shrink:0}

/* MAIN */
.main{padding-top:56px;min-height:100vh;opacity:0;transform:translateY(14px);transition:opacity .55s cubic-bezier(.16,1,.3,1),transform .55s cubic-bezier(.16,1,.3,1)}
.main.in{opacity:1;transform:none}

/* PAGE HEADER */
.page-header{background:rgba(255,255,255,0.55);border-bottom:1px solid rgba(0,0,0,0.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.page-header-inner{max-width:1100px;margin:0 auto;padding:40px 28px 28px}
.page-tag{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f97316;margin-bottom:8px}
.page-h1{font-family:'Syne',sans-serif;font-size:clamp(1.8rem,4vw,2.8rem);font-weight:800;line-height:1.08;letter-spacing:-0.03em;color:#18160f;margin-bottom:10px}
.page-sub{font-size:14.5px;line-height:1.7;color:#7c7363;max-width:520px}

/* STATS STRIP */
.stats-strip{max-width:1100px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;gap:0}
.ss-group{display:flex;align-items:center;flex-shrink:0}
.ss-item{display:flex;flex-direction:column;gap:2px;padding:0 18px}
.ss-item:first-of-type{padding-left:0}
.ss-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.ss-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#18160f;display:flex;align-items:center;gap:5px}
.base-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#0052ff;flex-shrink:0}
.ss-div{width:1px;height:26px;background:rgba(0,0,0,0.08);flex-shrink:0}

/* PAGE BODY */
.page-body{max-width:1100px;margin:0 auto;padding:32px 28px 80px;display:flex;flex-direction:column;gap:36px}

/* SECTION */
.section{display:flex;flex-direction:column;gap:14px}
.section-head{display:flex;align-items:center;gap:10px}
.section-label{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7c7363}
.count-pill{padding:2px 8px;border-radius:99px;background:#fff7ed;border:1px solid #fed7aa;font-size:10px;font-weight:700;color:#c2410c;letter-spacing:.06em}

/* IDENTITY PANEL */
.id-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:20px 22px;display:flex;flex-direction:column;gap:16px}
.id-head{display:flex;align-items:center;gap:12px}
.id-avatar{width:40px;height:40px;border-radius:10px;background:#f3f0e8;display:grid;place-items:center;color:#7c7363;flex-shrink:0}
.id-avatar svg{width:20px;height:20px}
.id-addr{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.id-net{font-size:12px;color:#a09890;margin-top:1px}
.id-pills{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}
.pill{font-size:11px;font-weight:600;padding:3px 10px;border-radius:6px;border:1px solid}
.pill.ok{background:#f0fdf4;color:#16a34a;border-color:#bbf7d0}
.pill.no{background:#fef2f2;color:#dc2626;border-color:#fecaca}
.pill.err{background:#fef2f2;color:#dc2626;border-color:#fecaca}
.id-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.id-cell{display:flex;flex-direction:column;gap:4px;padding:12px 14px;background:#faf9f6}
.id-cell-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.id-cell-val{font-size:13px;font-weight:600;color:#18160f}
.id-cell-val.ok{color:#16a34a}
.id-cell-val.warn{color:#d97706}
.id-empty{font-size:13.5px;color:#9ca3af;text-align:center;padding:12px 0}
.alert-warn{padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:13px;color:#c2410c;font-weight:500}
.alert-err{padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:13px;color:#dc2626;font-weight:500}

/* ASSET CARD */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.card{position:relative;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:20px;display:flex;flex-direction:column;gap:18px;transition:transform .2s,box-shadow .2s;overflow:hidden}
.card:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(0,0,0,0.05),0 16px 36px rgba(0,0,0,0.09)}
.card-frozen{border-color:rgba(248,113,113,0.3);background:rgba(255,240,240,0.6)}
.card-shimmer{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#f97316 0%,#fbbf24 50%,#f97316 100%);background-size:200% 100%;animation:shimmer 1.6s linear infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* card head */
.card-head{display:flex;align-items:center;gap:12px}
.card-icon{width:44px;height:44px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;display:grid;place-items:center;color:#f97316;flex-shrink:0}
.card-icon svg{width:20px;height:20px}
.card-title-group{flex:1;min-width:0}
.card-ticker{display:block;font-family:'Syne',sans-serif;font-size:15px;font-weight:800;color:#18160f;letter-spacing:-0.01em}
.card-label{display:block;font-size:12px;color:#7c7363;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-badges{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0}
.status-badge{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#5a5245}
.status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dot);flex-shrink:0;animation:pulse 2.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.28}}
.wl-badge{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:4px}
.wl-badge.ok{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
.wl-badge.no{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.badge-warn-sm{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;letter-spacing:.05em;text-transform:uppercase}

/* data row */
.data-row{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.data-row:has(.data-cell:nth-child(4)){grid-template-columns:repeat(4,1fr)}
.data-cell{background:#faf9f6;padding:10px 12px;display:flex;flex-direction:column;gap:3px}
.cell-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.cell-val{font-size:13px;font-weight:600;color:#18160f}
.cell-val.accent{color:#f97316}
.nav-val{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.badge-warn{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#c2410c}
.badge-err{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#dc2626}

/* supply */
.supply-block{display:flex;flex-direction:column;gap:6px}
.supply-header{display:flex;justify-content:space-between;align-items:center}
.supply-pct{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#18160f}
.util-track{height:4px;border-radius:2px;background:rgba(0,0,0,0.07);overflow:hidden}
.util-fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.16,1,.3,1)}
.supply-nums{display:flex;justify-content:space-between;font-size:11px;color:#a09890}

/* meta table */
.meta-table{display:flex;flex-direction:column;border:1px solid rgba(0,0,0,0.06);border-radius:10px;overflow:hidden;list-style:none}
.meta-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;font-size:12.5px;border-bottom:1px solid rgba(0,0,0,0.04)}
.meta-row:last-child{border-bottom:none}
.meta-row dt{color:#7c7363;font-weight:400}
.meta-row dd{font-weight:500;color:#18160f}
.mono-link{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:flex;align-items:center;gap:4px;transition:opacity .13s}
.mono-link:hover{opacity:.75}

/* card footer */
.card-footer{display:flex;gap:8px;align-items:center;padding-top:4px;border-top:1px solid rgba(0,0,0,0.05)}
.btn-ghost{display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:500;color:#7c7363;background:rgba(0,0,0,0.04);text-decoration:none;transition:all .14s}
.btn-ghost:hover{background:rgba(0,0,0,0.08);color:#18160f}
.btn-dark{margin-left:auto;padding:7px 16px;border-radius:8px;font-size:12.5px;font-weight:600;background:#18160f;color:#fff;border:none;cursor:pointer;transition:background .15s,transform .15s;font-family:'Inter',sans-serif}
.btn-dark:hover:not(:disabled){background:#2e2a1e;transform:translateY(-1px)}
.btn-dark:disabled{background:#e5e1d8;color:#a09890;cursor:not-allowed}

/* connect nudge */
.connect-nudge{display:flex;align-items:center;gap:16px;padding:14px 18px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:12px;font-size:13.5px;color:#7c7363;backdrop-filter:blur(12px)}
.btn-dark-sm{padding:8px 16px;border-radius:8px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .15s}
.btn-dark-sm:hover{background:#2e2a1e}

/* contracts */
.addr-table{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:12px;backdrop-filter:blur(12px);overflow:hidden}
.addr-row{display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-bottom:1px solid rgba(0,0,0,0.05);gap:16px}
.addr-row:last-child{border-bottom:none}
.addr-name{font-size:13px;font-weight:600;color:#18160f;flex-shrink:0}
.addr-mono{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:opacity .13s}
.addr-mono:hover{opacity:.75}

/* skeleton */
.skel{display:inline-block;height:14px;border-radius:4px;background:linear-gradient(90deg,#edeae4 25%,#e0dcd5 50%,#edeae4 75%);background-size:200% 100%;animation:skel 1.4s linear infinite;vertical-align:middle}
@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* rainbowkit */
[data-rk] button{font-family:'Inter',sans-serif!important;font-weight:600!important;font-size:13px!important;border-radius:8px!important}

/* responsive */
@media(max-width:640px){
  .nav{grid-template-columns:1fr auto;gap:8px;padding:0 16px}
  .nav-links{display:none}
  .page-header-inner{padding:28px 16px 20px}
  .stats-strip{padding:14px 16px}
  .ss-item{padding:0 10px}
  .page-body{padding:24px 16px 64px;gap:28px}
  .grid{grid-template-columns:1fr}
  .id-grid{grid-template-columns:repeat(2,1fr)}
  .connect-nudge{flex-direction:column;align-items:flex-start;gap:10px}
  .addr-row{flex-direction:column;align-items:flex-start}
  .addr-mono{font-size:10.5px}
  .data-row{grid-template-columns:repeat(2,1fr)}
  .data-row:has(.data-cell:nth-child(4)){grid-template-columns:repeat(2,1fr)}
}
@media(min-width:641px) and (max-width:900px){
  .grid{grid-template-columns:repeat(2,1fr)}
  .id-grid{grid-template-columns:repeat(2,1fr)}
  .nav-links{gap:0}
  .nav-link{padding:5px 9px;font-size:12.5px}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;