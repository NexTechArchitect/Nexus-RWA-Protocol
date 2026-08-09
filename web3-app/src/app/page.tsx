"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

function BgCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, raf = 0, t = 0;

    const resize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const BLOBS = [
      { xr: 0.08, yr: 0.18, r: 180, c: "#fde68a" },
      { xr: 0.92, yr: 0.12, r: 160, c: "#fbcfe8" },
      { xr: 0.80, yr: 0.78, r: 200, c: "#a5f3fc" },
      { xr: 0.18, yr: 0.82, r: 160, c: "#c4b5fd" },
      { xr: 0.50, yr: 0.45, r: 140, c: "#bbf7d0" },
    ];

    type Dot = { x: number; y: number; r: number; c: string; ph: number; sp: number };
    const DOTS: Dot[] = Array.from({ length: 28 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 2.5 + Math.random() * 4,
      c: ["#f97316","#a855f7","#22d3ee","#fb7185","#4ade80","#fbbf24"][i % 6],
      ph: Math.random() * Math.PI * 2,
      sp: 0.5 + Math.random() * 0.8,
    }));

    type Star = { x: number; y: number; r: number; ph: number; sp: number };
    const STARS: Star[] = Array.from({ length: 14 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 4 + Math.random() * 4,
      ph: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 0.6,
    }));

    function drawStar4(x: number, y: number, r: number, a: number) {
      ctx!.save();
      ctx!.globalAlpha = a;
      ctx!.fillStyle = "#f59e0b";
      ctx!.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const rad = i % 2 === 0 ? r : r * 0.38;
        const px = x + Math.cos(angle) * rad;
        const py = y + Math.sin(angle) * rad;
        i === 0 ? ctx!.moveTo(px, py) : ctx!.lineTo(px, py);
      }
      ctx!.closePath();
      ctx!.fill();
      ctx!.restore();
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      t += 0.014;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = "#f9f8f5";
      ctx!.fillRect(0, 0, W, H);
      ctx!.strokeStyle = "rgba(0,0,0,0.026)";
      ctx!.lineWidth = 1;
      const g = 56;
      for (let x = 0; x < W; x += g) { ctx!.beginPath(); ctx!.moveTo(x,0); ctx!.lineTo(x,H); ctx!.stroke(); }
      for (let y = 0; y < H; y += g) { ctx!.beginPath(); ctx!.moveTo(0,y); ctx!.lineTo(W,y); ctx!.stroke(); }
      BLOBS.forEach((b) => {
        const grd = ctx!.createRadialGradient(b.xr*W, b.yr*H, 0, b.xr*W, b.yr*H, b.r);
        grd.addColorStop(0, b.c + "55");
        grd.addColorStop(1, b.c + "00");
        ctx!.fillStyle = grd;
        ctx!.beginPath();
        ctx!.arc(b.xr*W, b.yr*H, b.r, 0, Math.PI*2);
        ctx!.fill();
      });
      DOTS.forEach((d) => {
        const floatY = Math.sin(t * d.sp + d.ph) * 0.022;
        const alpha = 0.45 + 0.3 * Math.sin(t * d.sp * 1.3 + d.ph);
        ctx!.save();
        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = d.c;
        ctx!.beginPath();
        ctx!.arc(d.x * W, (d.y + floatY) * H, d.r, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      });
      STARS.forEach((s) => {
        const alpha = 0.4 + 0.45 * Math.sin(t * s.sp * 2 + s.ph);
        drawStar4(s.x * W, s.y * H, s.r, alpha);
      });
    }

    tick();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}
      aria-hidden
    />
  );
}

