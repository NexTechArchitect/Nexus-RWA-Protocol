"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContracts, useReadContract } from "wagmi";

import { CONTRACT_ADDRESSES } from "@/constants/contracts";

// ---------------------------------------------------------------------------
// ABI SLICES
// ---------------------------------------------------------------------------
const IDENTITY_ABI = [
  {
    name: "getIdentity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "wallet",       type: "address"  },
        { name: "tier",         type: "uint8"    },
        { name: "countryCode",  type: "uint16"   },
        { name: "isAccredited", type: "bool"     },
        { name: "kycExpiry",    type: "uint40"   },
        { name: "registeredAt", type: "uint40"   },
        { name: "isActive",     type: "bool"     },
        { name: "identityHash", type: "bytes32"  },
      ],
    }],
  },
  {
    name: "isIdentityCompliant",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "meetsTier",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "minTier", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getTier",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "getVerifier",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
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
] as const;

const REGISTRY_ABI = [
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
type IdentityRecord = {
  wallet:       `0x${string}`;
  tier:         number;
  countryCode:  number;
  isAccredited: boolean;
  kycExpiry:    number;
  registeredAt: number;
  isActive:     boolean;
  identityHash: `0x${string}`;
};

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const TIER_META: Record<number, { label: string; abbr: string; color: string; bg: string; border: string; desc: string }> = {
  0: { label: "None",        abbr: "NONE",   color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb", desc: "Unregistered address" },
  1: { label: "Basic KYC",   abbr: "BASIC",  color: "#6366f1", bg: "#eef2ff", border: "#c7d2fe", desc: "Name, email, ID verified" },
  2: { label: "KYC",         abbr: "KYC",    color: "#0ea5e9", bg: "#f0f9ff", border: "#bae6fd", desc: "Proof of address + biometrics" },
  3: { label: "Accredited",  abbr: "ACCRED", color: "#f97316", bg: "#fff7ed", border: "#fed7aa", desc: "High-net-worth individual" },
  4: { label: "Institutional",abbr: "INST",  color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe", desc: "Corporate or institutional entity" },
};

const COUNTRY_CODES: Record<number, string> = {
  840: "United States", 826: "United Kingdom", 276: "Germany",
  392: "Japan",         344: "Hong Kong",       702: "Singapore",
  356: "India",         124: "Canada",          36:  "Australia",
  756: "Switzerland",   528: "Netherlands",     250: "France",
  380: "Italy",         724: "Spain",           76:  "Brazil",
  410: "South Korea",   196: "Cyprus",          352: "Iceland",
};

const SANCTIONED = new Set([364, 408, 643, 760, 192, 862]);

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function fmtAddr(a: string) { return `${a.slice(0, 8)}…${a.slice(-6)}`; }

function fmtDate(ts: number, relative = false) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  if (relative) {
    const diff = ts * 1000 - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return "Expires today";
    if (days <= 30) return `Expires in ${days}d`;
  }
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function kycStatus(expiry: number) {
  if (!expiry) return { ok: false, warning: false, label: "No KYC" };
  const now = Date.now();
  const exp = expiry * 1000;
  if (now > exp) return { ok: false, warning: false, label: "KYC expired" };
  if (exp - now < 30 * 86400000) return { ok: true, warning: true, label: "Expiring soon" };
  return { ok: true, warning: false, label: "KYC active" };
}

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
            className={`nav-link${l === "Identity" ? " active" : ""}`}>
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
// SKELETON
// ---------------------------------------------------------------------------
function Skeleton({ w = 80, h = 14 }: { w?: number; h?: number }) {
  return <span className="skel" style={{ width: w, height: h }} />;
}

// ---------------------------------------------------------------------------
// TIER BADGE
// ---------------------------------------------------------------------------
function TierBadge({ tier, size = "sm" }: { tier: number; size?: "sm" | "lg" }) {
  const meta = TIER_META[tier] ?? TIER_META[0];
  return (
    <span
      className={`tier-badge${size === "lg" ? " tier-badge-lg" : ""}`}
      style={{
        color: meta.color,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.abbr}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TIER LADDER
// ---------------------------------------------------------------------------
function TierLadder({ currentTier }: { currentTier: number }) {
  return (
    <div className="tier-ladder">
      {[1, 2, 3, 4].map((t) => {
        const meta = TIER_META[t]!;
        const done = currentTier >= t;
        const current = currentTier === t;
        return (
          <div key={t} className={`tier-rung${done ? " done" : ""}${current ? " current" : ""}`}>
            <div className="tier-rung-dot" style={{ borderColor: done ? meta.color : "#e5e1d8", background: done ? meta.color : "transparent" }}>
              {done && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1.5 4L3 5.5L6.5 2" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            {t < 4 && <div className="tier-rung-line" style={{ background: currentTier > t ? meta.color : "#e5e1d8" }} />}
            <div className="tier-rung-info">
              <span className="tier-rung-label" style={{ color: done ? "#18160f" : "#a09890" }}>{meta.label}</span>
              <span className="tier-rung-desc">{meta.desc}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KYC COUNTDOWN RING
// ---------------------------------------------------------------------------
function KYCRing({ expiry }: { expiry: number }) {
  const total = 365 * 86400;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, expiry - now);
  const pct = Math.min(1, remaining / total);
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const status = kycStatus(expiry);
  const color = !status.ok ? "#f87171" : status.warning ? "#fbbf24" : "#4ade80";

  return (
    <div className="kyc-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#f0ece4" strokeWidth="5" />
        <circle
          cx="36" cy="36" r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          strokeDashoffset={circ * 0.25}
          style={{ transition: "stroke-dasharray 1s cubic-bezier(.16,1,.3,1)" }}
        />
      </svg>
      <div className="kyc-ring-inner">
        <span className="kyc-ring-pct" style={{ color }}>{Math.round(pct * 100)}<span style={{ fontSize: 9 }}>%</span></span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IDENTITY CARD — connected user
// ---------------------------------------------------------------------------
function MyIdentityCard({ address }: { address: `0x${string}` }) {
  const calls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "getIdentity" as const, args: [address] },
    { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "isIdentityCompliant" as const, args: [address] },
    { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "isRegistered" as const, args: [address] },
    { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "isBlocked" as const, args: [address] },
    { address: CONTRACT_ADDRESSES.ASSET_REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "getInvestorData" as const, args: [address] },
  ], [address]);

  const { data, isLoading, refetch } = useReadContracts({ contracts: calls });

  const identity    = data?.[0]?.result as IdentityRecord | undefined;
  const compliant   = data?.[1]?.result as boolean | undefined;
  const registered  = data?.[2]?.result as boolean | undefined;
  const blocked     = data?.[3]?.result as boolean | undefined;

  const kyc = identity ? kycStatus(identity.kycExpiry) : null;
  const tier = identity ? TIER_META[identity.tier] ?? TIER_META[0] : null;
  const country = identity ? (COUNTRY_CODES[identity.countryCode] ?? `CC-${identity.countryCode}`) : null;
  const sanctioned = identity ? SANCTIONED.has(identity.countryCode) : false;

  return (
    <div className={`id-card${blocked ? " id-card-blocked" : ""}`}>
      {/* ── CARD HEAD ── */}
      <div className="id-card-head">
        <div className="id-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div className="id-addr-group">
          <span className="id-addr-full">{fmtAddr(address)}</span>
          <span className="id-net-label">Base Mainnet · ERC-3643</span>
        </div>
        <div className="id-head-pills">
          {isLoading ? <Skeleton w={90} h={22} /> : (
            <>
              {registered === false && (
                <span className="status-pill no">Not registered</span>
              )}
              {registered && identity && (
                <span className={`status-pill${identity.isActive ? " ok" : " no"}`}>
                  {identity.isActive ? "Active" : "Deactivated"}
                </span>
              )}
              {compliant === true && <span className="status-pill ok">Compliant</span>}
              {compliant === false && registered && <span className="status-pill warn">Non-compliant</span>}
              {blocked && <span className="status-pill err">Globally blocked</span>}
            </>
          )}
        </div>
      </div>

      {/* ── BLOCKED BANNER ── */}
      {blocked && (
        <div className="alert-err" role="alert">
          <IconBlock />
          This address is globally blocked by the compliance officer. All asset transfers and protocol interactions are suspended.
        </div>
      )}

      {/* ── NOT REGISTERED ── */}
      {registered === false && !isLoading && (
        <div className="not-registered">
          <div className="nr-icon"><IconID /></div>
          <div>
            <p className="nr-title">No identity record found</p>
            <p className="nr-body">Contact the protocol registrar to begin KYC onboarding. Accredited and institutional tiers require additional documentation.</p>
          </div>
        </div>
      )}

      {/* ── MAIN DATA — loaded identity ── */}
      {identity && registered && (
        <>
          {/* Stat row */}
          <div className="id-stat-row">
            {/* KYC ring */}
            <div className="id-stat-cell ring-cell">
              {isLoading ? <Skeleton w={72} h={72} /> : <KYCRing expiry={identity.kycExpiry} />}
              <div className="ring-label-group">
                <span className={`kyc-label${kyc?.ok ? (kyc.warning ? " warn" : " ok") : " err"}`}>
                  {kyc?.label ?? "—"}
                </span>
                <span className="kyc-date">{fmtDate(identity.kycExpiry, true)}</span>
              </div>
            </div>

            <div className="id-stat-divider" />

            <div className="id-stat-cell">
              <span className="stat-label">Tier</span>
              {isLoading ? <Skeleton w={70} h={22} /> : (
                <div className="stat-tier-val">
                  <TierBadge tier={identity.tier} size="lg" />
                  <span className="stat-tier-name">{tier?.label}</span>
                </div>
              )}
            </div>

            <div className="id-stat-divider" />

            <div className="id-stat-cell">
              <span className="stat-label">Accreditation</span>
              {isLoading ? <Skeleton w={90} /> : (
                <span className={`stat-val${identity.isAccredited ? " ok" : ""}`}>
                  {identity.isAccredited ? "Accredited investor" : "Standard"}
                </span>
              )}
            </div>

            <div className="id-stat-divider" />

            <div className="id-stat-cell">
              <span className="stat-label">Jurisdiction</span>
              {isLoading ? <Skeleton w={80} /> : (
                <span className={`stat-val${sanctioned ? " err" : ""}`}>
                  {country ?? "—"}
                  {sanctioned && <span className="sanction-tag">Sanctioned</span>}
                </span>
              )}
            </div>
          </div>

          {/* Detail table */}
          <dl className="id-detail-table">
            <div className="id-detail-row">
              <dt>Wallet</dt>
              <dd>
                <a href={`https://basescan.org/address/${address}`}
                  target="_blank" rel="noopener noreferrer"
                  className="mono-link">
                  {address}<IconExternal />
                </a>
              </dd>
            </div>
            <div className="id-detail-row">
              <dt>Identity hash</dt>
              <dd>
                <span className="mono-hash" title={identity.identityHash}>
                  {identity.identityHash.slice(0, 18)}…{identity.identityHash.slice(-10)}
                </span>
              </dd>
            </div>
            <div className="id-detail-row">
              <dt>KYC expiry</dt>
              <dd className={kyc?.warning ? "warn-text" : kyc?.ok ? "" : "err-text"}>
                {fmtDate(identity.kycExpiry)} {kyc?.warning && "— renewal recommended"}
              </dd>
            </div>
            <div className="id-detail-row">
              <dt>Registered</dt>
              <dd>{fmtDate(identity.registeredAt)}</dd>
            </div>
            <div className="id-detail-row">
              <dt>Status</dt>
              <dd>
                <span className={identity.isActive ? "pill-ok" : "pill-no"}>
                  {identity.isActive ? "Active" : "Deactivated"}
                </span>
              </dd>
            </div>
          </dl>

          {/* Tier ladder */}
          <div className="tier-section">
            <p className="tier-section-label">Verification path</p>
            <TierLadder currentTier={identity.tier} />
          </div>
        </>
      )}

      {/* KYC warning */}
      {identity && kyc?.warning && (
        <div className="alert-warn" role="alert">
          <IconWarn />
          KYC expires in under 30 days. Renew now to prevent transfer failures and protocol access loss.
        </div>
      )}

      {identity && !kyc?.ok && !isLoading && (
        <div className="alert-err" role="alert">
          <IconBlock />
          KYC has expired. All outbound transfers are blocked until renewed by the protocol registrar.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOOKUP PANEL — search any address
// ---------------------------------------------------------------------------
function LookupPanel() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<`0x${string}` | null>(null);

  const isValid = /^0x[0-9a-fA-F]{40}$/.test(query);

  const handleSearch = useCallback(() => {
    if (isValid) setSearched(query as `0x${string}`);
  }, [query, isValid]);

  const calls = useMemo(() => {
    if (!searched) return [];
    return [
      { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "getIdentity" as const, args: [searched] },
      { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "isRegistered" as const, args: [searched] },
      { address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`, abi: IDENTITY_ABI, functionName: "isIdentityCompliant" as const, args: [searched] },
      { address: CONTRACT_ADDRESSES.COMPLIANCE_ENGINE as `0x${string}`, abi: COMPLIANCE_ABI, functionName: "isBlocked" as const, args: [searched] },
    ];
  }, [searched]);

  const { data, isLoading } = useReadContracts({ contracts: calls, query: { enabled: !!searched } });

  const identity   = data?.[0]?.result as IdentityRecord | undefined;
  const registered = data?.[1]?.result as boolean | undefined;
  const compliant  = data?.[2]?.result as boolean | undefined;
  const blocked    = data?.[3]?.result as boolean | undefined;

  return (
    <div className="lookup-panel">
      <p className="lookup-title">Address lookup</p>
      <p className="lookup-sub">Check identity status, tier, and KYC compliance for any wallet on-chain.</p>

      <div className="lookup-input-row">
        <input
          className={`lookup-input${query.length > 2 && !isValid ? " lookup-input-err" : ""}`}
          placeholder="0x... wallet address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          spellCheck={false}
          aria-label="Wallet address to look up"
        />
        <button
          className="lookup-btn"
          onClick={handleSearch}
          disabled={!isValid}
          aria-label="Search"
        >
          <IconSearch />
          Search
        </button>
      </div>
      {query.length > 2 && !isValid && (
        <p className="lookup-err-msg">Enter a valid 0x Ethereum address</p>
      )}

      {/* Results */}
      {searched && (
        <div className="lookup-result">
          {isLoading ? (
            <div className="lookup-loading">
              <div className="spin" />
              <span>Reading from chain…</span>
            </div>
          ) : (
            <>
              <div className="lr-head">
                <span className="lr-addr">{fmtAddr(searched)}</span>
                <div className="lr-pills">
                  {registered === false && <span className="status-pill no">Not registered</span>}
                  {registered && <span className={`status-pill${compliant ? " ok" : " warn"}`}>{compliant ? "Compliant" : "Non-compliant"}</span>}
                  {blocked && <span className="status-pill err">Blocked</span>}
                </div>
              </div>

              {registered === false && (
                <p className="lr-empty">No identity record exists for this address.</p>
              )}

              {identity && registered && (
                <div className="lr-grid">
                  {[
                    { label: "Tier",         val: <TierBadge tier={identity.tier} /> },
                    { label: "Status",       val: <span className={identity.isActive ? "pill-ok" : "pill-no"}>{identity.isActive ? "Active" : "Deactivated"}</span> },
                    { label: "Accreditation",val: identity.isAccredited ? "Accredited" : "Standard" },
                    { label: "Country",      val: COUNTRY_CODES[identity.countryCode] ?? `CC-${identity.countryCode}` },
                    { label: "KYC expires",  val: fmtDate(identity.kycExpiry) },
                    { label: "Registered",   val: fmtDate(identity.registeredAt) },
                  ].map(({ label, val }) => (
                    <div key={label} className="lr-cell">
                      <span className="lr-cell-label">{label}</span>
                      <span className="lr-cell-val">{val}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROTOCOL STATS STRIP
// ---------------------------------------------------------------------------
function StatsStrip() {
  const { data: verifier } = useReadContract({
    address: CONTRACT_ADDRESSES.IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_ABI,
    functionName: "getVerifier",
    args: [],
  });

  return (
    <div className="stats-strip">
      {[
        { label: "Standard",  val: "ERC-3643"              },
        { label: "Network",   val: <><i className="base-dot" aria-hidden />Base Mainnet</> },
        { label: "Tiers",     val: "4 verification levels" },
        { label: "Verifier",  val: verifier ? fmtAddr(verifier as string) : <Skeleton w={80} /> },
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
// TIER REFERENCE TABLE
// ---------------------------------------------------------------------------
function TierReference() {
  return (
    <div className="tier-ref">
      <div className="tier-ref-head">
        <p className="section-label">Verification tiers</p>
      </div>
      <div className="tier-ref-grid">
        {[1, 2, 3, 4].map((t) => {
          const meta = TIER_META[t]!;
          return (
            <div key={t} className="tier-ref-card">
              <div className="trc-top">
                <TierBadge tier={t} />
                <span className="trc-name">{meta.label}</span>
              </div>
              <p className="trc-desc">{meta.desc}</p>
              <div className="trc-reqs">
                {t === 1 && <><span className="req-tag">Name + Email</span><span className="req-tag">Government ID</span></>}
                {t === 2 && <><span className="req-tag">Proof of address</span><span className="req-tag">Biometrics</span></>}
                {t === 3 && <><span className="req-tag">Net worth verification</span><span className="req-tag">Tier 2 required</span></>}
                {t === 4 && <><span className="req-tag">Entity verification</span><span className="req-tag">Director KYC</span></>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONTRACT ROW
// ---------------------------------------------------------------------------
function ContractRow({ name, addr }: { name: string; addr: string }) {
  return (
    <div className="ctr-row">
      <span className="ctr-name">{name}</span>
      <a href={`https://basescan.org/address/${addr}`}
        target="_blank" rel="noopener noreferrer"
        className="ctr-addr">
        {addr}<IconExternal />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
function IconExternal() {
  return <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconBlock() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" /><path d="M3 3l8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function IconWarn() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M7 1L13 11H1L7 1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M7 5v3M7 10v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function IconSearch() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function IconID() {
  return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden><rect x="3" y="6" width="22" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="10" cy="13" r="3" stroke="currentColor" strokeWidth="1.4" /><path d="M16 11h5M16 14h5M16 17h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

// ---------------------------------------------------------------------------
// ROOT
// ---------------------------------------------------------------------------
export default function IdentityPage() {
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
            <p className="page-tag">On-chain KYC</p>
            <h1 className="page-h1">Identity Registry</h1>
            <p className="page-sub">
              ERC-3643 compliant identity management. KYC status, verification tiers, and
              jurisdiction checks encoded directly on Base.
            </p>
          </div>
          <StatsStrip />
        </div>

        <div className="page-body">
          {/* Connected identity */}
          {address ? (
            <section className="section">
              <div className="section-head">
                <h2 className="section-label">Your identity</h2>
              </div>
              <MyIdentityCard address={address as `0x${string}`} />
            </section>
          ) : (
            <div className="connect-nudge">
              <div className="cn-icon"><IconID /></div>
              <div>
                <p className="cn-title">Connect to view your identity</p>
                <p className="cn-body">Link your wallet to check KYC status, verification tier, and whitelist standing across all registered assets.</p>
              </div>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className="btn-dark-sm" onClick={openConnectModal}>Connect wallet</button>
                )}
              </ConnectButton.Custom>
            </div>
          )}

          {/* Lookup */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Address lookup</h2>
            </div>
            <LookupPanel />
          </section>

          {/* Tier reference */}
          <section className="section">
            <TierReference />
          </section>

          {/* Contracts */}
          <section className="section">
            <h2 className="section-label">Contract addresses</h2>
            <div className="contract-table">
              <ContractRow name="Identity Registry" addr={CONTRACT_ADDRESSES.IDENTITY_REGISTRY} />
              <ContractRow name="Asset Registry"    addr={CONTRACT_ADDRESSES.ASSET_REGISTRY} />
              <ContractRow name="Compliance Engine" addr={CONTRACT_ADDRESSES.COMPLIANCE_ENGINE} />
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
.page-sub{font-size:14.5px;line-height:1.72;color:#7c7363;max-width:520px}

/* STATS STRIP */
.stats-strip{max-width:1100px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;gap:0;scrollbar-width:none}
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
.pill-ok{display:inline;font-size:12.5px;font-weight:600;color:#16a34a}
.pill-no{display:inline;font-size:12.5px;font-weight:600;color:#dc2626}

/* IDENTITY CARD */
.id-card{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:20px}
.id-card-blocked{border-color:rgba(248,113,113,0.3);background:rgba(255,240,240,0.6)}

/* card head */
.id-card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.id-avatar{width:44px;height:44px;border-radius:12px;background:#f3f0e8;display:grid;place-items:center;color:#7c7363;flex-shrink:0}
.id-avatar svg{width:22px;height:22px}
.id-addr-group{flex:1;min-width:0}
.id-addr-full{display:block;font-family:'Syne',sans-serif;font-size:15px;font-weight:700;color:#18160f;letter-spacing:-0.01em;font-variant-numeric:tabular-nums}
.id-net-label{font-size:12px;color:#a09890;margin-top:2px;display:block}
.id-head-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}

/* stat row */
.id-stat-row{display:grid;grid-template-columns:auto 1px auto 1px auto 1px auto;gap:0;background:rgba(0,0,0,0.05);border-radius:12px;overflow:hidden}
.id-stat-cell{display:flex;flex-direction:column;gap:8px;padding:16px 20px;background:#faf9f6}
.id-stat-divider{background:rgba(0,0,0,0.06);width:1px;align-self:stretch}
.ring-cell{flex-direction:row;align-items:center;gap:12px}
.ring-label-group{display:flex;flex-direction:column;gap:3px}
.stat-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.stat-tier-val{display:flex;align-items:center;gap:7px}
.stat-tier-name{font-size:13.5px;font-weight:600;color:#18160f}
.stat-val{font-size:13.5px;font-weight:600;color:#18160f}
.stat-val.ok{color:#16a34a}
.stat-val.err{color:#dc2626}
.sanction-tag{margin-left:6px;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:4px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca}

/* KYC ring */
.kyc-ring-wrap{position:relative;width:72px;height:72px;flex-shrink:0}
.kyc-ring-wrap svg{position:absolute;inset:0;transform:rotate(-90deg)}
.kyc-ring-inner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.kyc-ring-pct{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;line-height:1}
.kyc-label{font-size:12px;font-weight:600}
.kyc-label.ok{color:#16a34a}
.kyc-label.warn{color:#d97706}
.kyc-label.err{color:#dc2626}
.kyc-date{font-size:11px;color:#a09890}

/* detail table */
.id-detail-table{display:flex;flex-direction:column;border:1px solid rgba(0,0,0,0.06);border-radius:10px;overflow:hidden;list-style:none}
.id-detail-row{display:flex;justify-content:space-between;align-items:center;padding:9px 14px;font-size:13px;border-bottom:1px solid rgba(0,0,0,0.04);gap:16px}
.id-detail-row:last-child{border-bottom:none}
.id-detail-row dt{color:#7c7363;font-weight:400;flex-shrink:0}
.id-detail-row dd{font-weight:500;color:#18160f;text-align:right;overflow:hidden;text-overflow:ellipsis}
.warn-text{color:#d97706!important}
.err-text{color:#dc2626!important}
.mono-link{font-family:'Inter',monospace;font-size:12px;color:#f97316;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:opacity .13s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.mono-link:hover{opacity:.72}
.mono-hash{font-family:'Inter',monospace;font-size:12px;color:#5a5245}

/* tier ladder */
.tier-section{display:flex;flex-direction:column;gap:12px;padding:16px;background:rgba(0,0,0,0.02);border-radius:10px;border:1px solid rgba(0,0,0,0.05)}
.tier-section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a09890}
.tier-ladder{display:flex;flex-direction:column;gap:0}
.tier-rung{display:flex;align-items:flex-start;gap:12px;position:relative}
.tier-rung-dot{width:18px;height:18px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;transition:all .3s}
.tier-rung-line{width:2px;height:22px;margin-left:8px;margin-top:2px;margin-bottom:2px;transition:background .3s}
.tier-rung{flex-direction:row;align-items:center}
.tier-ladder{display:grid;grid-template-columns:repeat(4,1fr);gap:0;position:relative}
.tier-rung{flex-direction:column;align-items:center;text-align:center;gap:6px;padding:0 4px}
.tier-rung-dot{margin-top:0}
.tier-rung-line{display:none}
.tier-rung-info{display:flex;flex-direction:column;gap:2px}
.tier-rung-label{font-size:12px;font-weight:600}
.tier-rung-desc{font-size:10px;color:#a09890;line-height:1.4}

/* alerts */
.alert-warn{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:9px;font-size:13px;color:#92400e;font-weight:500;line-height:1.5}
.alert-err{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:9px;font-size:13px;color:#991b1b;font-weight:500;line-height:1.5}
.alert-warn svg,.alert-err svg{flex-shrink:0;margin-top:1px}

/* not registered */
.not-registered{display:flex;align-items:flex-start;gap:16px;padding:20px;background:rgba(0,0,0,0.02);border-radius:10px;border:1px solid rgba(0,0,0,0.06)}
.nr-icon{color:#a09890;flex-shrink:0}
.nr-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;margin-bottom:4px}
.nr-body{font-size:13.5px;line-height:1.7;color:#7c7363}

/* TIER BADGE */
.tier-badge{font-size:10px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:5px;text-transform:uppercase;font-family:'Syne',sans-serif}
.tier-badge-lg{font-size:11px;padding:4px 10px}

/* CONNECT NUDGE */
.connect-nudge{display:flex;align-items:center;gap:18px;padding:22px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.cn-icon{color:#a09890;flex-shrink:0}
.cn-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;margin-bottom:4px}
.cn-body{font-size:13.5px;line-height:1.68;color:#7c7363}
.btn-dark-sm{margin-left:auto;padding:9px 18px;border-radius:8px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .15s,transform .15s;flex-shrink:0}
.btn-dark-sm:hover{background:#2e2a1e;transform:translateY(-1px)}

/* LOOKUP PANEL */
.lookup-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:16px}
.lookup-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.lookup-sub{font-size:13.5px;color:#7c7363;line-height:1.6;margin-top:-8px}
.lookup-input-row{display:flex;gap:9px}
.lookup-input{flex:1;padding:10px 14px;border-radius:9px;border:1px solid rgba(0,0,0,0.12);background:rgba(255,255,255,0.8);font-size:13px;font-family:'Inter',monospace;color:#18160f;outline:none;transition:border-color .14s,box-shadow .14s}
.lookup-input:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,0.12)}
.lookup-input-err{border-color:#f87171}
.lookup-input-err:focus{border-color:#f87171;box-shadow:0 0 0 3px rgba(248,113,113,0.12)}
.lookup-btn{display:flex;align-items:center;gap:7px;padding:10px 18px;border-radius:9px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .14s,transform .14s,opacity .14s}
.lookup-btn:hover:not(:disabled){background:#2e2a1e;transform:translateY(-1px)}
.lookup-btn:disabled{background:#e5e1d8;color:#a09890;cursor:not-allowed}
.lookup-err-msg{font-size:12px;color:#dc2626;margin-top:-8px}

/* Lookup result */
.lookup-result{border:1px solid rgba(0,0,0,0.06);border-radius:12px;overflow:hidden}
.lookup-loading{display:flex;align-items:center;gap:10px;padding:20px;font-size:13.5px;color:#7c7363}
.lr-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#faf9f6;border-bottom:1px solid rgba(0,0,0,0.05);gap:10px;flex-wrap:wrap}
.lr-addr{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;font-variant-numeric:tabular-nums}
.lr-pills{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lr-empty{padding:20px 16px;font-size:13.5px;color:#9ca3af;font-style:italic}
.lr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(0,0,0,0.06)}
.lr-cell{display:flex;flex-direction:column;gap:4px;padding:12px 14px;background:#fff}
.lr-cell-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.lr-cell-val{font-size:13px;font-weight:600;color:#18160f;display:flex;align-items:center;gap:5px}

/* TIER REFERENCE */
.tier-ref{display:flex;flex-direction:column;gap:14px}
.tier-ref-head{display:flex;align-items:center;justify-content:space-between}
.tier-ref-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tier-ref-card{padding:18px 16px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:14px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.03);display:flex;flex-direction:column;gap:10px;transition:transform .18s,box-shadow .18s}
.tier-ref-card:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,0.05),0 12px 28px rgba(0,0,0,0.07)}
.trc-top{display:flex;align-items:center;gap:8px}
.trc-name{font-family:'Syne',sans-serif;font-size:13.5px;font-weight:700;color:#18160f}
.trc-desc{font-size:12.5px;color:#7c7363;line-height:1.6}
.trc-reqs{display:flex;flex-wrap:wrap;gap:5px}
.req-tag{font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;background:#f3f0e8;color:#5a5245;border:1px solid #e5e1d8}

/* CONTRACT TABLE */
.contract-table{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:12px;backdrop-filter:blur(12px);overflow:hidden}
.ctr-row{display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-bottom:1px solid rgba(0,0,0,0.05);gap:16px}
.ctr-row:last-child{border-bottom:none}
.ctr-name{font-size:13px;font-weight:600;color:#18160f;flex-shrink:0}
.ctr-addr{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:flex;align-items:center;gap:5px;transition:opacity .13s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctr-addr:hover{opacity:.72}

/* SKELETON */
.skel{display:inline-block;height:14px;border-radius:4px;background:linear-gradient(90deg,#edeae4 25%,#e0dcd5 50%,#edeae4 75%);background-size:200% 100%;animation:skel 1.4s linear infinite;vertical-align:middle}
@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* SPINNER */
.spin{width:16px;height:16px;border:2px solid #e5e1d8;border-top-color:#f97316;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* RESPONSIVE */
@media(max-width:640px){
  .nav{grid-template-columns:1fr auto;gap:8px;padding:0 16px}
  .nav-links{display:none}
  .page-header-inner{padding:28px 16px 20px}
  .stats-strip{padding:12px 16px}
  .ss-item{padding:0 10px}
  .page-body{padding:24px 16px 64px;gap:28px}
  .id-stat-row{grid-template-columns:1fr;gap:0}
  .id-stat-divider{height:1px;width:auto;align-self:stretch}
  .tier-ladder{grid-template-columns:repeat(2,1fr);gap:10px}
  .tier-ref-grid{grid-template-columns:repeat(2,1fr)}
  .lookup-input-row{flex-direction:column}
  .lookup-btn{width:100%;justify-content:center}
  .lr-grid{grid-template-columns:repeat(2,1fr)}
  .connect-nudge{flex-direction:column;align-items:flex-start;gap:12px}
  .btn-dark-sm{margin-left:0}
  .ctr-row{flex-direction:column;align-items:flex-start;gap:4px}
  .id-card-head{gap:10px}
  .id-head-pills{width:100%;margin-left:0}
}
@media(min-width:641px) and (max-width:900px){
  .nav-links{gap:0}
  .nav-link{padding:5px 9px;font-size:12.5px}
  .tier-ref-grid{grid-template-columns:repeat(2,1fr)}
  .id-stat-row{grid-template-columns:auto 1px auto 1px 1fr}
  .lr-grid{grid-template-columns:repeat(2,1fr)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;