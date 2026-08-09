"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContracts, useReadContract } from "wagmi";
import { formatUnits } from "viem";

import { CONTRACT_ADDRESSES } from "@/constants/contracts";

// ---------------------------------------------------------------------------
// ABI SLICES
// ---------------------------------------------------------------------------
const YIELD_ABI = [
  {
    name: "getCurrentEpochId",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "getEpoch",
    type: "function", stateMutability: "view",
    inputs: [{ name: "epochId", type: "uint64" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "epochId",      type: "uint64"  },
        { name: "status",       type: "uint8"   },
        { name: "startTime",    type: "uint40"  },
        { name: "endTime",      type: "uint40"  },
        { name: "merkleRoot",   type: "bytes32" },
        { name: "totalYield",   type: "uint256" },
        { name: "claimedYield", type: "uint256" },
      ],
    }],
  },
  {
    name: "hasClaimed",
    type: "function", stateMutability: "view",
    inputs: [
      { name: "epochId",  type: "uint64"  },
      { name: "investor", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getNextEpochTime",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getYieldToken",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "checkUpkeep",
    type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "bytes" }],
    outputs: [
      { name: "upkeepNeeded", type: "bool"  },
      { name: "performData",  type: "bytes" },
    ],
  },
  {
    name: "paused",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "symbol",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function", stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
type EpochData = {
  epochId:      bigint;
  status:       number;
  startTime:    number;
  endTime:      number;
  merkleRoot:   `0x${string}`;
  totalYield:   bigint;
  claimedYield: bigint;
};

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
// How many past epochs to show (current + prev N)
const HISTORY_DEPTH = 5;

const EPOCH_STATUS: Record<number, { label: string; color: string; bg: string; border: string }> = {
  0: { label: "None",      color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb" },
  1: { label: "Active",    color: "#f97316", bg: "#fff7ed", border: "#fed7aa" },
  2: { label: "Finalized", color: "#6366f1", bg: "#eef2ff", border: "#c7d2fe" },
  3: { label: "Closed",    color: "#9ca3af", bg: "#f9fafb", border: "#e5e7eb" },
};

// ---------------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------------
function fmtAddr(a: string)  { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function fmtAddrLong(a: string) { return `${a.slice(0, 10)}…${a.slice(-6)}`; }

function fmtAmount(raw: bigint, dec = 6) {
  const n = Number(formatUnits(raw, dec));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDateTime(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function countdown(target: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = target - now;
  if (diff <= 0) return "Due now";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function claimPct(total: bigint, claimed: bigint): number {
  if (!total || total === BigInt(0)) return 0;
  return Math.min(Number((claimed * BigInt(10000)) / total) / 100, 100);
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
// 1. Skel component ki definition (is se replace karo):
function Skel({ w = 80, h = 14 }: { w?: number | string; h?: number | string }) {
  return (
    <span
      className="skel"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
      }}
    />
  );
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
            className={`nav-link${l === "Yield" ? " active" : ""}`}>
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
// EPOCH STATUS BADGE
// ---------------------------------------------------------------------------
function EpochBadge({ status }: { status: number }) {
  const s = EPOCH_STATUS[status] ?? EPOCH_STATUS[0];
  return (
    <span className="epoch-badge" style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {status === 1 && <i className="live-dot" style={{ background: s.color }} />}
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CLAIM PROGRESS BAR
// ---------------------------------------------------------------------------
function ClaimBar({ total, claimed, decimals, symbol }: {
  total: bigint; claimed: bigint; decimals: number; symbol: string;
}) {
  const pct = claimPct(total, claimed);
  const color = pct > 80 ? "#4ade80" : pct > 40 ? "#6366f1" : "#f97316";
  const unclaimed = total - claimed;

  return (
    <div className="claim-bar-wrap">
      <div className="claim-bar-header">
        <span className="claim-bar-label">Claim progress</span>
        <span className="claim-bar-pct">{pct.toFixed(1)}%</span>
      </div>
      <div className="claim-bar-track">
        <div className="claim-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="claim-bar-nums">
        <span>{fmtAmount(claimed, decimals)} {symbol} claimed</span>
        <span>{fmtAmount(unclaimed > BigInt(0) ? unclaimed : BigInt(0), decimals)} {symbol} remaining</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EPOCH CARD
// ---------------------------------------------------------------------------
function EpochCard({ epochId, address, decimals, symbol }: {
  epochId: bigint;
  address?: `0x${string}`;
  decimals: number;
  symbol: string;
}) {
  const calls = useMemo(() => {
    const base = [
      {
        address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
        abi: YIELD_ABI, functionName: "getEpoch" as const,
        args: [epochId] as [bigint],
      },
    ];
    if (address) {
      base.push({
        address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
        abi: YIELD_ABI, functionName: "hasClaimed" as const,
        args: [epochId, address] as any,
      } as any);
    }
    return base;
  }, [epochId, address]);

  const { data, isLoading } = useReadContracts({ contracts: calls });

  const epoch    = data?.[0]?.result as EpochData | undefined;
  const claimed  = address ? (data?.[1]?.result as boolean | undefined) : undefined;

  const st         = EPOCH_STATUS[epoch?.status ?? 0] ?? EPOCH_STATUS[0];
  const isActive   = epoch?.status === 1;
  const isFinalized= epoch?.status === 2;
  const pct        = epoch ? claimPct(epoch.totalYield, epoch.claimedYield) : 0;
  const hasRoot    = epoch?.merkleRoot && epoch.merkleRoot !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  return (
    <article className={`epoch-card${isActive ? " epoch-card-active" : ""}${epoch?.status === 2 ? " epoch-card-finalized" : ""}`}>
      {/* head */}
      <div className="ec-head">
        <div className="ec-id-group">
          <span className="ec-epoch-num">Epoch #{epochId.toString()}</span>
          {isLoading ? <Skel w={64} h={20} /> : <EpochBadge status={epoch?.status ?? 0} />}
        </div>
        {address && claimed !== undefined && (
          <span className={`claimed-pill${claimed ? " ok" : isFinalized ? " pending" : " na"}`}>
            {claimed ? "Claimed" : isFinalized ? "Claimable" : "—"}
          </span>
        )}
      </div>

      {/* yield numbers */}
      <div className="ec-amounts">
        <div className="ec-amount-cell">
          <span className="ec-amount-label">Total yield</span>
          <span className="ec-amount-val">
            {isLoading ? <Skel w={90} h={24} /> : epoch?.totalYield
              ? <>{fmtAmount(epoch.totalYield, decimals)} <span className="ec-sym">{symbol}</span></>
              : "—"}
          </span>
        </div>
        <div className="ec-amount-cell">
          <span className="ec-amount-label">Claimed</span>
          <span className="ec-amount-val">
            {isLoading ? <Skel w={70} h={24} /> : epoch?.claimedYield
              ? <>{fmtAmount(epoch.claimedYield, decimals)} <span className="ec-sym">{symbol}</span></>
              : epoch?.totalYield ? "0 " + symbol : "—"}
          </span>
        </div>
      </div>

      {/* claim bar — only when finalized + has yield */}
      {isFinalized && epoch && epoch.totalYield > BigInt(0) && (
        <ClaimBar
          total={epoch.totalYield}
          claimed={epoch.claimedYield}
          decimals={decimals}
          symbol={symbol}
        />
      )}

      {/* meta table */}
      <dl className="ec-meta">
        <div className="ec-meta-row">
          <dt>Start</dt>
          <dd>{isLoading ? <Skel w={100} /> : epoch?.startTime ? fmtDateTime(epoch.startTime) : "—"}</dd>
        </div>
        <div className="ec-meta-row">
          <dt>End</dt>
          <dd>{isLoading ? <Skel w={100} /> : epoch?.endTime ? fmtDateTime(epoch.endTime) : "—"}</dd>
        </div>
        <div className="ec-meta-row">
          <dt>Merkle root</dt>
          <dd>
            {isLoading ? <Skel w={100} /> : hasRoot
              ? <span className="mono-hash" title={epoch?.merkleRoot}>
                  {epoch!.merkleRoot.slice(0, 10)}…{epoch!.merkleRoot.slice(-8)}
                </span>
              : <span className="muted-text">Not set</span>}
          </dd>
        </div>
      </dl>

      {/* active-epoch note */}
      {isActive && (
        <div className="ec-active-note">
          <IconInfo />
          Epoch is open. Yield can be deposited. Claims open once the distributor finalizes and uploads the Merkle root.
        </div>
      )}

      {/* claimable note */}
      {isFinalized && address && claimed === false && (
        <div className="ec-claimable-note">
          <IconCheck />
          You may be eligible to claim from this epoch. Submit your Merkle proof via the claim interface.
        </div>
      )}

      {isLoading && <div className="card-shimmer" />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// CURRENT EPOCH HERO — big card for epoch N
// ---------------------------------------------------------------------------
function CurrentEpochHero({ epochId, nextEpochTime, upkeepNeeded, paused, decimals, symbol, now }: {
  epochId: bigint;
  nextEpochTime: number;
  upkeepNeeded: boolean | undefined;
  paused: boolean | undefined;
  decimals: number;
  symbol: string;
  now: number;
}) {
  const { data, isLoading } = useReadContracts({
    contracts: [{
      address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
      abi: YIELD_ABI, functionName: "getEpoch" as const,
      args: [epochId],
    }],
  });
  const epoch = data?.[0]?.result as EpochData | undefined;

  const timeLeft     = nextEpochTime ? countdown(nextEpochTime) : "—";
  const timeLeftPct  = nextEpochTime && epoch?.startTime
    ? Math.max(0, Math.min(1, (now - epoch.startTime) / (nextEpochTime - epoch.startTime)))
    : 0;
  const progressColor = timeLeftPct > 0.85 ? "#f87171" : timeLeftPct > 0.6 ? "#fbbf24" : "#4ade80";

  return (
    <div className="hero-epoch">
      {paused && (
        <div className="alert-err" role="alert">
          <IconPause />
          Yield distributor is paused. Deposits and claims are suspended.
        </div>
      )}

      <div className="he-top">
        <div className="he-left">
          <p className="he-eyebrow">Current epoch</p>
          <p className="he-id">#{epochId.toString()}</p>
          {isLoading ? <Skel w={80} h={22} /> : <EpochBadge status={epoch?.status ?? 0} />}
        </div>
        <div className="he-right">
          <div className="he-countdown-group">
            <span className="he-countdown-label">Next epoch</span>
            <span className="he-countdown-val">{timeLeft}</span>
          </div>
          {upkeepNeeded && (
            <span className="upkeep-badge">
              <i className="live-dot" style={{ background: "#6366f1" }} />
              Upkeep ready
            </span>
          )}
        </div>
      </div>

      {/* epoch timeline bar */}
      <div className="he-timeline">
        <div className="he-tl-bar">
          <div className="he-tl-fill" style={{ width: `${timeLeftPct * 100}%`, background: progressColor }} />
        </div>
        <div className="he-tl-labels">
          <span>{epoch?.startTime ? fmtDate(epoch.startTime) : "—"}</span>
          <span>{nextEpochTime ? fmtDate(nextEpochTime) : "—"}</span>
        </div>
      </div>

      {/* stat grid */}
      <div className="he-stats">
        {[
          { label: "Total yield",   val: epoch?.totalYield   ? `${fmtAmount(epoch.totalYield,   decimals)} ${symbol}` : "—" },
          { label: "Claimed so far",val: epoch?.claimedYield ? `${fmtAmount(epoch.claimedYield, decimals)} ${symbol}` : "—" },
          { label: "Merkle root",   val: epoch?.merkleRoot && epoch.merkleRoot !== "0x" + "0".repeat(64)
            ? `${epoch.merkleRoot.slice(0, 8)}…${epoch.merkleRoot.slice(-6)}`
            : "Not set" },
          { label: "Epoch ends",    val: nextEpochTime ? fmtDateTime(nextEpochTime) : "—" },
        ].map(({ label, val }) => (
          <div key={label} className="he-stat">
            <span className="he-stat-label">{label}</span>
            <span className="he-stat-val">{isLoading ? <Skel w={80} /> : val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MY CLAIM PANEL — connected wallet
// ---------------------------------------------------------------------------
function MyClaimPanel({ address, currentEpochId, decimals, symbol }: {
  address: `0x${string}`;
  currentEpochId: bigint;
  decimals: number;
  symbol: string;
}) {
  // Check claim status for current and previous 2 epochs
  const epochIds = useMemo(() => {
    const ids: bigint[] = [];
   for (let i = currentEpochId; i >= BigInt(1) && currentEpochId - i < BigInt(3); i = i - BigInt(1)) {
      ids.push(i);
    }
    return ids;
  }, [currentEpochId]);

  const calls = useMemo(() =>
    epochIds.flatMap((id) => [
      {
        address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
        abi: YIELD_ABI, functionName: "hasClaimed" as const,
        args: [id, address] as [bigint, `0x${string}`],
      },
      {
        address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
        abi: YIELD_ABI, functionName: "getEpoch" as const,
        args: [id] as [bigint],
      },
    ])
  , [epochIds, address]);

  const { data, isLoading } = useReadContracts({ contracts: calls });

  const rows = epochIds.map((id, i) => {
    const hasClaimed = data?.[i * 2]?.result as boolean | undefined;
    const epoch      = data?.[i * 2 + 1]?.result as EpochData | undefined;
    return { id, hasClaimed, epoch };
  });

  const claimableEpochs = rows.filter(r =>
    r.epoch?.status === 2 && r.hasClaimed === false
  );

  return (
    <div className="my-claim-panel">
      <div className="mcp-head">
        <div className="mcp-avatar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </div>
        <div>
          <p className="mcp-addr">{fmtAddrLong(address)}</p>
          <p className="mcp-sub">Yield claim status · last 3 epochs</p>
        </div>
        {claimableEpochs.length > 0 && (
          <span className="mcp-alert">{claimableEpochs.length} claimable</span>
        )}
      </div>

      <div className="mcp-rows">
        {rows.map(({ id, hasClaimed, epoch }) => {
          const st = EPOCH_STATUS[epoch?.status ?? 0] ?? EPOCH_STATUS[0];
          const isClaimable = epoch?.status === 2 && hasClaimed === false;
          return (
            <div key={id.toString()} className="mcp-row">
              <span className="mcp-epoch-id">#{id.toString()}</span>
              <EpochBadge status={epoch?.status ?? 0} />
              {isLoading ? <Skel w={80} /> : epoch?.totalYield
                ? <span className="mcp-yield">{fmtAmount(epoch.totalYield, decimals)} {symbol}</span>
                : <span className="mcp-yield muted">—</span>}
              {isLoading ? <Skel w={80} /> : hasClaimed === undefined ? <Skel w={80} /> : (
                <span className={`mcp-status${hasClaimed ? " claimed" : isClaimable ? " claimable" : ""}`}>
                  {hasClaimed ? "✓ Claimed" : isClaimable ? "Claimable" : epoch?.status === 1 ? "Pending" : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {claimableEpochs.length > 0 && (
        <div className="mcp-cta">
          <div>
            <p className="mcp-cta-title">{claimableEpochs.length} epoch{claimableEpochs.length > 1 ? "s" : ""} available to claim</p>
            <p className="mcp-cta-body">Submit your Merkle proof for each finalized epoch to pull yield directly to your wallet.</p>
          </div>
          <div className="mcp-cta-chips">
            {claimableEpochs.map(({ id }) => (
              <span key={id.toString()} className="mcp-cta-chip">#{id.toString()}</span>
            ))}
          </div>
        </div>
      )}

      {!isLoading && claimableEpochs.length === 0 && (
        <p className="mcp-empty">No unclaimed yield found in the last 3 epochs.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROTOCOL STATUS STRIP
// ---------------------------------------------------------------------------
function StatusStrip({ epochId, nextEpochTime, upkeepNeeded, symbol, paused }: {
  epochId: bigint | undefined;
  nextEpochTime: number | undefined;
  upkeepNeeded: boolean | undefined;
  symbol: string;
  paused: boolean | undefined;
}) {
  return (
    <div className="status-strip">
      {[
        { label: "Status",       val: paused ? <span style={{color:"#f87171"}}>Paused</span> : <span style={{color:"#4ade80"}}>Active</span> },
        { label: "Network",      val: <><i className="base-dot" />Base Mainnet</> },
        { label: "Current epoch",val: epochId !== undefined ? `#${epochId.toString()}` : <Skel w={32} /> },
        { label: "Yield token",  val: symbol || <Skel w={40} /> },
        { label: "Next epoch",   val: nextEpochTime ? countdown(nextEpochTime) : <Skel w={56} /> },
        { label: "Automation",   val: upkeepNeeded ? <span style={{color:"#6366f1"}}>Upkeep ready</span> : "Waiting" },
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
// HOW IT WORKS
// ---------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    {
      n: "01", title: "Epoch opens",
      desc: "Chainlink Automation calls performUpkeep() on schedule, opening a new yield distribution cycle. The current epoch's ID increments and the active window begins.",
    },
    {
      n: "02", title: "Yield deposited",
      desc: "The treasury (distributor role) transfers real-world yield — USDC, USDT, or the configured token — into the contract via depositYield(). Funds accumulate in the active epoch.",
    },
    {
      n: "03", title: "Epoch finalized",
      desc: "The distributor uploads a Merkle root committing to every investor's exact allocation. Status moves to FINALIZED. Claims open. totalYield is locked.",
    },
    {
      n: "04", title: "Investors claim",
      desc: "Each eligible investor calls claimYield() with their allocation amount and a Merkle proof generated off-chain. The contract verifies the proof and transfers yield directly to the wallet.",
    },
    {
      n: "05", title: "Epoch closed",
      desc: "The distributor calls closeEpoch() after the claim window. Any unclaimed yield is swept back to the treasury. Status moves to CLOSED. The cycle resets.",
    },
  ];

  return (
    <div className="how-panel">
      <div className="how-header">
        <p className="how-title">How Merkle yield works</p>
        <p className="how-sub">Pull-payment distribution. One Merkle root. O(log N) gas per claim. No centralized payout, no batch transactions.</p>
      </div>
      <div className="how-steps">
        {steps.map(({ n, title, desc }, i) => (
          <div key={n} className="how-step">
            <div className="how-step-line">
              <div className="how-n">{n}</div>
              {i < steps.length - 1 && <div className="how-connector" />}
            </div>
            <div className="how-step-body">
              <p className="how-step-title">{title}</p>
              <p className="how-step-desc">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ICONS
// ---------------------------------------------------------------------------
function IconExternal() { return <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden><path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconInfo()     { return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 6v4M6.5 4h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>; }
function IconCheck()    { return <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 6.5l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconPause()    { return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden><rect x="3" y="2.5" width="4" height="13" rx="1" fill="#f87171"/><rect x="11" y="2.5" width="4" height="13" rx="1" fill="#f87171"/></svg>; }

// ---------------------------------------------------------------------------
// ROOT PAGE
// ---------------------------------------------------------------------------
export default function YieldPage() {
  const { address } = useAccount();
  const [entered, setEntered] = useState(false);
  const now = useClock();

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Global reads
  const globalCalls = useMemo(() => [
    { address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`, abi: YIELD_ABI, functionName: "getCurrentEpochId" as const, args: [] },
    { address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`, abi: YIELD_ABI, functionName: "getNextEpochTime"   as const, args: [] },
    { address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`, abi: YIELD_ABI, functionName: "getYieldToken"      as const, args: [] },
    { address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`, abi: YIELD_ABI, functionName: "paused"             as const, args: [] },
    {
      address: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR as `0x${string}`,
      abi: YIELD_ABI, functionName: "checkUpkeep" as const,
      args: ["0x" as `0x${string}`],
    },
  ], []);

  const { data: globalData, isLoading: globalLoading } = useReadContracts({ contracts: globalCalls });

  const currentEpochId  = globalData?.[0]?.result as bigint | undefined;
  const nextEpochTime   = globalData?.[1]?.result as bigint | undefined;
  const yieldToken      = globalData?.[2]?.result as `0x${string}` | undefined;
  const paused          = globalData?.[3]?.result as boolean | undefined;
  const upkeepResult    = globalData?.[4]?.result as [boolean, `0x${string}`] | undefined;
  const upkeepNeeded    = upkeepResult?.[0];

  // Yield token metadata
  const tokenCalls = useMemo(() => {
    if (!yieldToken) return [];
    return [
      { address: yieldToken, abi: ERC20_ABI, functionName: "symbol"   as const, args: [] },
      { address: yieldToken, abi: ERC20_ABI, functionName: "decimals" as const, args: [] },
    ];
  }, [yieldToken]);

  const { data: tokenData } = useReadContracts({ contracts: tokenCalls });
  const tokenSymbol   = (tokenData?.[0]?.result as string  | undefined) ?? "USDC";
  const tokenDecimals = (tokenData?.[1]?.result as number  | undefined) ?? 6;

  // Historical epochs to display
  const epochIds = useMemo(() => {
    if (!currentEpochId) return [];
    const ids: bigint[] = [];
   for (let i = currentEpochId; i >= BigInt(1) && currentEpochId - i < BigInt(HISTORY_DEPTH); i = i - BigInt(1)) {
      ids.push(i);
    }
    return ids;
  }, [currentEpochId]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{CSS}</style>
      <Nav />

      <main className={`main${entered ? " in" : ""}`}>
        {/* Page header */}
        <div className="page-header">
          <div className="page-header-inner">
            <p className="page-tag">Chainlink Automation · Merkle</p>
            <h1 className="page-h1">Yield Distributor</h1>
            <p className="page-sub">
              Pull-payment yield distribution using Merkle trees. Chainlink Automation advances
              epochs on schedule. Investors claim directly — no batched payouts, no operator calls.
            </p>
          </div>
          <StatusStrip
            epochId={currentEpochId}
            nextEpochTime={nextEpochTime ? Number(nextEpochTime) : undefined}
            upkeepNeeded={upkeepNeeded}
            symbol={tokenSymbol}
            paused={paused}
          />
        </div>

        <div className="page-body">
          {/* Current epoch hero */}
          {currentEpochId !== undefined ? (
            <section className="section">
              <div className="section-head">
                <h2 className="section-label">Current epoch</h2>
                {upkeepNeeded && <span className="upkeep-badge"><i className="live-dot" style={{ background: "#6366f1" }} />Chainlink upkeep ready</span>}
              </div>
              <CurrentEpochHero
                epochId={currentEpochId}
                nextEpochTime={nextEpochTime ? Number(nextEpochTime) : 0}
                upkeepNeeded={upkeepNeeded}
                paused={paused}
                decimals={tokenDecimals}
                symbol={tokenSymbol}
                now={now}
              />
            </section>
          ) : globalLoading ? (
            <section className="section">
              <Skel w="100%" h={220} />
            </section>
          ) : null}

          {/* My claim panel */}
          {address && currentEpochId !== undefined ? (
            <section className="section">
              <div className="section-head">
                <h2 className="section-label">Your claim status</h2>
              </div>
              <MyClaimPanel
                address={address as `0x${string}`}
                currentEpochId={currentEpochId}
                decimals={tokenDecimals}
                symbol={tokenSymbol}
              />
            </section>
          ) : !address ? (
            <div className="connect-nudge">
              <div className="cn-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <div>
                <p className="cn-title">Connect to check your yield</p>
                <p className="cn-body">Link your wallet to see claim eligibility across past epochs and track unclaimed yield.</p>
              </div>
              <ConnectButton.Custom>
                {({ openConnectModal }) => (
                  <button className="btn-dark-sm" onClick={openConnectModal}>Connect wallet</button>
                )}
              </ConnectButton.Custom>
            </div>
          ) : null}

          {/* Epoch history */}
          {epochIds.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-label">Epoch history</h2>
                <span className="count-pill">Last {epochIds.length}</span>
              </div>
              <div className="epoch-grid">
                {epochIds.map((id) => (
                  <EpochCard
                    key={id.toString()}
                    epochId={id}
                    address={address as `0x${string}` | undefined}
                    decimals={tokenDecimals}
                    symbol={tokenSymbol}
                  />
                ))}
              </div>
            </section>
          )}

          {/* How it works */}
          <section className="section">
            <h2 className="section-label">How it works</h2>
            <HowItWorks />
          </section>

          {/* Contracts */}
          <section className="section">
            <h2 className="section-label">Contract addresses</h2>
            <div className="addr-table">
              {[
                { name: "Yield Distributor", addr: CONTRACT_ADDRESSES.YIELD_DISTRIBUTOR },
                { name: "Yield Token (USDC)", addr: yieldToken ?? CONTRACT_ADDRESSES.USDC },
                { name: "Asset Registry",    addr: CONTRACT_ADDRESSES.ASSET_REGISTRY    },
              ].map(({ name, addr }) => (
                <div className="addr-row" key={name}>
                  <span className="addr-name">{name}</span>
                  <a href={`https://basescan.org/address/${addr}`}
                     target="_blank" rel="noopener noreferrer" className="addr-mono">
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
.page-sub{font-size:14.5px;line-height:1.72;color:#7c7363;max-width:560px}

/* STATUS STRIP */
.status-strip{max-width:1100px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;border-top:1px solid rgba(0,0,0,0.06);overflow-x:auto;scrollbar-width:none;gap:0}
.status-strip::-webkit-scrollbar{display:none}
.ss-group{display:flex;align-items:center;flex-shrink:0}
.ss-item{display:flex;flex-direction:column;gap:2px;padding:0 18px}
.ss-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.ss-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#18160f;display:flex;align-items:center;gap:5px}
.base-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#0052ff;flex-shrink:0}
.ss-div{width:1px;height:26px;background:rgba(0,0,0,0.08);flex-shrink:0}
.live-dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0;animation:blink 2s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.upkeep-badge{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:99px;background:#eef2ff;border:1px solid #c7d2fe;color:#4338ca}
.count-pill{padding:2px 8px;border-radius:99px;background:#fff7ed;border:1px solid #fed7aa;font-size:10px;font-weight:700;color:#c2410c;letter-spacing:.06em}

/* PAGE BODY */
.page-body{max-width:1100px;margin:0 auto;padding:32px 28px 80px;display:flex;flex-direction:column;gap:36px}

/* SECTION */
.section{display:flex;flex-direction:column;gap:14px}
.section-head{display:flex;align-items:center;gap:10px}
.section-label{font-family:'Syne',sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7c7363}

/* ALERTS */
.alert-err{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;font-size:13.5px;color:#991b1b;font-weight:500;line-height:1.5}
.alert-err svg{flex-shrink:0;margin-top:2px}

/* EPOCH BADGE */
.epoch-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;letter-spacing:.05em;text-transform:uppercase}

/* CURRENT EPOCH HERO */
.hero-epoch{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 8px 24px rgba(0,0,0,0.05);padding:24px;display:flex;flex-direction:column;gap:20px}
.he-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.he-left{display:flex;flex-direction:column;gap:8px}
.he-eyebrow{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#a09890}
.he-id{font-family:'Syne',sans-serif;font-size:40px;font-weight:800;letter-spacing:-0.04em;color:#18160f;line-height:1}
.he-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.he-countdown-group{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.he-countdown-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.he-countdown-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#18160f;letter-spacing:-0.02em}

/* timeline */
.he-timeline{display:flex;flex-direction:column;gap:6px}
.he-tl-bar{height:5px;border-radius:3px;background:rgba(0,0,0,0.07);overflow:hidden}
.he-tl-fill{height:100%;border-radius:3px;transition:width .6s cubic-bezier(.16,1,.3,1),background .4s}
.he-tl-labels{display:flex;justify-content:space-between;font-size:11px;color:#a09890}

/* stats */
.he-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.he-stat{display:flex;flex-direction:column;gap:4px;padding:13px 14px;background:#faf9f6}
.he-stat-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.he-stat-val{font-size:13.5px;font-weight:600;color:#18160f;font-variant-numeric:tabular-nums}

/* EPOCH GRID */
.epoch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}

/* EPOCH CARD */
.epoch-card{position:relative;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.04);padding:18px;display:flex;flex-direction:column;gap:14px;overflow:hidden;transition:transform .2s,box-shadow .2s}
.epoch-card:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(0,0,0,0.05),0 12px 28px rgba(0,0,0,0.08)}
.epoch-card-active{border-color:rgba(249,115,22,0.25);background:rgba(255,251,247,0.8)}
.epoch-card-finalized{border-color:rgba(99,102,241,0.2)}
.card-shimmer{position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#f97316 0%,#fbbf24 50%,#f97316 100%);background-size:200% 100%;animation:shimmer 1.6s linear infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ec-id-group{display:flex;align-items:center;gap:8px}
.ec-epoch-num{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;color:#18160f}
.claimed-pill{font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px;border:1px solid;letter-spacing:.05em;text-transform:uppercase}
.claimed-pill.ok{background:#f0fdf4;color:#16a34a;border-color:#bbf7d0}
.claimed-pill.pending{background:#eef2ff;color:#4338ca;border-color:#c7d2fe}
.claimed-pill.na{background:#f9fafb;color:#9ca3af;border-color:#e5e7eb}
.ec-amounts{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.ec-amount-cell{display:flex;flex-direction:column;gap:4px;padding:11px 13px;background:#faf9f6}
.ec-amount-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.ec-amount-val{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:#18160f;display:flex;align-items:baseline;gap:4px}
.ec-sym{font-size:11px;font-weight:600;color:#a09890}
.claim-bar-wrap{display:flex;flex-direction:column;gap:5px}
.claim-bar-header{display:flex;justify-content:space-between;align-items:center}
.claim-bar-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#a09890}
.claim-bar-pct{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#18160f}
.claim-bar-track{height:4px;border-radius:2px;background:rgba(0,0,0,0.07);overflow:hidden}
.claim-bar-fill{height:100%;border-radius:2px;transition:width .6s cubic-bezier(.16,1,.3,1)}
.claim-bar-nums{display:flex;justify-content:space-between;font-size:11px;color:#a09890}
.ec-meta{display:flex;flex-direction:column;border:1px solid rgba(0,0,0,0.05);border-radius:9px;overflow:hidden}
.ec-meta-row{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;font-size:12px;border-bottom:1px solid rgba(0,0,0,0.04)}
.ec-meta-row:last-child{border-bottom:none}
.ec-meta-row dt{color:#7c7363;font-weight:400}
.ec-meta-row dd{font-weight:500;color:#18160f;text-align:right}
.mono-hash{font-family:'Inter',monospace;font-size:11.5px;color:#5a5245}
.muted-text{color:#a09890}
.ec-active-note{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:12px;color:#92400e;line-height:1.5}
.ec-active-note svg{flex-shrink:0;margin-top:1px}
.ec-claimable-note{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12px;color:#166534;line-height:1.5}
.ec-claimable-note svg{flex-shrink:0;margin-top:1px}

/* MY CLAIM PANEL */
.my-claim-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:22px;display:flex;flex-direction:column;gap:16px}
.mcp-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.mcp-avatar{width:40px;height:40px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;display:grid;place-items:center;color:#f97316;flex-shrink:0}
.mcp-avatar svg{width:19px;height:19px}
.mcp-addr{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f}
.mcp-sub{font-size:12px;color:#a09890;margin-top:1px}
.mcp-alert{margin-left:auto;padding:4px 10px;border-radius:99px;background:#eef2ff;border:1px solid #c7d2fe;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4338ca}
.mcp-rows{display:flex;flex-direction:column;border:1px solid rgba(0,0,0,0.06);border-radius:10px;overflow:hidden}
.mcp-row{display:grid;grid-template-columns:auto 1fr 1fr 1fr;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid rgba(0,0,0,0.04);font-size:13px}
.mcp-row:last-child{border-bottom:none}
.mcp-epoch-id{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#a09890}
.mcp-yield{font-weight:600;color:#18160f}
.mcp-yield.muted{color:#a09890}
.mcp-status{font-size:12px;font-weight:600;color:#a09890;text-align:right}
.mcp-status.claimed{color:#16a34a}
.mcp-status.claimable{color:#4338ca}
.mcp-cta{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:14px 16px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;flex-wrap:wrap}
.mcp-cta-title{font-family:'Syne',sans-serif;font-size:13.5px;font-weight:700;color:#3730a3;margin-bottom:4px}
.mcp-cta-body{font-size:13px;line-height:1.65;color:#4338ca}
.mcp-cta-chips{display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap}
.mcp-cta-chip{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;padding:4px 10px;border-radius:6px;background:#fff;border:1px solid #c7d2fe;color:#4338ca}
.mcp-empty{font-size:13.5px;color:#a09890;text-align:center;padding:16px 0}

/* HOW IT WORKS */
.how-panel{background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 2px rgba(0,0,0,0.04),0 6px 20px rgba(0,0,0,0.04);padding:24px;display:flex;flex-direction:column;gap:20px}
.how-header{}
.how-title{font-family:'Syne',sans-serif;font-size:14.5px;font-weight:700;color:#18160f;margin-bottom:6px}
.how-sub{font-size:13.5px;line-height:1.68;color:#7c7363}
.how-steps{display:flex;flex-direction:column;gap:0}
.how-step{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:stretch}
.how-step-line{display:flex;flex-direction:column;align-items:center;padding-top:2px}
.how-n{width:28px;height:28px;border-radius:50%;background:#f97316;color:#fff;font-family:'Syne',sans-serif;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.how-connector{flex:1;width:1px;background:rgba(0,0,0,0.08);margin:4px 0;min-height:20px}
.how-step-body{padding:0 0 22px}
.how-step:last-child .how-step-body{padding-bottom:0}
.how-step-title{font-size:14px;font-weight:600;color:#18160f;margin-bottom:5px}
.how-step-desc{font-size:13px;line-height:1.68;color:#7c7363}

/* CONNECT NUDGE */
.connect-nudge{display:flex;align-items:center;gap:18px;padding:22px;background:rgba(255,255,255,0.72);border:1px solid rgba(255,255,255,0.9);border-radius:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.cn-icon{color:#f97316;flex-shrink:0;width:28px;height:28px}
.cn-icon svg{width:100%;height:100%}
.cn-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#18160f;margin-bottom:4px}
.cn-body{font-size:13.5px;line-height:1.68;color:#7c7363}
.btn-dark-sm{margin-left:auto;padding:9px 18px;border-radius:8px;background:#18160f;color:#fff;font-size:13px;font-weight:600;border:none;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;transition:background .15s,transform .15s;flex-shrink:0}
.btn-dark-sm:hover{background:#2e2a1e;transform:translateY(-1px)}

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

/* MISC */
.mono-link{font-family:'Inter',monospace;font-size:11.5px;color:#f97316;text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:opacity .13s}
.mono-link:hover{opacity:.72}

/* RESPONSIVE */
@media(max-width:640px){
  .nav{grid-template-columns:1fr auto;gap:8px;padding:0 16px}
  .nav-links{display:none}
  .page-header-inner{padding:28px 16px 20px}
  .status-strip{padding:12px 16px}
  .ss-item{padding:0 10px}
  .page-body{padding:24px 16px 64px;gap:28px}
  .he-stats{grid-template-columns:repeat(2,1fr)}
  .epoch-grid{grid-template-columns:1fr}
  .mcp-row{grid-template-columns:auto 1fr 1fr;gap:8px}
  .mcp-row>:nth-child(4){display:none}
  .connect-nudge{flex-direction:column;align-items:flex-start;gap:12px}
  .btn-dark-sm{margin-left:0}
  .addr-row{flex-direction:column;align-items:flex-start;gap:4px}
  .he-top{gap:12px}
  .mcp-cta{flex-direction:column}
}
@media(min-width:641px) and (max-width:900px){
  .nav-links{gap:0}
  .nav-link{padding:5px 9px;font-size:12.5px}
  .epoch-grid{grid-template-columns:repeat(2,1fr)}
  .he-stats{grid-template-columns:repeat(2,1fr)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;