/* ── NAV ── */
function Nav({ address }: { address?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  // Close menu on route change / outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("scroll", close, { passive: true });
    return () => window.removeEventListener("scroll", close);
  }, [menuOpen]);

  return (
    <>
      <header className={`nav${scrolled ? " nav-s" : ""}`}>
        {/* Brand */}
        <Link href="/" className="brand" onClick={() => setMenuOpen(false)}>
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="#fff" opacity=".95"/>
              <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="#f97316"/>
            </svg>
          </div>
          <span className="brand-name">Nexus RWA</span>
        </Link>

        {/* Desktop nav links */}
        <nav className="nav-center" aria-label="Main">
          {(["Assets","Identity","Compliance","Oracle","Yield","Docs"] as const).map((l) => (
            <Link key={l} href={`/${l.toLowerCase()}`} className="nav-link">{l}</Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="nav-end">
          {address && (
            <Link href="/assets" className="dash-btn">Dashboard</Link>
          )}
          <ConnectButton
            label="Connect"
            accountStatus="address"
            chainStatus="none"
            showBalance={false}
          />
          {/* Hamburger — mobile only */}
          <button
            className="hamburger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={`ham-line${menuOpen ? " open" : ""}`} />
            <span className={`ham-line${menuOpen ? " open" : ""}`} />
            <span className={`ham-line${menuOpen ? " open" : ""}`} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="mob-drawer" role="dialog" aria-label="Navigation menu">
          <nav className="mob-nav">
            {(["Assets","Identity","Compliance","Oracle","Yield","Docs"] as const).map((l) => (
              <Link
                key={l}
                href={`/${l.toLowerCase()}`}
                className="mob-link"
                onClick={() => setMenuOpen(false)}
              >
                {l}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}

/* ── HERO ── */
function Hero({ address }: { address?: string }) {
  const [rdy, setRdy] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRdy(true), 70);
    return () => clearTimeout(id);
  }, []);

  return (
    <section className="hero">
      <div className={`hero-inner${rdy ? " in" : ""}`}>
        <div className="live-pill">
          <i className="live-dot" aria-hidden />
          Live on Base Mainnet
        </div>

        <h1 className="hero-h1">
          Real-world assets.<br />
          <span className="h1-orange">Compliance built in.</span>
        </h1>

        <p className="hero-sub">
          On-chain identity, transfer restrictions, and automated yield
          settlement encoded into the token itself via ERC-3643.
        </p>

        <div className="hero-btns">
          {address ? (
            <Link href="/assets" className="btn-primary">Open Dashboard</Link>
          ) : (
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button className="btn-primary" onClick={openConnectModal}>
                  Connect Wallet
                </button>
              )}
            </ConnectButton.Custom>
          )}
          <a
            href="https://github.com/NexTechArchitect/Nexus-RWA-Protocol"
            target="_blank" rel="noopener noreferrer"
            className="btn-outline"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── SCROLL REVEAL ── */
function R({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setV(true); io.disconnect(); } },
      { threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{
        opacity: v ? 1 : 0,
        transform: v ? "none" : "translateY(18px)",
        transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ── FEATURES ── */
const FEATURES = [
  {
    title: "Identity-native tokens",
    body: "KYC and AML status is encoded at the contract level. Holders are verified once; every transfer checks it automatically.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    ),
  },
  {
    title: "Atomic compliance",
    body: "Sanctions, freeze status, and blacklist run inside the same transaction. Any failure reverts the whole transfer.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 6v6c0 5 3.6 8.4 8 9 4.4-.6 8-4 8-9V6l-8-3Z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    ),
  },
  {
    title: "Role-separated control",
    body: "Minting, compliance, and pause keys are split across distinct roles. No single key can compromise the protocol.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
  },
  {
    title: "Automated yield",
    body: "Chainlink Automation advances epochs and settles yield on schedule with zero manual operator calls.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
];

function Features() {
  return (
    <section className="section">
      <div className="wrap">
        <R>
          <p className="tag">Protocol</p>
          <h2 className="sec-h2">Compliance that never sleeps.</h2>
          <p className="sec-sub">Every mechanism is enforced on-chain. No off-chain gates, no manual processes.</p>
        </R>
        <div className="feat-grid">
          {FEATURES.map((f, i) => (
            <R key={f.title} delay={i * 55}>
              <div className="feat-card">
                <div className="feat-icon">{f.icon}</div>
                <h3 className="feat-title">{f.title}</h3>
                <p className="feat-body">{f.body}</p>
              </div>
            </R>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FLOW ── */
const STEPS = [
  { n: "01", label: "Verify identity",  body: "Both sender and receiver checked against on-chain credentials in a single read." },
  { n: "02", label: "Check compliance", body: "Sanctions list, freeze flag, and blacklist evaluated atomically before any balance moves." },
  { n: "03", label: "Apply rules",      body: "Supply caps, maturity windows, and jurisdiction restrictions enforced at runtime." },
  { n: "04", label: "Settle transfer",  body: "On full pass the balance moves. Every gate emits a structured event for off-chain audit." },
];

function Flow() {
  return (
    <section className="section">
      <div className="wrap">
        <R>
          <p className="tag">How it works</p>
          <h2 className="sec-h2">Four gates. Every transfer.</h2>
          <p className="sec-sub">Run in this exact order, every time. One failure reverts the entire call.</p>
        </R>
        <div className="flow-grid">
          {STEPS.map((s, i) => (
            <R key={s.n} delay={i * 55}>
              <div className="flow-card">
                <span className="flow-n">{s.n}</span>
                <h3 className="flow-label">{s.label}</h3>
                <p className="flow-body">{s.body}</p>
              </div>
            </R>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── CTA ── */
function CTA({ address }: { address?: string }) {
  return (
    <section className="section cta-s">
      <div className="wrap">
        <R>
          <div className="cta-panel">
            <div>
              <p className="tag" style={{ color: "#f97316" }}>Open source</p>
              <h2 className="cta-h2">Deploy on compliant rails.</h2>
              <p className="cta-p">Nexus RWA is live on Base Mainnet. Connect your wallet to manage assets or read the contracts on GitHub.</p>
            </div>
            <div className="cta-btns">
              {address ? (
                <Link href="/assets" className="btn-primary">Open Dashboard</Link>
              ) : (
                <ConnectButton.Custom>
                  {({ openConnectModal }) => (
                    <button className="btn-primary" onClick={openConnectModal}>Connect Wallet</button>
                  )}
                </ConnectButton.Custom>
              )}
              <a
                href="https://github.com/NexTechArchitect/Nexus-RWA-Protocol"
                target="_blank" rel="noopener noreferrer"
                className="btn-outline"
              >
                GitHub
              </a>
            </div>
          </div>
        </R>
      </div>
    </section>
  );
}

/* ── FOOTER ── */
function Footer() {
  return (
    <footer className="footer">
      <div className="foot-l">
        <span className="foot-pill">Base Mainnet</span>
        <span className="foot-copy">© 2026 Nexus RWA</span>
      </div>
      <nav className="foot-links">
        <a href="https://github.com/NexTechArchitect/Nexus-RWA-Protocol" target="_blank" rel="noopener noreferrer" className="foot-a">GitHub</a>
        <a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="foot-a">BaseScan</a>
        <Link href="/docs" className="foot-a">Docs</Link>
      </nav>
    </footer>
  );
}

/* ── STYLES ── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Inter:wght@400;500;600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  background: #f9f8f5;
  font-family: 'Inter', sans-serif;
  color: #18160f;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
::selection { background: #f97316; color: #fff; }
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: #f9f8f5; }
::-webkit-scrollbar-thumb { background: #d4d0c8; border-radius: 4px; }

/* ── NAV ── */
.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 400;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  height: 56px;
  padding: 0 24px;
  background: rgba(249,248,245,0.92);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-bottom: 1px solid rgba(0,0,0,0.07);
  transition: box-shadow .25s;
}
.nav-s { box-shadow: 0 2px 20px rgba(0,0,0,0.07); }

.brand {
  display: flex; align-items: center; gap: 9px;
  text-decoration: none; flex-shrink: 0;
}
.brand-mark {
  width: 32px; height: 32px; border-radius: 8px;
  background: linear-gradient(135deg, #f97316, #ef4444);
  display: grid; place-items: center; flex-shrink: 0;
}
.brand-name {
  font-family: 'Syne', sans-serif;
  font-size: 15px; font-weight: 700;
  color: #18160f; letter-spacing: -0.01em;
}

.nav-center {
  display: flex; align-items: center;
  justify-content: center; gap: 2px;
}
.nav-link {
  padding: 5px 12px; border-radius: 7px;
  font-size: 13px; font-weight: 500;
  color: #6b6355; text-decoration: none;
  transition: color .13s, background .13s;
  white-space: nowrap;
}
.nav-link:hover { color: #18160f; background: rgba(0,0,0,0.05); }

.nav-end {
  display: flex; align-items: center; gap: 9px; flex-shrink: 0;
}
.dash-btn {
  padding: 6px 14px; border-radius: 7px;
  font-size: 13px; font-weight: 600;
  color: #f97316; background: #fff7ed;
  border: 1px solid #fed7aa;
  text-decoration: none; white-space: nowrap;
  transition: all .14s;
}
.dash-btn:hover { background: #ffedd5; border-color: #f97316; }

/* Hamburger — hidden on desktop */
.hamburger {
  display: none;
  flex-direction: column; justify-content: center;
  align-items: center; gap: 5px;
  width: 36px; height: 36px; border-radius: 8px;
  background: transparent; border: 1px solid rgba(0,0,0,0.1);
  cursor: pointer; padding: 0; flex-shrink: 0;
}
.ham-line {
  display: block; width: 16px; height: 1.5px;
  background: #18160f; border-radius: 2px;
  transition: transform .22s, opacity .22s;
}
.ham-line.open:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
.ham-line.open:nth-child(2) { opacity: 0; transform: scaleX(0); }
.ham-line.open:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

/* Mobile drawer */
.mob-drawer {
  position: fixed; top: 52px; left: 0; right: 0; z-index: 399;
  background: rgba(249,248,245,0.98);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(0,0,0,0.08);
  padding: 8px 0 12px;
  animation: drawerIn .18s ease;
}
@keyframes drawerIn {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: none; }
}
.mob-nav {
  display: flex; flex-direction: column;
}
.mob-link {
  padding: 13px 20px;
  font-size: 15px; font-weight: 500;
  color: #3a3628; text-decoration: none;
  border-bottom: 1px solid rgba(0,0,0,0.04);
  transition: background .12s, color .12s;
}
.mob-link:last-child { border-bottom: none; }
.mob-link:hover { background: rgba(249,115,22,0.06); color: #f97316; }

/* RainbowKit */
[data-rk] button {
  font-family: 'Inter', sans-serif !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  border-radius: 8px !important;
}

/* ── HERO ── */
.hero {
  position: relative; z-index: 2;
  min-height: 100svh;
  display: flex; align-items: center; justify-content: center;
  padding: 80px 24px 64px;
  text-align: center;
}
.hero-inner {
  max-width: 700px; width: 100%;
  opacity: 0; transform: translateY(20px);
  transition: opacity .75s cubic-bezier(.16,1,.3,1), transform .75s cubic-bezier(.16,1,.3,1);
}
.hero-inner.in { opacity: 1; transform: none; }

.live-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 13px; border-radius: 99px;
  background: #fff7ed; border: 1px solid #fed7aa;
  font-size: 11px; font-weight: 600;
  color: #c2410c; letter-spacing: .08em;
  text-transform: uppercase; margin-bottom: 28px;
}
.live-dot {
  display: inline-block; width: 6px; height: 6px;
  border-radius: 50%; background: #f97316; flex-shrink: 0;
  animation: blink 2.2s ease-in-out infinite;
}

.hero-h1 {
  font-family: 'Syne', sans-serif;
  font-size: clamp(2.4rem, 6.5vw, 4.8rem);
  font-weight: 800; line-height: 1.08;
  letter-spacing: -0.03em; color: #18160f;
  margin-bottom: 20px;
}
.h1-orange { color: #f97316; display: block; }

.hero-sub {
  font-size: clamp(14px, 1.5vw, 16.5px);
  line-height: 1.72; color: #7c7363;
  max-width: 480px; margin: 0 auto 32px;
}

.hero-btns {
  display: flex; gap: 10px;
  justify-content: center; flex-wrap: wrap;
}

/* Buttons */
.btn-primary {
  display: inline-flex; align-items: center;
  padding: 12px 24px; border-radius: 10px;
  background: #18160f; color: #fff;
  font-size: 14px; font-weight: 600;
  border: none; cursor: pointer;
  text-decoration: none; font-family: 'Inter', sans-serif;
  transition: background .16s, transform .16s, box-shadow .16s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18);
}
.btn-primary:hover { background: #2e2a1e; transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.18); }

.btn-outline {
  display: inline-flex; align-items: center;
  padding: 12px 22px; border-radius: 10px;
  background: rgba(255,255,255,0.7); color: #5a5245;
  font-size: 14px; font-weight: 500;
  border: 1px solid rgba(0,0,0,0.12);
  text-decoration: none; backdrop-filter: blur(8px);
  transition: all .16s;
}
.btn-outline:hover { background: rgba(255,255,255,0.95); color: #18160f; border-color: rgba(0,0,0,0.2); transform: translateY(-1px); }

/* ── SECTIONS ── */
.section { position: relative; z-index: 2; padding: 88px 24px; }
.wrap { max-width: 1080px; margin: 0 auto; }

.tag {
  font-family: 'Syne', sans-serif;
  font-size: 11px; font-weight: 700;
  letter-spacing: .14em; text-transform: uppercase;
  color: #f97316; margin-bottom: 10px;
}
.sec-h2 {
  font-family: 'Syne', sans-serif;
  font-size: clamp(1.8rem, 3.5vw, 2.8rem);
  font-weight: 800; line-height: 1.1;
  letter-spacing: -0.025em; color: #18160f;
  margin-bottom: 10px;
}
.sec-sub {
  font-size: 15.5px; line-height: 1.7;
  color: #7c7363; max-width: 520px;
  margin-bottom: 48px;
}

/* Feature cards */
.feat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.feat-card {
  padding: 26px 22px;
  background: rgba(255,255,255,0.68);
  border: 1px solid rgba(255,255,255,0.88);
  border-radius: 16px;
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.04);
  transition: transform .2s, box-shadow .2s;
}
.feat-card:hover { transform: translateY(-4px); box-shadow: 0 2px 4px rgba(0,0,0,0.05), 0 16px 36px rgba(0,0,0,0.09); }
.feat-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: #fff7ed; border: 1px solid #fed7aa;
  display: grid; place-items: center;
  color: #f97316; margin-bottom: 16px;
}
.feat-icon svg { width: 19px; height: 19px; }
.feat-title {
  font-family: 'Syne', sans-serif;
  font-size: 14.5px; font-weight: 700;
  color: #18160f; margin-bottom: 8px;
  letter-spacing: -0.01em;
}
.feat-body { font-size: 13.5px; line-height: 1.68; color: #7c7363; }

/* Flow */
.flow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}
.flow-card {
  padding: 24px 20px;
  background: rgba(255,255,255,0.68);
  border: 1px solid rgba(255,255,255,0.88);
  border-radius: 14px;
  backdrop-filter: blur(14px) saturate(1.2);
  -webkit-backdrop-filter: blur(14px) saturate(1.2);
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.04);
  transition: transform .2s, box-shadow .2s;
}
.flow-card:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(0,0,0,0.05), 0 14px 32px rgba(0,0,0,0.08); }
.flow-n {
  display: block;
  font-family: 'Syne', sans-serif;
  font-size: 10px; font-weight: 800;
  letter-spacing: .14em; color: #a855f7;
  text-transform: uppercase; margin-bottom: 12px;
}
.flow-label {
  font-family: 'Syne', sans-serif;
  font-size: 14px; font-weight: 700;
  color: #18160f; margin-bottom: 8px;
  letter-spacing: -0.01em;
}
.flow-body { font-size: 13px; line-height: 1.68; color: #7c7363; }

/* CTA */
.cta-s { padding-bottom: 110px; }
.cta-panel {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 48px; align-items: center;
  padding: clamp(32px,5vw,60px) clamp(28px,5vw,52px);
  background: rgba(255,255,255,0.68);
  border: 1px solid rgba(255,255,255,0.88);
  border-radius: 22px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.04), 0 20px 50px rgba(0,0,0,0.06);
  position: relative; overflow: hidden;
}
.cta-panel::after {
  content: '';
  position: absolute; top: -60px; right: -50px;
  width: 200px; height: 200px; border-radius: 50%;
  background: radial-gradient(circle, rgba(249,115,22,0.14) 0%, transparent 70%);
  pointer-events: none;
}
.cta-h2 {
  font-family: 'Syne', sans-serif;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  font-weight: 800; line-height: 1.1;
  letter-spacing: -0.025em; color: #18160f;
  margin-bottom: 10px;
}
.cta-p { font-size: 15px; line-height: 1.7; color: #7c7363; max-width: 440px; margin-bottom: 24px; }
.cta-btns { display: flex; flex-direction: column; gap: 9px; flex-shrink: 0; }

/* Footer */
.footer {
  position: relative; z-index: 2;
  border-top: 1px solid rgba(0,0,0,0.07);
  background: rgba(255,255,255,0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 20px 28px;
  display: flex; justify-content: space-between;
  align-items: center; flex-wrap: wrap; gap: 12px;
}
.foot-l { display: flex; align-items: center; gap: 12px; }
.foot-pill {
  padding: 3px 9px; border-radius: 6px;
  background: #fff7ed; border: 1px solid #fed7aa;
  color: #c2410c; font-size: 10px;
  font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase;
}
.foot-copy { font-size: 12px; color: #b0a898; }
.foot-links { display: flex; gap: 22px; }
.foot-a { font-size: 13px; font-weight: 500; color: #7c7363; text-decoration: none; transition: color .13s; }
.foot-a:hover { color: #f97316; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.28; }
}

/* ── TABLET (641–900px) ── */
@media (min-width: 641px) and (max-width: 900px) {
  .nav-center { gap: 0; }
  .nav-link { padding: 5px 8px; font-size: 12px; }
  .hero-h1 { font-size: clamp(2.2rem, 6vw, 3.6rem); }
  .feat-grid { grid-template-columns: repeat(2, 1fr); }
  .flow-grid { grid-template-columns: repeat(2, 1fr); }
  .cta-panel { grid-template-columns: 1fr; gap: 24px; }
  .hamburger { display: none; }
}

/* ── MOBILE (≤640px) ── */
@media (max-width: 640px) {
  /* Nav: brand left, connect + hamburger right — nav links hidden */
  .nav {
    grid-template-columns: auto 1fr;
    height: 52px;
    padding: 0 16px;
    gap: 0;
  }
  .nav-center { display: none; }
  .nav-end { gap: 8px; }

  /* Show hamburger */
  .hamburger { display: flex; }

  /* RainbowKit connect button — keep compact */
  [data-rk] button {
    font-size: 12px !important;
    padding: 6px 10px !important;
  }

  /* Hero */
  .hero {
    min-height: 100svh;
    padding: 72px 20px 52px;
    align-items: center;
  }
  .hero-h1 { font-size: clamp(2rem, 10vw, 2.8rem); line-height: 1.1; }
  .hero-sub { font-size: 14px; max-width: 100%; }
  .hero-btns {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
  }
  .btn-primary, .btn-outline {
    justify-content: center;
    width: 100%;
    padding: 14px 20px;
    font-size: 15px;
  }

  /* Sections */
  .section { padding: 56px 20px; }
  .sec-h2 { font-size: clamp(1.6rem, 8vw, 2.1rem); }
  .sec-sub { font-size: 14px; margin-bottom: 32px; }

  /* Feature cards — single column, full width */
  .feat-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .feat-card { padding: 22px 18px; }

  /* Flow — 2 col fits nicely at 320+ */
  .flow-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .flow-card { padding: 16px 14px; }
  .flow-label { font-size: 13px; }
  .flow-body { font-size: 12px; }

  /* CTA — single column, stacked buttons */
  .cta-s { padding-bottom: 72px; }
  .cta-panel {
    grid-template-columns: 1fr;
    gap: 22px;
    padding: 26px 22px;
  }
  .cta-h2 { font-size: clamp(1.5rem, 7vw, 1.9rem); }
  .cta-p { font-size: 14px; margin-bottom: 0; }
  .cta-btns {
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }
  .cta-btns .btn-primary,
  .cta-btns .btn-outline {
    justify-content: center;
    width: 100%;
  }

  /* Footer */
  .footer {
    padding: 16px 20px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .foot-links { gap: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;

/* ── ROOT ── */
export default function HomePage() {
  const { address } = useAccount();
  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{CSS}</style>
      <BgCanvas />
      <Nav address={address} />
      <main>
        <Hero address={address} />
        <Features />
        <Flow />
        <CTA address={address} />
      </main>
      <Footer />
    </div>
  );
}