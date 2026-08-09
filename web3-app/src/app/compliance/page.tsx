"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContracts, useReadContract } from "wagmi";

import { CONTRACT_ADDRESSES } from "@/constants/contracts";

// ---------------------------------------------------------------------------
// KNOWN ASSETS — same as assets page
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
// ABI SLICES
// ---------------------------------------------------------------------------
const COMPLIANCE_ABI = [
  {
    name: "isBlocked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "investor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "canTransfer",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "assetId",  type: "bytes32" },
      { name: "from",     type: "address" },
      { name: "to",       type: "address" },
    ],
    outputs: [{ name: "ok", type: "bool" }],
  },
  {
    name: "getComplianceOfficer",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getAssetRegistry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const REGISTRY_ABI = [
  {
    name: "getAssetInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{
      name: "info",
      type: "tuple",
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
      name: "data",
      type: "tuple",
      components: [
        { name: "countryCode",   type: "uint16" },
        { name: "isAccredited",  type: "bool"   },
        { name: "isKYCVerified", type: "bool"   },
        { name: "kycExpiry",     type: "uint40" },
        { name: "registeredAt",  type: "uint40" },
      ],
    }],
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
// ASSET STATUS MAPS
// ---------------------------------------------------------------------------
const ASSET_STATUS: Record<number, { label: string; color: string; bg: string; border: string }> = {
  0: { label: "Unregistered", color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb" },
  1: { label: "Active",       color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  2: { label: "Paused",       color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  3: { label: "Frozen",       color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  4: { label: "Redeemed",     color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe" },
};

const COUNTRY_CODES: Record<number, string> = {
  840: "US", 826: "GB", 276: "DE", 392: "JP",
  344: "HK", 702: "SG", 356: "IN", 124: "CA", 36: "AU",
};

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function fmtAddr(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function fmtAddrLong(a: string) { return `${a.slice(0, 10)}…${a.slice(-6)}`; }

function fmtDate(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function isValidAddr(s: string) { return /^0x[0-9a-fA-F]{40}$/.test(s); }

// ---------------------------------------------------------------------------
// NAV
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
            className={`nav-link${l === "Compliance" ? " active" : ""}`}>
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
// SKELETON / SPINNER
// ---------------------------------------------------------------------------
function Skel({ w = 80, h = 14 }: { w?: number; h?: number }) {
  return <span className="skel" style={{ width: w, height: h }} />;
}

// ---------------------------------------------------------------------------
// STATUS STRIP
// ---------------------------------------------------------------------------
function StatsStrip() {
  const calls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "getComplianceOfficer" as const, args: [] },
    { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "getAssetRegistry" as const, args: [] },
  ], []);

  const { data } = useReadContracts({ contracts: calls });
  const officer  = data?.[0]?.result as string | undefined;
  const registry = data?.[1]?.result as string | undefined;

  return (
    <div className="stats-strip">
      {[
       
      ].map(({ label, val }, i, arr) => (
        <div key={label} className="ss-group">
          <div className="ss-item">
            <span className="ss-label">{label}</span>
            <span className="ss-val">{val}</span>
          </div>
          {i < arr.length - 1 && <div className="ss-div" aria-hidden />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MY COMPLIANCE CARD — connected wallet status
// ---------------------------------------------------------------------------
function MyComplianceCard({ address }: { address: `0x${string}` }) {
  // Per-asset whitelist + asset status for connected user
  const assetCalls = useMemo(() =>
    KNOWN_ASSETS.flatMap((a) => [
      { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "isBlocked" as const, args: [address] },
      { address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "isWhitelisted" as const, args: [a.id, address] },
      { address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "getAssetInfo" as const, args: [a.id] },
    ])
  , [address]);

  const kycCall = useMemo(() => [
    { address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "getInvestorData" as const, args: [address] },
    { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "isBlocked" as const, args: [address] },
  ], [address]);

  const { data: assetData, isLoading: assetLoading } = useReadContracts({ contracts: assetCalls });
  const { data: kycData,   isLoading: kycLoading   } = useReadContracts({ contracts: kycCall });

  const isBlocked   = assetData?.[0]?.result as boolean | undefined;
  const investorKyc = kycData?.[0]?.result as InvestorData | undefined;
  const blockedCheck= kycData?.[1]?.result as boolean | undefined;

  const kycOk = investorKyc?.isKYCVerified && investorKyc.kycExpiry * 1000 > Date.now();
  const kycWarning = kycOk && (investorKyc!.kycExpiry * 1000 - Date.now()) < 30 * 86400000;

  // Parse per-asset data: every 3 results = [isBlocked, isWhitelisted, assetInfo]
  const assetRows = KNOWN_ASSETS.map((a, i) => {
    const base = i * 3;
    const wl   = assetData?.[base + 1]?.result as boolean | undefined;
    const info = assetData?.[base + 2]?.result as AssetInfo | undefined;
    return { meta: a, whitelisted: wl, info };
  });

  const loading = assetLoading || kycLoading;

  return (
    <div className={`comp-card${blockedCheck ? " comp-card-blocked" : ""}`}>
      {/* Head */}
      <div className="comp-card-head">
        <div className="comp-avatar">
          <IconShield />
        </div>
        <div className="comp-addr-group">
          <span className="comp-addr">{fmtAddrLong(address)}</span>
          <span className="comp-net">Compliance status · Base Mainnet</span>
        </div>
        <div className="comp-head-pills">
          {loading ? <Skel w={100} h={22} /> : (
            <>
              <span className={`status-pill${blockedCheck ? " err" : " ok"}`}>
                {blockedCheck ? "Globally blocked" : "Not blocked"}
              </span>
              <span className={`status-pill${kycOk ? (kycWarning ? " warn" : " ok") : " no"}`}>
                {kycOk ? (kycWarning ? "KYC expiring" : "KYC valid") : "KYC inactive"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Blocked banner */}
      {blockedCheck && (
        <div className="alert-err" role="alert">
          <IconBlock />
          This address has been globally blocked by the compliance officer. All transfers across every asset are suspended until the block is lifted.
        </div>
      )}

      {/* KYC expiry warning */}
      {kycWarning && !blockedCheck && (
        <div className="alert-warn" role="alert">
          <IconWarn />
          KYC expires {fmtDate(investorKyc!.kycExpiry)}. Renew before expiry to avoid automatic transfer blocking.
        </div>
      )}

      {/* KYC meta row */}
      {investorKyc && (
        <div className="kyc-meta-row">
          {[
            { label: "Country",       val: COUNTRY_CODES[investorKyc.countryCode] ?? `CC-${investorKyc.countryCode}` },
            { label: "Accreditation", val: investorKyc.isAccredited ? "Accredited" : "Standard" },
            { label: "KYC status",    val: kycOk ? "Valid" : "Expired / inactive",                 ok: kycOk, err: !kycOk },
            { label: "KYC expiry",    val: fmtDate(investorKyc.kycExpiry),                          warn: kycWarning },
          ].map(({ label, val, ok, err, warn }) => (
            <div key={label} className="kyc-meta-cell">
              <span className="kyc-meta-label">{label}</span>
              <span className={`kyc-meta-val${ok ? " ok" : ""}${err ? " err" : ""}${warn ? " warn" : ""}`}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-asset whitelist table */}
      <div className="asset-access-table">
        <div className="aat-head">
          <span>Asset</span>
          <span>Status</span>
          <span>Whitelisted</span>
          <span>Jurisdictions</span>
          <span>Min. accreditation</span>
        </div>
        {assetRows.map(({ meta, whitelisted, info }) => {
          const st = ASSET_STATUS[info?.status ?? 0] ?? ASSET_STATUS[0];
          return (
            <div key={meta.id} className={`aat-row${info?.status === 3 ? " aat-row-frozen" : ""}`}>
              <div className="aat-asset">
                <span className="aat-ticker">{meta.ticker}</span>
                <span className="aat-label">{meta.label}</span>
              </div>
              <div>
                {loading ? <Skel w={56} /> : (
                  <span className="aat-status-badge"
                    style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>
                    <i className="aat-dot" style={{ background: st.color }} aria-hidden />
                    {st.label}
                  </span>
                )}
              </div>
              <div>
                {loading ? <Skel w={56} /> : (
                  <span className={`wl-badge${whitelisted ? " ok" : " no"}`}>
                    {whitelisted ? "Yes" : "No"}
                  </span>
                )}
              </div>
              <div className="aat-text">
                {loading ? <Skel w={64} /> : (info?.allowAllJurisdictions ? "Global" : "Restricted")}
              </div>
              <div className="aat-text">
                {loading ? <Skel w={40} /> : (
                  info?.minAccreditationLevel === 0 ? "None" : `Level ${info?.minAccreditationLevel}+`
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TRANSFER SIMULATOR
// ---------------------------------------------------------------------------
type SimResult = { ok: boolean; reason: string } | null;

function TransferSimulator() {
  const [from,      setFrom]      = useState("");
  const [to,        setTo]        = useState("");
  const [assetIdx,  setAssetIdx]  = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [result,    setResult]    = useState<SimResult>(null);

  const asset    = KNOWN_ASSETS[assetIdx]!;
  const fromOk   = isValidAddr(from);
  const toOk     = isValidAddr(to);
  const canSim   = fromOk && toOk && from.toLowerCase() !== to.toLowerCase();

  // Multi-call: canTransfer + both wallets' data
  const simCalls = useMemo(() => {
    if (!triggered || !canSim) return [];
    return [
      {
        address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`,
        abi: COMPLIANCE_ABI,
        functionName: "canTransfer" as const,
        args: [asset.id, from as `0x${string}`, to as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`,
        abi: COMPLIANCE_ABI,
        functionName: "isBlocked" as const,
        args: [from as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`,
        abi: COMPLIANCE_ABI,
        functionName: "isBlocked" as const,
        args: [to as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "isWhitelisted" as const,
        args: [asset.id, from as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "isWhitelisted" as const,
        args: [asset.id, to as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "getInvestorData" as const,
        args: [from as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "getInvestorData" as const,
        args: [to as `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "getAssetInfo" as const,
        args: [asset.id],
      },
    ];
  }, [triggered, canSim, from, to, asset.id]);

  const { data: simData, isLoading: simLoading } = useReadContracts({
    contracts: simCalls,
    query: { enabled: triggered && canSim },
  });

  useEffect(() => {
    if (!simData || simLoading) return;

    const canTx      = simData[0]?.result as boolean | undefined;
    const fromBlocked= simData[1]?.result as boolean | undefined;
    const toBlocked  = simData[2]?.result as boolean | undefined;
    const fromWL     = simData[3]?.result as boolean | undefined;
    const toWL       = simData[4]?.result as boolean | undefined;
    const fromKyc    = simData[5]?.result as InvestorData | undefined;
    const toKyc      = simData[6]?.result as InvestorData | undefined;
    const assetInfo  = simData[7]?.result as AssetInfo | undefined;

    if (canTx) {
      setResult({ ok: true, reason: "All compliance checks pass. Transfer is permitted." });
      return;
    }

    // Diagnose failure reason
    if (fromBlocked)   { setResult({ ok: false, reason: `Sender (${fmtAddr(from)}) is globally blocked.` }); return; }
    if (toBlocked)     { setResult({ ok: false, reason: `Receiver (${fmtAddr(to)}) is globally blocked.` }); return; }
    if (assetInfo?.status === 3) { setResult({ ok: false, reason: `${asset.label} is currently frozen.` }); return; }
    if (assetInfo?.status !== 1) { setResult({ ok: false, reason: `${asset.label} is not active (status: ${ASSET_STATUS[assetInfo?.status ?? 0]?.label}).` }); return; }
    if (!fromWL)       { setResult({ ok: false, reason: `Sender (${fmtAddr(from)}) is not whitelisted for ${asset.ticker}.` }); return; }
    if (!toWL)         { setResult({ ok: false, reason: `Receiver (${fmtAddr(to)}) is not whitelisted for ${asset.ticker}.` }); return; }
    const now = Math.floor(Date.now() / 1000);
    if (fromKyc && (!fromKyc.isKYCVerified || fromKyc.kycExpiry < now)) {
      setResult({ ok: false, reason: `Sender KYC has expired or is not verified.` }); return;
    }
    if (toKyc && (!toKyc.isKYCVerified || toKyc.kycExpiry < now)) {
      setResult({ ok: false, reason: `Receiver KYC has expired or is not verified.` }); return;
    }
    if (assetInfo?.minAccreditationLevel && toKyc && !toKyc.isAccredited) {
      setResult({ ok: false, reason: `${asset.ticker} requires accredited investors. Receiver is not accredited.` }); return;
    }
    setResult({ ok: false, reason: "Transfer blocked. Jurisdiction restriction or compliance rule not met." });
  }, [simData, simLoading]);

  const handleSim = useCallback(() => {
    setResult(null);
    setTriggered(true);
  }, []);

  const reset = () => { setTriggered(false); setResult(null); };

  return (
    <div className="sim-panel">
      <div className="sim-header">
        <div>
          <p className="sim-title">Transfer simulator</p>
          <p className="sim-sub">Dry-run a transfer against the live compliance engine — no transaction sent, no gas spent.</p>
        </div>
        <div className="sim-badge">Read-only</div>
      </div>

      <div className="sim-form">
        {/* Asset selector */}
        <div className="sim-field">
          <label className="sim-label" htmlFor="sim-asset">Asset</label>
          <div className="sim-asset-tabs" role="group" aria-label="Select asset">
            {KNOWN_ASSETS.map((a, i) => (
              <button
                key={a.id}
                className={`sim-asset-tab${assetIdx === i ? " active" : ""}`}
                onClick={() => { setAssetIdx(i); reset(); }}
              >
                {a.ticker}
              </button>
            ))}
          </div>
        </div>

        {/* From / To */}
        <div className="sim-row">
          <div className="sim-field">
            <label className="sim-label" htmlFor="sim-from">From</label>
            <input
              id="sim-from"
              className={`sim-input${from.length > 2 && !fromOk ? " sim-input-err" : ""}`}
              placeholder="0x... sender address"
              value={from}
              onChange={(e) => { setFrom(e.target.value); reset(); }}
              spellCheck={false}
              aria-describedby="sim-from-err"
            />
            {from.length > 2 && !fromOk && (
              <span id="sim-from-err" className="sim-field-err">Invalid address</span>
            )}
          </div>
          <div className="sim-arrow" aria-hidden>
            <IconArrow />
          </div>
          <div className="sim-field">
            <label className="sim-label" htmlFor="sim-to">To</label>
            <input
              id="sim-to"
              className={`sim-input${to.length > 2 && !toOk ? " sim-input-err" : ""}`}
              placeholder="0x... receiver address"
              value={to}
              onChange={(e) => { setTo(e.target.value); reset(); }}
              spellCheck={false}
              aria-describedby="sim-to-err"
            />
            {to.length > 2 && !toOk && (
              <span id="sim-to-err" className="sim-field-err">Invalid address</span>
            )}
          </div>
        </div>

        {/* Same address warning */}
        {fromOk && toOk && from.toLowerCase() === to.toLowerCase() && (
          <p className="sim-same-warn">Sender and receiver cannot be the same address.</p>
        )}

        {/* Simulate button */}
        <button
          className="sim-btn"
          onClick={handleSim}
          disabled={!canSim || simLoading}
        >
          {simLoading ? <><div className="spin" />Checking chain…</> : <><IconSim />Run simulation</>}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`sim-result${result.ok ? " sim-result-ok" : " sim-result-err"}`} role="status">
          <div className="sim-result-icon">
            {result.ok ? <IconCheck /> : <IconX />}
          </div>
          <div className="sim-result-body">
            <span className="sim-result-verdict">{result.ok ? "Transfer permitted" : "Transfer blocked"}</span>
            <span className="sim-result-reason">{result.reason}</span>
          </div>
          <div className="sim-result-asset">
            <span className="sim-result-asset-label">Asset</span>
            <span className="sim-result-asset-val">{KNOWN_ASSETS[assetIdx]?.ticker}</span>
          </div>
        </div>
      )}

      {/* Checks legend */}
      <div className="sim-legend">
        <p className="sim-legend-title">Checks run in order</p>
        <div className="sim-legend-list">
          {[
            { n: "1", label: "Self-transfer guard",     desc: "Sender ≠ receiver" },
            { n: "2", label: "Global block check",      desc: "Neither party is on the blacklist" },
            { n: "3", label: "Asset status",            desc: "Asset must be Active" },
            { n: "4", label: "Whitelist",               desc: "Both wallets whitelisted for this asset" },
            { n: "5", label: "KYC validity",            desc: "Both KYC records active and unexpired" },
            { n: "6", label: "Jurisdiction",            desc: "Country codes permitted for this asset" },
            { n: "7", label: "Accreditation",           desc: "Receiver meets minimum tier" },
          ].map(({ n, label, desc }) => (
            <div key={n} className="sim-legend-item">
              <span className="sim-legend-n">{n}</span>
              <div className="sim-legend-text">
                <span className="sim-legend-label">{label}</span>
                <span className="sim-legend-desc">{desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ASSET FREEZE STATUS PANEL
// ---------------------------------------------------------------------------
function AssetFreezePanel() {
  const calls = useMemo(() =>
    KNOWN_ASSETS.map((a) => ({
      address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: "getAssetInfo" as const,
      args: [a.id],
    }))
  , []);

  const { data, isLoading } = useReadContracts({ contracts: calls });

  return (
    <div className="freeze-panel">
      {KNOWN_ASSETS.map((meta, i) => {
        const info = data?.[i]?.result as AssetInfo | undefined;
        const st   = ASSET_STATUS[info?.status ?? 0] ?? ASSET_STATUS[0];
        const frozen = info?.status === 3;

        return (
          <div key={meta.id} className={`freeze-row${frozen ? " freeze-row-frozen" : ""}`}>
            <div className="freeze-asset">
              <span className="freeze-ticker">{meta.ticker}</span>
              <span className="freeze-label">{meta.label}</span>
            </div>
            <div className="freeze-status">
              {isLoading ? <Skel w={72} /> : (
                <span className="freeze-badge"
                  style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>
                  <i className="freeze-dot" style={{ background: st.color }} aria-hidden />
                  {st.label}
                </span>
              )}
            </div>
            <div className="freeze-token">
              {isLoading ? <Skel w={100} /> : info?.token ? (
                <a href={`https://basescan.org/address/${info.token}`}
                  target="_blank" rel="noopener noreferrer"
                  className="mono-link">
                  {fmtAddrLong(info.token)}<IconExternal />
                </a>
              ) : "—"}
            </div>
            <div className="freeze-action">
              {frozen && (
                <span className="freeze-frozen-tag">
                  <IconLock />Transfers suspended
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ADDRESS BLOCK CHECK
// ---------------------------------------------------------------------------
function BlockChecker() {
  const [query,     setQuery]     = useState("");
  const [searched,  setSearched]  = useState<`0x${string}` | null>(null);
  const valid = isValidAddr(query);

  const calls = useMemo(() => {
    if (!searched) return [];
    return [
      { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "isBlocked" as const, args: [searched] },
      { address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "getInvestorData" as const, args: [searched] },
      ...KNOWN_ASSETS.map((a) => ({
        address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "isWhitelisted" as const,
        args: [a.id, searched] as readonly [`0x${string}`, `0x${string}`],
      })),
    ];
  }, [searched]);

  const { data, isLoading } = useReadContracts({ contracts: calls, query: { enabled: !!searched } });

  const blocked    = data?.[0]?.result as boolean | undefined;
  const investorDt = data?.[1]?.result as InvestorData | undefined;
  const wlResults  = KNOWN_ASSETS.map((_, i) => data?.[2 + i]?.result as boolean | undefined);

  const kycOk = investorDt?.isKYCVerified && investorDt.kycExpiry * 1000 > Date.now();

  return (
    <div className="block-checker">
      <p className="bc-title">Block status lookup</p>
      <p className="bc-sub">Check whether any address is globally blocked by the compliance officer.</p>

      <div className="bc-row">
        <input
          className={`sim-input${query.length > 2 && !valid ? " sim-input-err" : ""}`}
          placeholder="0x... address to check"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearched(null); }}
          onKeyDown={(e) => e.key === "Enter" && valid && setSearched(query as `0x${string}`)}
          spellCheck={false}
          aria-label="Address to check for block status"
        />
        <button
          className="sim-btn-sm"
          onClick={() => valid && setSearched(query as `0x${string}`)}
          disabled={!valid}
        >
          {isLoading ? <div className="spin" /> : <IconSearch />}
          Check
        </button>
      </div>
      {query.length > 2 && !valid && <p className="sim-field-err">Enter a valid 0x address</p>}

      {searched && !isLoading && (
        <div className="bc-result">
          <div className="bc-result-head">
            <span className="bc-result-addr">{fmtAddrLong(searched)}</span>
            <div className="bc-pills">
              <span className={`status-pill${blocked ? " err" : " ok"}`}>
                {blocked ? "Blocked" : "Not blocked"}
              </span>
              {investorDt && (
                <span className={`status-pill${kycOk ? " ok" : " no"}`}>
                  {kycOk ? "KYC valid" : "KYC inactive"}
                </span>
              )}
            </div>
          </div>

          {investorDt && (
            <div className="bc-kyc-row">
              {[
                { label: "Country",    val: COUNTRY_CODES[investorDt.countryCode] ?? `CC-${investorDt.countryCode}` },
                { label: "Accredited", val: investorDt.isAccredited ? "Yes" : "No" },
                { label: "KYC expiry", val: fmtDate(investorDt.kycExpiry) },
                { label: "Registered", val: fmtDate(investorDt.registeredAt) },
              ].map(({ label, val }) => (
                <div key={label} className="bc-cell">
                  <span className="bc-cell-label">{label}</span>
                  <span className="bc-cell-val">{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Per-asset whitelist */}
          <div className="bc-wl-grid">
            {KNOWN_ASSETS.map((a, i) => (
              <div key={a.id} className="bc-wl-item">
                <span className="bc-wl-ticker">{a.ticker}</span>
                <span className={`wl-badge${wlResults[i] ? " ok" : " no"}`}>
                  {wlResults[i] === undefined ? "—" : wlResults[i] ? "Whitelisted" : "Not listed"}
                </span>
              </div>
            ))}
          </div>

          {blocked && (
            <div className="alert-err" role="alert">
              <IconBlock />
              Address is globally blocked. All asset transfers are suspended until the compliance officer lifts the block.
            </div>
          )}
        </div>
      )}

      {searched && isLoading && (
        <div className="bc-loading">
          <div className="spin" /><span>Reading from chain…</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPLIANCE RULES REFERENCE
// ---------------------------------------------------------------------------
function RulesReference() {
  const rules = [
    {
      title: "Global blocklist",
      icon: <IconBlock />,
      color: "#dc2626",
      bg: "#fef2f2",
      border: "#fecaca",
      desc: "The compliance officer can blacklist any address globally. A blocked address cannot send or receive any RWA token across the entire protocol, regardless of asset-level whitelist status.",
    },
    {
      title: "Asset freeze",
      icon: <IconLock />,
      color: "#d97706",
      bg: "#fffbeb",
      border: "#fde68a",
      desc: "Any registered asset can be frozen by the compliance engine. While frozen, no minting, burning, or transfers are permitted. The freeze is lifted by the same compliance officer.",
    },
    {
      title: "KYC expiry",
      icon: <IconClock />,
      color: "#6366f1",
      bg: "#eef2ff",
      border: "#c7d2fe",
      desc: "Investor KYC records carry a 365-day expiry window. Once expired, the investor's transfers revert with KYCExpired regardless of whitelist status. Renewal requires the protocol registrar.",
    },
    {
      title: "Jurisdiction",
      icon: <IconGlobe />,
      color: "#0ea5e9",
      bg: "#f0f9ff",
      border: "#bae6fd",
      desc: "Each asset carries an issuer jurisdiction and an allowAllJurisdictions flag. When restricted, both sender and receiver must pass a jurisdiction pair check against OFAC-sanctioned country codes.",
    },
    {
      title: "Forced transfer",
      icon: <IconForce />,
      color: "#8b5cf6",
      bg: "#f5f3ff",
      border: "#ddd6fe",
      desc: "The compliance officer can execute court-ordered token seizures via executeForcedTransfer. This bypasses all whitelist checks and moves tokens directly — used for sanctions enforcement or wallet recovery.",
    },
    {
      title: "Self-transfer guard",
      icon: <IconSelf />,
      color: "#f97316",
      bg: "#fff7ed",
      border: "#fed7aa",
      desc: "Sending tokens to your own address is reverted at the contract level. This prevents gas waste and closes a class of edge-case accounting bugs.",
    },
  ];

  return (
    <div className="rules-grid">
      {rules.map((r) => (
        <div key={r.title} className="rule-card">
          <div className="rule-icon" style={{ color: r.color, background: r.bg, border: `1px solid ${r.border}` }}>
            {r.icon}
          </div>
          <h3 className="rule-title">{r.title}</h3>
          <p className="rule-desc">{r.desc}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONTRACT TABLE
// ---------------------------------------------------------------------------
function ContractRow({ name, addr }: { name: string; addr: string }) {
  return (
    <div className="ctr-row">
      <span className="ctr-name">{name}</span>
      <a href={`https://basescan.org/address/${addr}`}
        target="_blank" rel="noopener noreferrer" className="ctr-addr">
        {addr}<IconExternal />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
function IconShield() {
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M11 2L4 5v6c0 5 3.2 8 7 9 3.8-1 7-4 7-9V5l-7-3Z"/></svg>;
}
function IconExternal() {
  return <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IconBlock() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><circle cx="7" cy="7" r="6"/><path d="M3 3l8 8"/></svg>;
}
function IconWarn() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 1L13 11H1L7 1Z"/><path d="M7 5v3M7 10v.5"/></svg>;
}
function IconSearch() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><circle cx="6" cy="6" r="4.5"/><path d="M10 10l2.5 2.5"/></svg>;
}
function IconArrow() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 8h10M9 4l4 4-4 4"/></svg>;
}
function IconSim() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 1v12M1 7h12"/><circle cx="7" cy="7" r="6"/></svg>;
}
function IconCheck() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="9" r="8"/><path d="M5.5 9l2.5 2.5L12.5 6"/></svg>;
}
function IconX() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="9" r="8"/><path d="M6 6l6 6M12 6l-6 6"/></svg>;
}
function IconLock() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="5.5" width="9" height="6.5" rx="1.5"/><path d="M4.5 5.5V4a2 2 0 014 0v1.5"/></svg>;
}
function IconClock() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6.5" cy="6.5" r="5.5"/><path d="M6.5 3.5v3l2 1.5"/></svg>;
}
function IconGlobe() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6.5" cy="6.5" r="5.5"/><path d="M1 6.5h11M4 6.5C4 3.5 5 1 6.5 1S9 3.5 9 6.5 8 12 6.5 12 4 9.5 4 6.5z"/></svg>;
}
function IconForce() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6.5 1v11M1 6h5M7 4l4 2.5L7 9"/></svg>;
}
function IconSelf() {
  return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="6.5" cy="6.5" r="5.5"/><path d="M4 6.5h5M6.5 4l2.5 2.5L6.5 9"/></svg>;
}

// ---------------------------------------------------------------------------
// ROOT
// ---------------------------------------------------------------------------
export default function CompliancePage() {
  const { address } = useAccount();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{CSS}</style>
      <Nav address={address} />

      <main className={`main${entered ? " in" : ""}`}>
        {/* Page header */}
        <div className="page-header">
          <div className="page-header-inner">
            <p className="page-tag">On-chain enforcement</p>
            <h1 className="page-h1">Compliance Engine</h1>
           
          </div>
          <StatsStrip />
        </div>

        <div className="page-body">
          {/* Connected wallet status */}
          {address ? (
            <section className="section">
              <div className="section-head">
                <h2 className="section-label">Your compliance status</h2>
              </div>
              <MyComplianceCard address={address as `0x${string}`} />
            </section>
          ) : (
            <div className="connect-nudge">
              <div className="cn-icon"><IconShield /></div>
              <div>
                <p className="cn-title">Connect to see your standing</p>
                <p className="cn-body">Link your wallet to view your global block status, per-asset whitelist access, and KYC validity.</p>
              </div>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className="btn-dark-sm" onClick={openConnectModal}>Connect wallet</button>
                )}
              </ConnectButton.Custom>
            </div>
          )}

          {/* Asset freeze status */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Asset freeze status</h2>
            </div>
            <AssetFreezePanel />
          </section>

          {/* Transfer simulator */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Transfer simulator</h2>
            </div>
            <TransferSimulator />
          </section>

          {/* Block checker */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Block status lookup</h2>
            </div>
            <BlockChecker />
          </section>

          {/* Rules reference */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Enforcement rules</h2>
            </div>
            <RulesReference />
          </section>

          {/* Contracts */}
          <section className="section">
            <h2 className="section-label">Contract addresses</h2>
            <div className="contract-table">
              <ContractRow name="Compliance Engine" addr={CONTRACT_ADDRESSES.COMPLIANCE_ENGINE} />
              <ContractRow name="Asset Registry"    addr={CONTRACT_ADDRESSES.ASSET_REGISTRY} />
              <ContractRow name="Identity Registry" addr={CONTRACT_ADDRESSES.IDENTITY_REGISTRY} />
            </div>
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
[data-rk] button{font-family:'Inter',sans-serif!important;font-weight:600!important;font-size:13px!important;border-radius:8px!important}

/* MAIN */
.main{padding-top:56px;min-height:100vh;opacity:0;transform:translateY(14px);transition:opacity .55s cubic-bezier(.16,1,.3,1),transform .55s cubic-bezier(.16,1,.3,1)}
.main.in{opacity:1;transform:none}

/* PAGE HEADER */
.page-header{background:rgba(255,255,255,0.55);border-bottom:1px solid rgba(0,0,0,0.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.page-header-inner{max-width:1100px;margin:0 auto;padding:40px 28px 24px}
.page-tag{font-family:'Syne',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f97316;margin-bottom:8px}
.page-h1{font-family:'Syne',sans-serif;font-size:clamp(1.8rem,4vw,2.8rem);font-weight:800;line-height:1.08;letter-spacing:-0.03em;color:#18160f;margin-bottom:10px}
.page-sub{font-size:14.5px;line-height:1.72;color:#7c7363;max-width:540px}

/* STATS STRIP */
.stats-strip{max-width:1100px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;scrollbar-width:none;gap:0}
.stats-strip::-webkit-scrollbar{display:none}
.ss-group{display:flex;align-items:center;flex-shrink:0}
.ss-item{display:flex;flex-direction:column;gap:2px;padding:0 18px}
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

/* STATUS PILLS */
.status-pill{font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;border:1px solid;letter-spacing:.04em}
.status-pill.ok{background:#f0fdf4;color:#16a34a;border-color:#bbf7d0}
.status-pill.no{background:#f9fafb;color:#6b7280;border-color:#e5e7eb}
.status-pill.warn{background:#fffbeb;color:#d97706;border-color:#fde68a}
.status-pill.err{background:#fef2f2;color:#dc2626;border-color:#fecaca}

/* WHITELIST BADGE */
.wl-badge{font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;border:1px solid;letter-spacing:.04em}
.wl-badge.ok{background:#f0fdf4;color:#16a34a;border-color:#bbf7d0}
.wl-badge.no{background:#fef2f2;color:#dc2626;border-color:#fecaca}

/* ALERTS */
.alert-warn{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;font-size:13px;color:#92400e;font-weight:500;line-height:1.5}
.alert-err{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;font-size:13px;color:#991b1b;font-weight:500;line-height:1.5}
.alert-warn svg,.alert-err svg{flex-shrink:0;margin-top:1px}

/* MY COMPLIANCE CARD */
.comp-card{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:18px}
.comp-card-blocked{border-color:rgba(248,113,113,0.3);background:rgba(255,240,240,0.6)}
.comp-card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.comp-avatar{width:44px;height:44px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;display:grid;place-items:center;color:#f97316;flex-shrink:0}
.comp-addr-group{flex:1;min-width:0}
.comp-addr{display:block;font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.comp-net{display:block;font-size:12px;color:#a09890;margin-top:2px}
.comp-head-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}

/* KYC meta row */
.kyc-meta-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.kyc-meta-cell{background:#faf9f6;padding:11px 14px;display:flex;flex-direction:column;gap:4px}
.kyc-meta-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.kyc-meta-val{font-size:13px;font-weight:600;color:#18160f}
.kyc-meta-val.ok{color:#16a34a}
.kyc-meta-val.err{color:#dc2626}
.kyc-meta-val.warn{color:#d97706}

/* Asset access table */
.asset-access-table{border:1px solid rgba(0,0,0,0.06);border-radius:12px;overflow:hidden}
.aat-head{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr 1.2fr;gap:0;padding:9px 16px;background:#faf9f6;border-bottom:1px solid rgba(0,0,0,0.06);font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.aat-row{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr 1.2fr;gap:0;padding:13px 16px;border-bottom:1px solid rgba(0,0,0,0.04);align-items:center;transition:background .13s}
.aat-row:last-child{border-bottom:none}
.aat-row:hover{background:rgba(0,0,0,0.015)}
.aat-row-frozen{background:rgba(254,242,242,0.4)}
.aat-asset{display:flex;flex-direction:column;gap:2px}
.aat-ticker{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#18160f}
.aat-label{font-size:11.5px;color:#7c7363}
.aat-status-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px}
.aat-dot{display:inline-block;width:5px;height:5px;border-radius:50%;flex-shrink:0;animation:pulse 2.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.aat-text{font-size:13px;color:#5a5245;font-weight:500}

/* FREEZE PANEL */
.freeze-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);overflow:hidden}
.freeze-row{display:grid;grid-template-columns:2fr 1fr 2fr auto;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(0,0,0,0.05);gap:16px;transition:background .13s}
.freeze-row:last-child{border-bottom:none}
.freeze-row:hover{background:rgba(0,0,0,0.015)}
.freeze-row-frozen{background:rgba(254,242,242,0.4)}
.freeze-asset{display:flex;flex-direction:column;gap:3px}
.freeze-ticker{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.freeze-label{font-size:12px;color:#7c7363}
.freeze-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px}
.freeze-dot{display:inline-block;width:5px;height:5px;border-radius:50%;flex-shrink:0;animation:pulse 2.2s ease-in-out infinite}
.freeze-token{min-width:0}
.freeze-action{flex-shrink:0}
.freeze-frozen-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;padding:3px 9px;border-radius:6px}

/* TRANSFER SIMULATOR */
.sim-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:20px}
.sim-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sim-title{font-family:'Syne',sans-serif;font-size:14.5px;font-weight:700;color:#18160f;margin-bottom:4px}
.sim-sub{font-size:13.5px;color:#7c7363;line-height:1.6}
.sim-badge{padding:4px 10px;border-radius:6px;background:#f3f0e8;border:1px solid #e5e1d8;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7c7363;white-space:nowrap;align-self:flex-start;margin-top:2px}

/* Form */
.sim-form{display:flex;flex-direction:column;gap:14px}
.sim-field{display:flex;flex-direction:column;gap:6px;flex:1}
.sim-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.sim-asset-tabs{display:flex;gap:6px;flex-wrap:wrap}
.sim-asset-tab{padding:6px 14px;border-radius:8px;font-size:12.5px;font-weight:600;font-family:'Syne',sans-serif;border:1px solid rgba(0,0,0,0.12);background:rgba(255,255,255,0.7);color:#5a5245;cursor:pointer;transition:all .14s}
.sim-asset-tab:hover{background:rgba(255,255,255,0.95);color:#18160f}
.sim-asset-tab.active{background:#18160f;color:#fff;border-color:#18160f}
.sim-row{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:end}
.sim-arrow{padding-bottom:10px;color:#a09890}
.sim-input{width:100%;padding:10px 14px;border-radius:9px;border:1px solid rgba(0,0,0,0.12);background:rgba(255,255,255,0.85);font-size:13px;font-family:'Inter',monospace;color:#18160f;outline:none;transition:border-color .14s,box-shadow .14s}
.sim-input:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,0.1)}
.sim-input-err{border-color:#f87171}
.sim-input-err:focus{border-color:#f87171;box-shadow:0 0 0 3px rgba(248,113,113,0.1)}
.sim-field-err{font-size:11.5px;color:#dc2626;margin-top:-2px}
.sim-same-warn{font-size:12.5px;color:#d97706;font-weight:500}
.sim-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 22px;border-radius:10px;background:#18160f;color:#fff;font-size:13.5px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;transition:background .14s,transform .14s,opacity .14s;align-self:flex-start}
.sim-btn:hover:not(:disabled){background:#2e2a1e;transform:translateY(-1px)}
.sim-btn:disabled{background:#e5e1d8;color:#a09890;cursor:not-allowed}

/* Result */
.sim-result{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:16px 18px;border-radius:12px;border:1px solid}
.sim-result-ok{background:#f0fdf4;border-color:#bbf7d0}
.sim-result-err{background:#fef2f2;border-color:#fecaca}
.sim-result-icon{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}
.sim-result-ok .sim-result-icon{background:#dcfce7;color:#16a34a}
.sim-result-err .sim-result-icon{background:#fee2e2;color:#dc2626}
.sim-result-body{display:flex;flex-direction:column;gap:3px}
.sim-result-verdict{font-family:'Syne',sans-serif;font-size:14px;font-weight:700}
.sim-result-ok .sim-result-verdict{color:#15803d}
.sim-result-err .sim-result-verdict{color:#991b1b}
.sim-result-reason{font-size:13px;line-height:1.5}
.sim-result-ok .sim-result-reason{color:#166534}
.sim-result-err .sim-result-reason{color:#7f1d1d}
.sim-result-asset{display:flex;flex-direction:column;gap:3px;align-items:flex-end;flex-shrink:0}
.sim-result-asset-label{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.sim-result-asset-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#18160f}

/* Legend */
.sim-legend{border:1px solid rgba(0,0,0,0.06);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;background:rgba(0,0,0,0.015)}
.sim-legend-title{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a09890}
.sim-legend-list{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.sim-legend-item{display:flex;align-items:flex-start;gap:10px}
.sim-legend-n{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;color:#f97316;flex-shrink:0;width:14px}
.sim-legend-text{display:flex;flex-direction:column;gap:1px}
.sim-legend-label{font-size:12.5px;font-weight:600;color:#18160f}
.sim-legend-desc{font-size:11.5px;color:#7c7363}

/* BLOCK CHECKER */
.block-checker{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:16px}
.bc-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.bc-sub{font-size:13.5px;color:#7c7363;line-height:1.6;margin-top:-8px}
.bc-row{display:flex;gap:9px}
.sim-btn-sm{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:9px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .14s,transform .14s;flex-shrink:0}
.sim-btn-sm:hover:not(:disabled){background:#2e2a1e}
.sim-btn-sm:disabled{background:#e5e1d8;color:#a09890;cursor:not-allowed}
.bc-result{border:1px solid rgba(0,0,0,0.06);border-radius:12px;overflow:hidden}
.bc-result-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:#faf9f6;border-bottom:1px solid rgba(0,0,0,0.05);flex-wrap:wrap;gap:8px}
.bc-result-addr{font-family:'Syne',sans-serif;font-size:13.5px;font-weight:700;color:#18160f;font-variant-numeric:tabular-nums}
.bc-pills{display:flex;gap:6px;flex-wrap:wrap}
.bc-kyc-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,0.06);border-bottom:1px solid rgba(0,0,0,0.05)}
.bc-cell{background:#fff;padding:11px 14px;display:flex;flex-direction:column;gap:4px}
.bc-cell-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.bc-cell-val{font-size:13px;font-weight:600;color:#18160f}
.bc-wl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(0,0,0,0.06)}
.bc-wl-item{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff}
.bc-wl-ticker{font-family:'Syne',sans-serif;font-size:12.5px;font-weight:700;color:#18160f}
.bc-loading{display:flex;align-items:center;gap:10px;padding:18px;font-size:13.5px;color:#7c7363}

/* RULES GRID */
.rules-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.rule-card{padding:20px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.03);display:flex;flex-direction:column;gap:10px;transition:transform .18s,box-shadow .18s}
.rule-card:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,0.05),0 12px 28px rgba(0,0,0,0.07)}
.rule-icon{width:36px;height:36px;border-radius:9px;display:grid;place-items:center;flex-shrink:0}
.rule-title{font-family:'Syne',sans-serif;font-size:13.5px;font-weight:700;color:#18160f}
.rule-desc{font-size:13px;line-height:1.68;color:#7c7363}

/* CONTRACT TABLE */
.contract-table{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:12px;backdrop-filter:blur(12px);overflow:hidden}
.ctr-row{display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-bottom:1px solid rgba(0,0,0,0.05);gap:16px}
.ctr-row:last-child{border-bottom:none}
.ctr-name{font-size:13px;font-weight:600;color:#18160f;flex-shrink:0}
.ctr-addr{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:flex;align-items:center;gap:5px;transition:opacity .13s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctr-addr:hover{opacity:.72}

/* CONNECT NUDGE */
.connect-nudge{display:flex;align-items:center;gap:18px;padding:22px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.cn-icon{color:#f97316;flex-shrink:0}
.cn-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;margin-bottom:4px}
.cn-body{font-size:13.5px;line-height:1.68;color:#7c7363}
.btn-dark-sm{margin-left:auto;padding:9px 18px;border-radius:8px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .15s,transform .15s;flex-shrink:0}
.btn-dark-sm:hover{background:#2e2a1e;transform:translateY(-1px)}

/* MONO LINK */
.mono-link{font-family:'Inter',monospace;font-size:12px;color:#f97316;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:opacity .13s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.mono-link:hover{opacity:.72}

/* SKELETON */
.skel{display:inline-block;height:14px;border-radius:4px;background:linear-gradient(90deg,#edeae4 25%,#e0dcd5 50%,#edeae4 75%);background-size:200% 100%;animation:skel 1.4s linear infinite;vertical-align:middle}
@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* SPINNER */
.spin{width:15px;height:15px;border:2px solid #e5e1d8;border-top-color:#f97316;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* RESPONSIVE */
@media(max-width:640px){
  .nav{grid-template-columns:1fr auto;gap:8px;padding:0 16px}
  .nav-links{display:none}
  .page-header-inner{padding:28px 16px 20px}
  .stats-strip{padding:12px 16px}
  .ss-item{padding:0 9px}
  .page-body{padding:24px 16px 64px;gap:28px}
  .kyc-meta-row{grid-template-columns:repeat(2,1fr)}
  .aat-head{display:none}
  .aat-row{grid-template-columns:1fr 1fr;grid-template-rows:auto auto;gap:8px;padding:14px 14px}
  .aat-row>:nth-child(3){order:2}
  .aat-row>:nth-child(4),.aat-row>:nth-child(5){display:none}
  .freeze-row{grid-template-columns:1fr auto;grid-template-rows:auto auto;gap:6px}
  .freeze-row>:nth-child(3){display:none}
  .sim-row{grid-template-columns:1fr;gap:12px}
  .sim-arrow{display:none}
  .sim-result{grid-template-columns:auto 1fr;grid-template-rows:auto auto}
  .sim-result-asset{display:none}
  .sim-legend-list{grid-template-columns:1fr}
  .rules-grid{grid-template-columns:1fr}
  .bc-kyc-row{grid-template-columns:repeat(2,1fr)}
  .bc-wl-grid{grid-template-columns:1fr}
  .connect-nudge{flex-direction:column;align-items:flex-start;gap:12px}
  .btn-dark-sm{margin-left:0}
  .ctr-row{flex-direction:column;align-items:flex-start;gap:4px}
  .comp-head-pills{width:100%;margin-left:0}
  .sim-btn{width:100%;justify-content:center}
}
@media(min-width:641px) and (max-width:900px){
  .nav-links{gap:0}
  .nav-link{padding:5px 9px;font-size:12.5px}
  .rules-grid{grid-template-columns:repeat(2,1fr)}
  .aat-head{grid-template-columns:1.4fr 0.9fr 0.9fr 0.9fr 1.1fr}
  .aat-row{grid-template-columns:1.4fr 0.9fr 0.9fr 0.9fr 1.1fr}
  .kyc-meta-row{grid-template-columns:repeat(2,1fr)}
  .bc-kyc-row{grid-template-columns:repeat(2,1fr)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;