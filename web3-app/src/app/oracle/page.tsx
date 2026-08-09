"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useReadContracts, useReadContract } from "wagmi";
import { formatUnits } from "viem";

import { CONTRACT_ADDRESSES } from "@/constants/contracts";

// ---------------------------------------------------------------------------
// KNOWN ASSETS — same across all pages
// ---------------------------------------------------------------------------
const KNOWN_ASSETS = [
  {
    id: "0x5553545249455f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f00" as `0x${string}`,
    label: "US Treasury Bill",
    ticker: "nxTBILL",
    expectedDecimals: 8,
  },
  {
    id: "0x5245414c5f45535441544500000000000000000000000000000000000000000000" as `0x${string}`,
    label: "Real Estate Fund",
    ticker: "nxRE",
    expectedDecimals: 8,
  },
  {
    id: "0x434f52505f424f4e440000000000000000000000000000000000000000000000" as `0x${string}`,
    label: "Corporate Bond",
    ticker: "nxCORPB",
    expectedDecimals: 8,
  },
] as const;

// ---------------------------------------------------------------------------
// ABI SLICES
// ---------------------------------------------------------------------------
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
    name: "getSnapshot",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{
      name: "snapshot",
      type: "tuple",
      components: [
        { name: "price",     type: "int256"  },
        { name: "timestamp", type: "uint40"  },
      ],
    }],
  },
  {
    name: "getFeedConfig",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assetId", type: "bytes32" }],
    outputs: [{
      name: "config",
      type: "tuple",
      components: [
        { name: "feed",     type: "address" },
        { name: "decimals", type: "uint8"   },
        { name: "active",   type: "bool"    },
      ],
    }],
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
  {
    name: "i_guardian",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type NAVResult   = [bigint, number, number]; // price, updatedAt, decimals
type Snapshot    = { price: bigint; timestamp: number };
type FeedConfig  = { feed: `0x${string}`; decimals: number; active: boolean };

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const MAX_STALENESS_SEC = 3600; // 1 hour — mirrors NAVLib.MAX_STALENESS
const NAV_DROP_BPS      = 1500; // 15%    — mirrors NAVLib.NAV_DROP_BPS
const SNAP_WINDOW_SEC   = 86400; // 24h   — mirrors NAVLib.NAV_DROP_WINDOW

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function fmtAddr(a: string) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

function fmtNAV(price: bigint, dec: number) {
  const n = Number(formatUnits(price, dec));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function fmtDate(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function ageLabel(ts: number) {
  if (!ts) return { label: "Never", warn: true };
  const sec = Math.floor(Date.now() / 1000) - ts;
  if (sec < 60)   return { label: `${sec}s ago`,           warn: false };
  if (sec < 3600) return { label: `${Math.floor(sec/60)}m ago`, warn: false };
  return { label: `${Math.floor(sec/3600)}h ago`, warn: true };
}

function stalenessBar(updatedAt: number) {
  if (!updatedAt) return 1;
  const age = Math.floor(Date.now() / 1000) - updatedAt;
  return Math.min(age / MAX_STALENESS_SEC, 1);
}

function bpsDrop(snap: bigint, current: bigint): number {
  if (!snap || !current || snap === BigInt(0)) return 0;
  if (current >= snap) return 0;
  return Number(((snap - current) * BigInt(10000)) / snap);
}
// ---------------------------------------------------------------------------
// LIVE CLOCK
// ---------------------------------------------------------------------------
function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ---------------------------------------------------------------------------
// COMPONENTS
// ---------------------------------------------------------------------------
function Skel({ w = 80, h = 14 }: { w?: number; h?: number }) {
  return <span className="skel" style={{ width: w, height: h }} />;
}

function Nav() {
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
            className={`nav-link${l === "Oracle" ? " active" : ""}`}>
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
// STALENESS BAR
// ---------------------------------------------------------------------------
function StalenessBar({ updatedAt, now }: { updatedAt: number; now: number }) {
  const age = updatedAt ? now - updatedAt : MAX_STALENESS_SEC;
  const pct = Math.min(age / MAX_STALENESS_SEC, 1);
  const stale = pct >= 1;
  const color = pct < 0.6 ? "#4ade80" : pct < 0.85 ? "#fbbf24" : "#f87171";
  return (
    <div className="stale-wrap">
      <div className="stale-track">
        <div className="stale-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="stale-label" style={{ color }}>
        {stale ? "Stale" : `${Math.round(pct * 100)}% of 1h`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MINI PRICE INDICATOR (shows drop from snapshot)
// ---------------------------------------------------------------------------
function DropIndicator({ snap, current, decimals }: {
  snap: bigint; current: bigint; decimals: number;
}) {
  if (!snap || !current) return null;
  const bps = bpsDrop(snap, current);
  if (bps === 0) return <span className="drop-neutral">No drop from snapshot</span>;
  const pct = (bps / 100).toFixed(2);
  const danger = bps >= NAV_DROP_BPS;
  return (
    <span className={`drop-badge${danger ? " danger" : " warn"}`}>
      <IconArrowDown />
      {pct}% from 24h snapshot {danger ? "— above threshold" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ASSET NAV CARD
// ---------------------------------------------------------------------------
function AssetNavCard({ meta, oraclePaused, now }: {
  meta: (typeof KNOWN_ASSETS)[number];
  oraclePaused: boolean;
  now: number;
}) {
  const calls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "getLatestNAV" as const, args: [meta.id] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "getSnapshot" as const, args: [meta.id] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "getFeedConfig" as const, args: [meta.id] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "isCircuitBreakerTripped" as const, args: [meta.id] },
  ], [meta.id]);

  const { data, isLoading, error } = useReadContracts({ contracts: calls });

  const navResult  = data?.[0]?.result as NAVResult    | undefined;
  const snapshot   = data?.[1]?.result as Snapshot     | undefined;
  const feedConfig = data?.[2]?.result as FeedConfig   | undefined;
  const cbTripped  = data?.[3]?.result as boolean      | undefined;

  const price     = navResult?.[0];
  const updatedAt = navResult?.[1];
  const decimals  = navResult?.[2] ?? meta.expectedDecimals;

  const feedNotRegistered = !feedConfig?.active && !isLoading;
  const isStale = updatedAt ? (now - updatedAt) > MAX_STALENESS_SEC : false;

  const snapshotAge = snapshot?.timestamp
    ? now - snapshot.timestamp
    : null;
  const snapshotExpired = snapshotAge !== null && snapshotAge > SNAP_WINDOW_SEC;

  const { label: ageStr, warn: ageWarn } = updatedAt ? ageLabel(updatedAt) : { label: "—", warn: false };

  let cardState: "ok" | "warn" | "err" | "paused" | "unregistered" = "ok";
  if (oraclePaused || cbTripped || isStale) cardState = "err";
  else if (feedNotRegistered) cardState = "unregistered";
  else if (ageWarn) cardState = "warn";

type CardState = "ok" | "warn" | "err" | "paused" | "unregistered";

  const stateColors: Record<CardState, { border: string; bg: string }> = {
    ok:           { border: "rgba(74,222,128,0.25)", bg: "transparent" },
    warn:         { border: "rgba(251,191,36,0.25)", bg: "rgba(255,251,235,0.2)" },
    err:          { border: "rgba(248,113,113,0.3)", bg: "rgba(255,240,240,0.3)" },
    paused:       { border: "rgba(248,113,113,0.3)", bg: "rgba(255,240,240,0.3)" },
    unregistered: { border: "rgba(0,0,0,0.08)",      bg: "transparent" },
  };

  return (
    <article
      className="nav-card"
      style={{ borderColor: stateColors[cardState].border, background: stateColors[cardState].bg }}
    >
      {/* Head */}
      <div className="nc-head">
        <div className="nc-ticker-group">
          <span className="nc-ticker">{meta.ticker}</span>
          <span className="nc-label">{meta.label}</span>
        </div>
        <div className="nc-badges">
          {oraclePaused && <span className="badge err">Oracle paused</span>}
          {!oraclePaused && cbTripped && <span className="badge err"><IconAlert />CB tripped</span>}
          {!oraclePaused && !cbTripped && feedNotRegistered && <span className="badge neutral">No feed</span>}
          {!oraclePaused && !cbTripped && !feedNotRegistered && isStale && <span className="badge err">Stale</span>}
          {!oraclePaused && !cbTripped && !feedNotRegistered && !isStale && (
            <span className="badge ok">
              <i className="live-dot" />Live
            </span>
          )}
        </div>
      </div>

      {/* Price hero */}
      <div className="nc-price-row">
        {isLoading ? (
          <Skel w={140} h={36} />
        ) : oraclePaused ? (
          <span className="nc-price nc-price-paused">—</span>
        ) : cbTripped ? (
          <span className="nc-price nc-price-err">Circuit open</span>
        ) : error || feedNotRegistered ? (
          <span className="nc-price nc-price-muted">Feed not registered</span>
        ) : price !== undefined ? (
          <span className="nc-price">{fmtNAV(price, decimals)}</span>
        ) : (
          <span className="nc-price nc-price-muted">—</span>
        )}

        {price !== undefined && snapshot?.price !== undefined && !cbTripped && !oraclePaused && (
          <DropIndicator snap={snapshot.price} current={price} decimals={decimals} />
        )}
      </div>

      {/* Staleness bar */}
      {!feedNotRegistered && !oraclePaused && (
        <StalenessBar updatedAt={updatedAt ?? 0} now={now} />
      )}

      {/* Data grid */}
      <div className="nc-grid">
        <div className="nc-cell">
          <span className="nc-cell-label">Last update</span>
          <span className={`nc-cell-val${ageWarn ? " warn" : ""}`}>
            {isLoading ? <Skel w={80} /> : ageStr}
          </span>
        </div>
        <div className="nc-cell">
          <span className="nc-cell-label">Feed decimals</span>
          <span className="nc-cell-val">
            {isLoading ? <Skel w={24} /> : feedConfig?.decimals ?? "—"}
          </span>
        </div>
        <div className="nc-cell">
          <span className="nc-cell-label">CB status</span>
          <span className={`nc-cell-val${cbTripped ? " err" : " ok"}`}>
            {isLoading ? <Skel w={56} /> : cbTripped ? "Tripped" : "Normal"}
          </span>
        </div>
        <div className="nc-cell">
          <span className="nc-cell-label">Snapshot age</span>
          <span className={`nc-cell-val${snapshotExpired ? " warn" : ""}`}>
            {isLoading ? <Skel w={60} /> : snapshot?.timestamp
              ? ageLabel(snapshot.timestamp).label
              : "No snapshot"}
          </span>
        </div>
        <div className="nc-cell">
          <span className="nc-cell-label">Feed address</span>
          {isLoading ? <Skel w={90} /> : feedConfig?.feed && feedConfig.feed !== "0x0000000000000000000000000000000000000000" ? (
            <a href={`https://basescan.org/address/${feedConfig.feed}`}
               target="_blank" rel="noopener noreferrer"
               className="mono-link nc-cell-val">
              {fmtAddr(feedConfig.feed)}<IconExternal />
            </a>
          ) : <span className="nc-cell-val nc-cell-muted">—</span>}
        </div>
        <div className="nc-cell">
          <span className="nc-cell-label">Full timestamp</span>
          <span className="nc-cell-val nc-cell-ts">
            {isLoading ? <Skel w={110} /> : updatedAt ? fmtDate(updatedAt) : "—"}
          </span>
        </div>
      </div>

      {/* Snapshot detail */}
      {snapshot?.price !== undefined && !cbTripped && !oraclePaused && (
        <div className="nc-snapshot">
          <span className="nc-snapshot-label">24h snapshot</span>
          <span className="nc-snapshot-val">
            {fmtNAV(snapshot.price, decimals)}
            <span className="nc-snapshot-ts"> · set {ageLabel(snapshot.timestamp).label}</span>
          </span>
        </div>
      )}

      {isLoading && <div className="card-shimmer" />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// PROTOCOL STATUS STRIP
// ---------------------------------------------------------------------------
function StatusStrip() {
  const calls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "isPaused" as const, args: [] },
    { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "i_guardian" as const, args: [] },
  ], []);

  const { data } = useReadContracts({ contracts: calls });
  const paused   = data?.[0]?.result as boolean | undefined;
  const guardian = data?.[1]?.result as string  | undefined;

  return (
    <div className="status-strip">
      {[
        { label: "Oracle",    val: paused === undefined ? <Skel w={48} /> : paused ? <span style={{color:"#f87171"}}>Paused</span> : <span style={{color:"#4ade80"}}>Active</span> },
        { label: "Network",   val: <><i className="base-dot" aria-hidden />Base Mainnet</> },
        { label: "Feed type", val: "Chainlink AggregatorV3" },
        { label: "Max staleness", val: "1 hour" },
        { label: "CB threshold",  val: "−15% / 24h" },
        { label: "Guardian", val: guardian ? <a href={`https://basescan.org/address/${guardian}`} target="_blank" rel="noopener noreferrer" className="mono-link-sm">{fmtAddr(guardian)}</a> : <Skel w={80} /> },
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
// ORACLE PAUSED BANNER
// ---------------------------------------------------------------------------
function PausedBanner() {
  return (
    <div className="paused-banner" role="alert">
      <IconPause />
      <div>
        <p className="pb-title">Oracle paused</p>
        <p className="pb-body">All NAV reads are suspended. The guardian address can unpause the oracle after the security review is complete.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ARCHITECTURE REFERENCE
// ---------------------------------------------------------------------------
function ArchReference() {
  const checks = [
    { n: "1", title: "Round validity",   desc: "roundId > 0 and startedAt > 0. Rejects unitialized or corrupted rounds from the aggregator." },
    { n: "2", title: "Round completeness", desc: "answeredInRound >= roundId. Prevents consuming a round that is still being answered by Chainlink nodes." },
    { n: "3", title: "Staleness guard",  desc: "block.timestamp − updatedAt ≤ 1 hour (MAX_STALENESS). Reverts with StalePriceFeed on stale data." },
    { n: "4", title: "Negative price",   desc: "price > 0. Chainlink can return negative or zero on misconfigured feeds — this gate rejects them." },
    { n: "5", title: "Dust price",       desc: "price ≥ 100 (MIN_VALID_PRICE). Prevents near-zero dust prices from passing as valid NAV." },
    { n: "6", title: "Circuit breaker",  desc: "If current price drops > 15% from the 24h snapshot within the NAV_DROP_WINDOW, the breaker trips and halts all reads until the guardian resets it manually." },
  ];

  return (
    <div className="arch-panel">
      <div className="arch-header">
        <p className="arch-title">Validation pipeline</p>
        <p className="arch-sub">Every call to <code>getLatestNAV()</code> runs these checks in order. One failure reverts the entire read.</p>
      </div>
      <div className="arch-checks">
        {checks.map(({ n, title, desc }) => (
          <div key={n} className="arch-check">
            <span className="arch-n">{n}</span>
            <div className="arch-check-body">
              <span className="arch-check-title">{title}</span>
              <span className="arch-check-desc">{desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CIRCUIT BREAKER EXPLAINER
// ---------------------------------------------------------------------------
function CBExplainer() {
  const W = 360;
  const H = 80;
  const pts = [0, 5, 2, 8, 3, 6, 4, 10, 5, 8, 6, 9, 7, 12, 8, 9, 9, 10, 10, 7, 11, 3];
  const pathD = pts.reduce((acc, v, i) =>
    i % 2 === 0 ? `${acc} ${(v / 11) * W}` : `${acc},${H - (v / 14) * H} L`, "M"
  ).slice(0, -2);

  return (
    <div className="cb-explainer">
      <div className="cb-header">
        <p className="cb-title">Circuit breaker — 15% threshold</p>
        <p className="cb-sub">
          The oracle stores a 24-hour price snapshot. On every NAV read, if the current price has
          fallen more than 15% from that snapshot within the same window, the circuit breaker trips
          automatically. Reads revert with <code>CircuitBreakerTripped</code> until the guardian resets it.
        </p>
      </div>
      <div className="cb-diagram">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden>
          <path d={pathD} fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1={(10 / 11) * W} y1="0" x2={(10 / 11) * W} y2={H} stroke="#f87171" strokeWidth="1.2" strokeDasharray="4 3" />
          <circle cx={(10 / 11) * W} cy={H - (3 / 14) * H} r="4" fill="#f87171" />
          <text x={(10 / 11) * W + 6} y={H - (3 / 14) * H + 4} fill="#f87171" fontSize="9" fontFamily="Inter">CB trips here</text>
          <text x="4" y={H - 4} fill="#a09890" fontSize="9" fontFamily="Inter">time →</text>
        </svg>
        <div className="cb-legend">
          {[
            { color: "#4ade80", label: "NAV price over time" },
            { color: "#f87171", label: "−15% drop triggers breaker" },
          ].map(({ color, label }) => (
            <div key={label} className="cb-legend-item">
              <div className="cb-legend-dot" style={{ background: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
function IconExternal() { return <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconAlert()    { return <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M6 1L11 10H1L6 1Z" fill="#f87171"/></svg>; }
function IconArrowDown(){ return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden><path d="M5 1v8M2 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconPause()    { return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden><rect x="4" y="3" width="4" height="14" rx="1" fill="#f87171"/><rect x="12" y="3" width="4" height="14" rx="1" fill="#f87171"/></svg>; }

// ---------------------------------------------------------------------------
// ROOT PAGE
// ---------------------------------------------------------------------------
export default function OraclePage() {
  const [entered, setEntered] = useState(false);
  const now = useClock();

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  const { data: globalData } = useReadContracts({
    contracts: [
      { address: CONTRACT_ADDRESSES.NAV_ORACLE as `0x${string}`, abi: NAV_ABI, functionName: "isPaused" as const, args: [] },
    ],
  });
  const oraclePaused = globalData?.[0]?.result as boolean | undefined;

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{CSS}</style>
      <Nav />

      <main className={`main${entered ? " in" : ""}`}>
        {/* Page header */}
        <div className="page-header">
          <div className="page-header-inner">
            <p className="page-tag">Chainlink-powered</p>
            <h1 className="page-h1">NAV Oracle</h1>
            <p className="page-sub">
              Live net asset value reads from the protocol's NAV oracle. Per-asset Chainlink feeds
              with staleness guards, dust rejection, and an autonomous 15% circuit breaker.
            </p>
          </div>
          <StatusStrip />
        </div>

        <div className="page-body">
          {/* Oracle paused banner */}
          {oraclePaused && (
            <section className="section">
              <PausedBanner />
            </section>
          )}

          {/* Asset NAV cards */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-label">Live NAV feeds</h2>
              <span className="live-chip">
                <i className="live-dot" aria-hidden />
                Reads from chain
              </span>
            </div>
            <div className="nav-grid">
              {KNOWN_ASSETS.map((a) => (
                <AssetNavCard
                  key={a.id}
                  meta={a}
                  oraclePaused={oraclePaused ?? false}
                  now={now}
                />
              ))}
            </div>
          </section>

          {/* Circuit breaker */}
          <section className="section">
            <h2 className="section-label">Circuit breaker</h2>
            <CBExplainer />
          </section>

          {/* Validation pipeline */}
          <section className="section">
            <h2 className="section-label">Validation pipeline</h2>
            <ArchReference />
          </section>

          {/* Contract addresses */}
          <section className="section">
            <h2 className="section-label">Contract addresses</h2>
            <div className="addr-table">
              {[
                { name: "NAV Oracle",     addr: CONTRACT_ADDRESSES.NAV_ORACLE     },
                { name: "Asset Registry", addr: CONTRACT_ADDRESSES.ASSET_REGISTRY },
              ].map(({ name, addr }) => (
                <div className="addr-row" key={name}>
                  <span className="addr-name">{name}</span>
                  <a href={`https://basescan.org/address/${addr}`}
                     target="_blank" rel="noopener noreferrer"
                     className="addr-mono">
                    {addr}<IconExternal />
                  </a>
                </div>
              ))}
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
code{font-family:'Inter',monospace;font-size:12px;background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px}

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

/* STATUS STRIP */
.status-strip{max-width:1100px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;scrollbar-width:none;gap:0}
.status-strip::-webkit-scrollbar{display:none}
.ss-group{display:flex;align-items:center;flex-shrink:0}
.ss-item{display:flex;flex-direction:column;gap:2px;padding:0 18px}
.ss-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.ss-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#18160f;display:flex;align-items:center;gap:5px}
.base-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#0052ff;flex-shrink:0}
.ss-div{width:1px;height:26px;background:rgba(0,0,0,0.08);flex-shrink:0}
.mono-link-sm{font-family:'Inter',monospace;font-size:12px;color:#f97316;text-decoration:none;transition:opacity .13s}
.mono-link-sm:hover{opacity:.72}

/* PAGE BODY */
.page-body{max-width:1100px;margin:0 auto;padding:32px 28px 80px;display:flex;flex-direction:column;gap:36px}

/* SECTION */
.section{display:flex;flex-direction:column;gap:14px}
.section-head{display:flex;align-items:center;gap:10px}
.section-label{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7c7363}
.live-chip{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;padding:3px 9px;border-radius:99px}
.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0;animation:blink 2s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}

/* PAUSED BANNER */
.paused-banner{display:flex;align-items:flex-start;gap:14px;padding:18px 20px;background:#fef2f2;border:1px solid #fecaca;border-radius:14px}
.pb-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#991b1b;margin-bottom:4px}
.pb-body{font-size:13.5px;line-height:1.65;color:#7f1d1d}

/* NAV GRID */
.nav-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}

/* NAV CARD */
.nav-card{position:relative;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:20px;display:flex;flex-direction:column;gap:16px;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s,background .2s}
.nav-card:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,0.05),0 16px 36px rgba(0,0,0,0.08)}
.card-shimmer{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#f97316 0%,#fbbf24 50%,#f97316 100%);background-size:200% 100%;animation:shimmer 1.6s linear infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* card head */
.nc-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.nc-ticker-group{display:flex;flex-direction:column;gap:2px}
.nc-ticker{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;color:#18160f;letter-spacing:-0.01em}
.nc-label{font-size:12px;color:#7c7363}
.nc-badges{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}

/* badges */
.badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;border:1px solid;letter-spacing:.05em;text-transform:uppercase}
.badge.ok{background:#f0fdf4;color:#16a34a;border-color:#bbf7d0}
.badge.err{background:#fef2f2;color:#dc2626;border-color:#fecaca}
.badge.warn{background:#fffbeb;color:#d97706;border-color:#fde68a}
.badge.neutral{background:#f9fafb;color:#6b7280;border-color:#e5e7eb}

/* price */
.nc-price-row{display:flex;flex-direction:column;gap:6px}
.nc-price{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;letter-spacing:-0.03em;color:#18160f;line-height:1}
.nc-price-err{color:#dc2626;font-size:18px}
.nc-price-paused{color:#a09890}
.nc-price-muted{color:#a09890;font-size:16px}

/* drop indicator */
.drop-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px}
.drop-badge.warn{background:#fffbeb;color:#d97706;border:1px solid #fde68a}
.drop-badge.danger{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
.drop-neutral{font-size:11px;color:#a09890}

/* staleness bar */
.stale-wrap{display:flex;flex-direction:column;gap:4px}
.stale-track{height:3px;border-radius:2px;background:rgba(0,0,0,0.07);overflow:hidden}
.stale-fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.16,1,.3,1),background .4s}
.stale-label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}

/* data grid */
.nc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.nc-cell{display:flex;flex-direction:column;gap:3px;padding:10px 12px;background:#faf9f6}
.nc-cell-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.nc-cell-val{font-size:12.5px;font-weight:600;color:#18160f}
.nc-cell-val.ok{color:#16a34a}
.nc-cell-val.err{color:#dc2626}
.nc-cell-val.warn{color:#d97706}
.nc-cell-muted{color:#a09890!important}
.nc-cell-ts{font-size:11px;color:#5a5245!important}
.mono-link{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:opacity .13s}
.mono-link:hover{opacity:.72}

/* snapshot */
.nc-snapshot{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(0,0,0,0.025);border-radius:8px;font-size:12px}
.nc-snapshot-label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#a09890}
.nc-snapshot-val{font-weight:600;color:#18160f}
.nc-snapshot-ts{font-weight:400;color:#a09890}

/* CB EXPLAINER */
.cb-explainer{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:18px}
.cb-header{}
.cb-title{font-family:'Syne',sans-serif;font-size:14.5px;font-weight:700;color:#18160f;margin-bottom:6px}
.cb-sub{font-size:13.5px;line-height:1.68;color:#7c7363}
.cb-diagram{display:flex;flex-direction:column;gap:10px;padding:16px;background:rgba(0,0,0,0.02);border-radius:10px;border:1px solid rgba(0,0,0,0.05)}
.cb-legend{display:flex;gap:20px;flex-wrap:wrap}
.cb-legend-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#7c7363}
.cb-legend-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* ARCH REFERENCE */
.arch-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:18px}
.arch-header{}
.arch-title{font-family:'Syne',sans-serif;font-size:14.5px;font-weight:700;color:#18160f;margin-bottom:6px}
.arch-sub{font-size:13.5px;line-height:1.68;color:#7c7363}
.arch-checks{display:flex;flex-direction:column}
.arch-check{display:flex;align-items:flex-start;gap:14px;padding:13px 0;border-bottom:1px solid rgba(0,0,0,0.05)}
.arch-check:last-child{border-bottom:none}
.arch-n{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;color:#f97316;flex-shrink:0;width:16px;margin-top:1px}
.arch-check-body{display:flex;flex-direction:column;gap:3px}
.arch-check-title{font-size:13.5px;font-weight:600;color:#18160f}
.arch-check-desc{font-size:12.5px;line-height:1.6;color:#7c7363}

/* ADDR TABLE */
.addr-table{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:12px;backdrop-filter:blur(12px);overflow:hidden}
.addr-row{display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-bottom:1px solid rgba(0,0,0,0.05);gap:16px}
.addr-row:last-child{border-bottom:none}
.addr-name{font-size:13px;font-weight:600;color:#18160f;flex-shrink:0}
.addr-mono{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:opacity .13s}
.addr-mono:hover{opacity:.72}

/* SKELETON */
.skel{display:inline-block;height:14px;border-radius:4px;background:linear-gradient(90deg,#edeae4 25%,#e0dcd5 50%,#edeae4 75%);background-size:200% 100%;animation:skel 1.4s linear infinite;vertical-align:middle}
@keyframes skel{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* RESPONSIVE */
@media(max-width:640px){
  .nav{grid-template-columns:1fr auto;gap:8px;padding:0 16px}
  .nav-links{display:none}
  .page-header-inner{padding:28px 16px 20px}
  .status-strip{padding:12px 16px}
  .ss-item{padding:0 10px}
  .page-body{padding:24px 16px 64px;gap:28px}
  .nav-grid{grid-template-columns:1fr}
  .nc-grid{grid-template-columns:repeat(2,1fr)}
  .addr-row{flex-direction:column;align-items:flex-start}
}
@media(min-width:641px) and (max-width:900px){
  .nav-links{gap:0}
  .nav-link{padding:5px 9px;font-size:12.5px}
  .nav-grid{grid-template-columns:repeat(2,1fr)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;