'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ── CONTRACT DATA ─────────────────────────────────────────────────────────────

const CONTRACTS = [
  {
    num: '01',
    name: 'IdentityRegistry',
    tag: 'ERC-3643 · KYC Hub',
    c: '#3B6CF6',
    addr: '0x18026c0B...4c5A',
    fullAddr: '0x18026c0BF58c978caDc8Df7f31b1cbC2f6A94c5A',
    basescan: 'https://basescan.org/address/0x18026c0BF58c978caDc8Df7f31b1cbC2f6A94c5A',
  },
  {
    num: '02',
    name: 'AssetRegistry',
    tag: 'Supply Ledger',
    c: '#F5A623',
    addr: '0x88bb8025...A594',
    fullAddr: '0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594',
    basescan: 'https://basescan.org/address/0x88bb8025dc10Cc642d2F0D10F4335EcDBdC9A594',
  },
  {
    num: '03',
    name: 'ComplianceEngine',
    tag: 'Transfer Gatekeeper',
    c: '#34D399',
    addr: '0x00c0E82e...131c',
    fullAddr: '0x00c0E82e0C81c4Df096aAd98f2aA5A399b34131c',
    basescan: 'https://basescan.org/address/0x00c0E82e0C81c4Df096aAd98f2aA5A399b34131c',
  },
  {
    num: '04',
    name: 'NAVOracle',
    tag: 'Chainlink · 15% Breaker',
    c: '#A78BFA',
    addr: '0xE4BeA2a0...cbdD',
    fullAddr: '0xE4BeA2a081BA5d7137618840aFD012883014cbdD',
    basescan: 'https://basescan.org/address/0xE4BeA2a081BA5d7137618840aFD012883014cbdD',
  },
  {
    num: '05',
    name: 'YieldDistributor',
    tag: 'Merkle · Automated Epochs',
    c: '#FB7185',
    addr: '0x8cbdAC28...1996',
    fullAddr: '0x8cbdAC28819d95b8425a0BdFD37610075F021996',
    basescan: 'https://basescan.org/address/0x8cbdAC28819d95b8425a0BdFD37610075F021996',
  },
  {
    num: '06',
    name: 'Genesis Token (nUSTB)',
    tag: 'ERC-20 · Compliance-gated',
    c: '#22D3EE',
    addr: '0xFDFda5Ca...4EDE',
    fullAddr: '0xFDFda5Ca91bDC022EC85C9F2bE5d29A33f874EDE',
    basescan: 'https://basescan.org/address/0xFDFda5Ca91bDC022EC85C9F2bE5d29A33f874EDE',
  },
];

const TIERS = [
  { name: 'NONE', desc: 'Unregistered. No protocol access whatsoever.', c: '#8896B3' },
  { name: 'BASIC', desc: 'Standard KYC — name, email, government ID.', c: '#34D399' },
  { name: 'KYC', desc: 'Advanced KYC — proof of address, biometrics.', c: '#3B6CF6' },
  { name: 'ACCREDITED', desc: 'Verified high-net-worth individual status.', c: '#F5A623' },
  { name: 'INSTITUTIONAL', desc: 'Corporate and institutional entity clearance.', c: '#A78BFA' },
];

const ASSET_TYPES = [
  { name: 'T-Bill', desc: 'US Treasury Bills tokenized as permissioned ERC-20s. Supply caps and maturity dates enforced in storage.', c: '#3B6CF6' },
  { name: 'Real Estate', desc: 'Commercial and residential property fractionalised with jurisdiction-specific transfer rules.', c: '#34D399' },
  { name: 'Corporate Bond', desc: 'Fixed-income instruments with Chainlink-priced NAV and automated coupon epochs.', c: '#F5A623' },
  { name: 'Commodity', desc: 'Physical commodity exposure with circuit breakers preventing NAV manipulation.', c: '#FB7185' },
];

const PRINCIPLES = [
  {
    num: '01',
    title: 'Compliance is the token, not a wrapper around it',
    body: 'Standard ERC-20 tokens are permissionless. Nexus RWA inverts this. The transfer hook `_update()` is overridden at the lowest possible level — inside OpenZeppelin\'s ERC-20 base — and calls the ComplianceEngine before a single balance bit moves. There is no way to bypass this gate from outside the contract. Not from a wallet, not from another contract, not from the owner.',
    c: '#3B6CF6',
  },
  {
    num: '02',
    title: 'Identity decoupled from the asset',
    body: 'The IdentityRegistry is a standalone contract that knows nothing about which assets exist. The AssetRegistry knows about assets but defers all KYC decisions to the identity layer. The ComplianceEngine reads from both and makes the final call. This means a wallet\'s KYC status improves once — globally — and every asset it holds benefits immediately without a single re-whitelist transaction.',
    c: '#F5A623',
  },
  {
    num: '03',
    title: 'Sanction enforcement is pure Solidity, no oracle',
    body: 'OFAC-sanctioned jurisdictions — Iran, North Korea, Russia, Syria, Cuba, Venezuela — are hardcoded as constants in JurisdictionLib.sol. Country code 364 will always revert. There is no off-chain feed that could be delayed, stale, or manipulated. The six blocked nations are a permanent, gas-free check that runs on every transfer.',
    c: '#34D399',
  },
  {
    num: '04',
    title: 'Legal clawback without upgradeability',
    body: 'Court-ordered seizures, wallet recovery after key compromise, and confiscation of hacker proceeds are handled by `executeForcedTransfer()` in the ComplianceEngine. It bypasses the whitelist entirely by calling `ERC20._update()` directly — the same internal function, but invoked by the compliance role rather than the transfer hook. No proxy upgrade, no contract migration, no operational downtime.',
    c: '#A78BFA',
  },
  {
    num: '05',
    title: 'The 15% circuit breaker is autonomous',
    body: 'The NAVOracle stores a snapshot of each asset\'s price every 24 hours. If the next Chainlink round returns a value more than 15% below that snapshot, the circuit breaker trips and all NAV reads for that asset revert. Nothing can read a crashed price. Resumption requires manual guardian intervention — a deliberate friction that prevents automated systems from acting on manipulated data.',
    c: '#FB7185',
  },
  {
    num: '06',
    title: 'Yield scales to any number of holders',
    body: 'A naive yield distribution loop over ten thousand holders would hit the block gas limit and never land. YieldDistributor.sol sidesteps this entirely. Off-chain, a Merkle tree is built from the full distribution allocation. Only the 32-byte root is stored on-chain. Each investor proves their own inclusion with a Merkle proof — a constant-gas operation regardless of protocol size. Chainlink Automation advances epochs on schedule with zero operator calls.',
    c: '#22D3EE',
  },
];

const SECURITY_INVARIANTS = [
  { inv: 'Non-whitelisted balance is always zero', how: 'Minting reverts if `isWhitelisted` returns false. Transfer hook reverts on both sides. Proven via 5,000+ randomised state sequences in stateful invariant fuzzing.' },
  { inv: 'Supply cap is never breached', how: '`recordMint()` checks against `totalSupplyCap` before updating `mintedSupply`. The invariant test runs millions of mint permutations to confirm.' },
  { inv: 'Yield cannot be claimed twice per epoch', how: '`s_hasClaimed[epochId][investor]` is written before the token transfer. Any reentrant claim attempt sees the flag set and reverts with `AlreadyClaimed`.' },
  { inv: 'Sanctioned jurisdictions never receive tokens', how: '`JurisdictionLib.enforceSanctionCheck()` is called on both whitelist registration and every live transfer. Two-layered: entry prevention and transfer prevention.' },
  { inv: 'Matured assets cannot be minted', how: '`isAssetActive()` checks `maturityDate` against `block.timestamp`. Passed maturity reverts with `AssetMatured` before any supply is recorded.' },
  { inv: 'Forced transfer always emits an on-chain proof', how: '`ForcedTransferExecuted` is emitted before the external token call, ensuring an immutable audit trail regardless of downstream call success.' },
];

// ── 3D CARTOON WEBGL CANVAS ───────────────────────────────────────────────────

function CartoonCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl');
    if (!gl) return;

    let W = 0;
    let H = 0;
    let rafId = 0;
    let t = 0;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
      gl.viewport(0, 0, W, H);
    };
    resize();
    window.addEventListener('resize', resize);

    // Vertex shader — cel shading with rim light
    const vsSource = `
      attribute vec3 aPos;
      attribute vec3 aNorm;
      uniform mat4 uMV;
      uniform mat4 uP;
      uniform mat4 uN;
      varying vec3 vNorm;
      varying vec3 vViewDir;
      void main() {
        vec4 mvPos = uMV * vec4(aPos, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vNorm = normalize((uN * vec4(aNorm, 0.0)).xyz);
        gl_Position = uP * mvPos;
      }
    `;

    // Fragment shader — flat bands + rim glow
    const fsSource = `
      precision mediump float;
      varying vec3 vNorm;
      varying vec3 vViewDir;
      uniform vec3 uColor;
      uniform vec3 uLight;
      void main() {
        float d = max(dot(vNorm, normalize(uLight)), 0.0);
        // Quantise into 3 bands — cartoon cel look
        float band = d < 0.2 ? 0.1 : (d < 0.6 ? 0.55 : 0.95);
        vec3 col = uColor * band;
        // Rim light in white
        float rim = 1.0 - max(dot(vNorm, vViewDir), 0.0);
        rim = pow(rim, 3.0) * 0.65;
        col += vec3(rim);
        gl_FragColor = vec4(col, 0.88);
      }
    `;

    function compileShader(type: number, src: string): WebGLShader | null {
      const s = gl!.createShader(type);
      if (!s) return null;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aNorm = gl.getAttribLocation(prog, 'aNorm');
    const uMV = gl.getUniformLocation(prog, 'uMV');
    const uP = gl.getUniformLocation(prog, 'uP');
    const uN = gl.getUniformLocation(prog, 'uN');
    const uColor = gl.getUniformLocation(prog, 'uColor');
    const uLight = gl.getUniformLocation(prog, 'uLight');

    // Build UV-sphere geometry
    function buildSphere(stacks: number, slices: number): { verts: Float32Array; idx: Uint16Array } {
      const verts: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= stacks; i++) {
        const phi = (Math.PI * i) / stacks;
        for (let j = 0; j <= slices; j++) {
          const theta = (2 * Math.PI * j) / slices;
          const x = Math.sin(phi) * Math.cos(theta);
          const y = Math.cos(phi);
          const z = Math.sin(phi) * Math.sin(theta);
          verts.push(x, y, z, x, y, z);
        }
      }
      for (let i = 0; i < stacks; i++) {
        for (let j = 0; j < slices; j++) {
          const a = i * (slices + 1) + j;
          const b = a + slices + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
    }

    // Build torus geometry
    function buildTorus(R: number, r: number, segsR: number, segsr: number): { verts: Float32Array; idx: Uint16Array } {
      const verts: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= segsR; i++) {
        const u = (2 * Math.PI * i) / segsR;
        for (let j = 0; j <= segsr; j++) {
          const v = (2 * Math.PI * j) / segsr;
          const x = (R + r * Math.cos(v)) * Math.cos(u);
          const y = r * Math.sin(v);
          const z = (R + r * Math.cos(v)) * Math.sin(u);
          const nx = Math.cos(v) * Math.cos(u);
          const ny = Math.sin(v);
          const nz = Math.cos(v) * Math.sin(u);
          verts.push(x, y, z, nx, ny, nz);
        }
      }
      for (let i = 0; i < segsR; i++) {
        for (let j = 0; j < segsr; j++) {
          const a = i * (segsr + 1) + j;
          const b = a + segsr + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
    }

    function uploadMesh(verts: Float32Array, idx: Uint16Array): { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number } {
      const vbo = gl!.createBuffer()!;
      gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo);
      gl!.bufferData(gl!.ARRAY_BUFFER, verts, gl!.STATIC_DRAW);
      const ibo = gl!.createBuffer()!;
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ibo);
      gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, idx, gl!.STATIC_DRAW);
      return { vbo, ibo, count: idx.length };
    }

    const sphere = buildSphere(18, 24);
    const torus = buildTorus(1, 0.36, 24, 16);
    const sSphere = uploadMesh(sphere.verts, sphere.idx);
    const sTorus = uploadMesh(torus.verts, torus.idx);

    // Matrix helpers (column-major, WebGL convention)
    function mat4Identity(): Float32Array {
      return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }

    function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
      const f = 1.0 / Math.tan(fov / 2);
      const nf = 1 / (near - far);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f;
      m[10] = (far + near) * nf; m[11] = -1;
      m[14] = 2 * far * near * nf;
      return m;
    }

    function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
      const out = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
          out[i + j * 4] = s;
        }
      }
      return out;
    }

    function mat4Translate(tx: number, ty: number, tz: number): Float32Array {
      const m = mat4Identity();
      m[12] = tx; m[13] = ty; m[14] = tz;
      return m;
    }

    function mat4RotX(a: number): Float32Array {
      const m = mat4Identity();
      m[5] = Math.cos(a); m[6] = Math.sin(a);
      m[9] = -Math.sin(a); m[10] = Math.cos(a);
      return m;
    }

    function mat4RotY(a: number): Float32Array {
      const m = mat4Identity();
      m[0] = Math.cos(a); m[2] = -Math.sin(a);
      m[8] = Math.sin(a); m[10] = Math.cos(a);
      return m;
    }

    function mat4RotZ(a: number): Float32Array {
      const m = mat4Identity();
      m[0] = Math.cos(a); m[1] = Math.sin(a);
      m[4] = -Math.sin(a); m[5] = Math.cos(a);
      return m;
    }

    function mat4Scale(s: number): Float32Array {
      const m = mat4Identity();
      m[0] = s; m[5] = s; m[10] = s;
      return m;
    }

    function mat4Inverse3x3(m: Float32Array): Float32Array {
      const out = new Float32Array(16);
      out[0] = m[5]*m[10] - m[6]*m[9];
      out[1] = m[6]*m[8] - m[4]*m[10];
      out[2] = m[4]*m[9] - m[5]*m[8];
      out[4] = m[2]*m[9] - m[1]*m[10];
      out[5] = m[0]*m[10] - m[2]*m[8];
      out[6] = m[1]*m[8] - m[0]*m[9];
      out[8] = m[1]*m[6] - m[2]*m[5];
      out[9] = m[2]*m[4] - m[0]*m[6];
      out[10] = m[0]*m[5] - m[1]*m[4];
      const det = m[0]*out[0] + m[1]*out[1] + m[2]*out[2];
      if (Math.abs(det) < 1e-8) return mat4Identity();
      const inv = 1 / det;
      // Transpose inverse (normal matrix)
      const n = mat4Identity();
      n[0] = out[0]*inv; n[1] = out[4]*inv; n[2] = out[8]*inv;
      n[4] = out[1]*inv; n[5] = out[5]*inv; n[6] = out[9]*inv;
      n[8] = out[2]*inv; n[9] = out[6]*inv; n[10] = out[10]*inv;
      return n;
    }

    function bindMesh(mesh: { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, mesh.vbo);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, mesh.ibo);
      const stride = 6 * 4;
      gl!.vertexAttribPointer(aPos, 3, gl!.FLOAT, false, stride, 0);
      gl!.enableVertexAttribArray(aPos);
      gl!.vertexAttribPointer(aNorm, 3, gl!.FLOAT, false, stride, 12);
      gl!.enableVertexAttribArray(aNorm);
    }

    type Shape = {
      type: 'sphere' | 'torus';
      x: number;
      y: number;
      z: number;
      scale: number;
      color: [number, number, number];
      rotSpeedX: number;
      rotSpeedY: number;
      rotSpeedZ: number;
      floatOffset: number;
      floatSpeed: number;
      floatAmp: number;
    };

    const shapes: Shape[] = [
      { type: 'sphere', x: -2.8, y: 0.4,  z: -3, scale: 0.72, color: [0.23, 0.42, 0.96], rotSpeedX: 0.31, rotSpeedY: 0.44, rotSpeedZ: 0, floatOffset: 0, floatSpeed: 0.7, floatAmp: 0.22 },
      { type: 'torus',  x:  2.4, y: 0.2,  z: -4, scale: 0.55, color: [0.96, 0.65, 0.14], rotSpeedX: 0.22, rotSpeedY: 0.58, rotSpeedZ: 0.18, floatOffset: 1.1, floatSpeed: 0.5, floatAmp: 0.28 },
      { type: 'sphere', x:  0.6, y: 1.2,  z: -5, scale: 0.42, color: [0.20, 0.83, 0.60], rotSpeedX: 0.44, rotSpeedY: 0.22, rotSpeedZ: 0, floatOffset: 2.0, floatSpeed: 0.9, floatAmp: 0.18 },
      { type: 'torus',  x: -1.8, y: -0.9, z: -4.5, scale: 0.4, color: [0.65, 0.55, 0.98], rotSpeedX: 0.18, rotSpeedY: 0.65, rotSpeedZ: 0.3, floatOffset: 0.5, floatSpeed: 0.6, floatAmp: 0.25 },
      { type: 'sphere', x:  3.2, y: -0.6, z: -3.5, scale: 0.32, color: [0.98, 0.44, 0.52], rotSpeedX: 0.55, rotSpeedY: 0.35, rotSpeedZ: 0, floatOffset: 3.0, floatSpeed: 0.8, floatAmp: 0.15 },
      { type: 'torus',  x: -3.6, y: -0.3, z: -5, scale: 0.48, color: [0.13, 0.83, 0.93], rotSpeedX: 0.28, rotSpeedY: 0.42, rotSpeedZ: 0.22, floatOffset: 1.8, floatSpeed: 0.55, floatAmp: 0.32 },
    ];

    function drawShape(shape: Shape, view: Float32Array, proj: Float32Array) {
      const floatY = Math.sin(t * shape.floatSpeed + shape.floatOffset) * shape.floatAmp;
      let model = mat4Translate(shape.x, shape.y + floatY, shape.z);
      model = mat4Mul(model, mat4Scale(shape.scale));
      model = mat4Mul(model, mat4RotX(t * shape.rotSpeedX));
      model = mat4Mul(model, mat4RotY(t * shape.rotSpeedY));
      model = mat4Mul(model, mat4RotZ(t * shape.rotSpeedZ));

      const mv = mat4Mul(view, model);
      const norm = mat4Inverse3x3(mv);

      gl!.uniformMatrix4fv(uMV, false, mv);
      gl!.uniformMatrix4fv(uP, false, proj);
      gl!.uniformMatrix4fv(uN, false, norm);
      gl!.uniform3fv(uColor, shape.color);

      const mesh = shape.type === 'sphere' ? sSphere : sTorus;
      bindMesh(mesh);
      gl!.drawElements(gl!.TRIANGLES, mesh.count, gl!.UNSIGNED_SHORT, 0);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const view = mat4Translate(0, 0, -6);
    gl.uniform3f(uLight, 1.4, 2.0, 2.5);

    function tick() {
      rafId = requestAnimationFrame(tick);
      t += 0.012;

      gl!.clearColor(0.043, 0.055, 0.098, 1);
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);

      const aspect = W / H;
      const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 50);

      for (const shape of shapes) drawShape(shape, view, proj);
    }

    tick();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.55 }}
      aria-hidden
    />
  );
}

// ── SCROLL REVEAL ─────────────────────────────────────────────────────────────

function useReveal() {
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setVisible((p) => new Set([...p, e.target.id]));
        });
      },
      { threshold: 0.08 }
    );
    const els = document.querySelectorAll('[data-reveal]');
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const rv = useCallback(
    (id: string, delay = 0): React.CSSProperties => ({
      opacity: visible.has(id) ? 1 : 0,
      transform: visible.has(id) ? 'translateY(0)' : 'translateY(22px)',
      transition: `opacity 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.65s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
    }),
    [visible]
  );

  return { rv };
}

// ── SECTION ───────────────────────────────────────────────────────────────────

function Sec({
  id,
  children,
  style = {},
  className,
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section id={id} className={className} style={{ position: 'relative', zIndex: 2, ...style }}>
      {children}
    </section>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const { rv } = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 48);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&family=Inter:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
          background: #0B0E1A;
          color: #E8EDF8;
          font-family: 'Inter', sans-serif;
          overflow-x: hidden;
          -webkit-font-smoothing: antialiased;
        }
        ::selection { background: rgba(59,108,246,0.4); }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: #0B0E1A; }
        ::-webkit-scrollbar-thumb { background: rgba(59,108,246,0.4); border-radius: 2px; }

        @keyframes heroIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        @keyframes pulse { 0%,100%{ opacity: 0.9; } 50%{ opacity: 0.3; } }
        @keyframes float { 0%,100%{ transform: translateY(0); } 50%{ transform: translateY(-8px); } }

        .nav-root {
          position: fixed; top: 0; left: 0; right: 0; z-index: 900;
          padding: 16px 48px;
          display: flex; align-items: center; justify-content: space-between;
          transition: background 0.35s, border-color 0.35s, padding 0.35s;
        }
        .nav-root.scrolled {
          background: rgba(11,14,26,0.88);
          backdrop-filter: blur(20px) saturate(1.4);
          -webkit-backdrop-filter: blur(20px) saturate(1.4);
          border-bottom: 1px solid rgba(59,108,246,0.15);
          padding-top: 12px; padding-bottom: 12px;
        }

        .hero-section {
          position: relative;
          z-index: 2;
          min-height: 100svh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 100px 24px 72px;
          overflow: hidden;
        }

        .display-title {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: clamp(36px, 7vw, 86px);
          line-height: 1.02;
          letter-spacing: -0.04em;
          color: #F4F7FF;
          margin-bottom: 22px;
        }

        .mono { font-family: 'IBM Plex Mono', monospace; }
        .body-text { font-size: clamp(14px, 1.6vw, 16px); font-weight: 400; color: #8896B3; line-height: 1.82; }

        .sec-pad { padding: 72px 24px; }
        .sec-narrow { max-width: 760px; margin: 0 auto; }
        .sec-wide { max-width: 1060px; margin: 0 auto; }

        .eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: #3B6CF6;
          margin-bottom: 14px;
        }
        .sec-title {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: clamp(22px, 4vw, 48px);
          letter-spacing: -0.03em;
          color: #F4F7FF;
          line-height: 1.08;
          margin-bottom: 16px;
        }

        .glass-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          transition: border-color 0.22s, background 0.22s;
        }
        .glass-card:hover {
          background: rgba(255,255,255,0.055);
          border-color: rgba(255,255,255,0.14);
        }

        .toc-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          font-size: 13px;
          font-weight: 500;
          color: #8896B3;
          text-decoration: none;
          transition: color 0.18s, padding-left 0.18s;
        }
        .toc-link:hover { color: #F4F7FF; padding-left: 5px; }

        .contract-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 11px;
          border-radius: 8px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-decoration: none;
          transition: background 0.18s;
        }

        .nav-links { display: flex; gap: 28px; align-items: center; }
        .nav-link {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: #8896B3;
          text-decoration: none;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          transition: color 0.18s;
        }
        .nav-link:hover { color: #F4F7FF; }
        .ham { display: none !important; }

        @media (max-width: 900px) {
          .nav-root { padding: 12px 18px !important; }
          .nav-links { display: none !important; }
          .ham { display: flex !important; }
        }

        @media (max-width: 768px) {
          .two-col { grid-template-columns: 1fr !important; }
          .three-col { grid-template-columns: 1fr 1fr !important; }
          .toc-two { grid-template-columns: 1fr !important; }
          .sec-pad { padding: 56px 18px; }
        }
        @media (max-width: 480px) {
          .three-col { grid-template-columns: 1fr !important; }
          .sec-pad { padding: 44px 14px; }
          .hero-section { padding: 80px 16px 56px; }
          .cta-card-inner { flex-direction: column !important; gap: 24px !important; }
        }
      `}</style>

      {/* 3D cartoon background */}
      <CartoonCanvas />

      {/* Dark overlay so text stays readable over WebGL */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(11,14,26,0.3) 0%, rgba(11,14,26,0.75) 100%)',
        }}
      />

      {/* ═══ NAV ═══ */}
      <nav className={`nav-root${scrolled ? ' scrolled' : ''}`}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: 'linear-gradient(135deg, #3B6CF6, #7C3AED)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" fill="#fff" opacity="0.95" />
              <polygon points="12,7 17,10 17,14 12,17 7,14 7,10" fill="#93C5FD" />
            </svg>
          </div>
          <div>
            <div
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 15,
                color: '#F4F7FF',
                letterSpacing: '-0.02em',
                lineHeight: 1,
              }}
            >
              Nexus RWA
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 7.5,
                color: 'rgba(136,150,179,0.8)',
                letterSpacing: '0.2em',
                marginTop: 2,
              }}
            >
              PROTOCOL
            </div>
          </div>
        </a>

        <div className="nav-links">
          {['Overview', 'Architecture', 'Contracts', 'Compliance', 'Yield', 'Security'].map((l) => (
            <a key={l} href={`#${l.toLowerCase()}`} className="nav-link">
              {l}
            </a>
          ))}
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
          <a href="/" className="nav-link" style={{ color: '#3B6CF6' }}>
            Back to App
          </a>
        </div>

        <button
          className="ham"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 6,
            flexDirection: 'column',
            gap: 5,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: 22,
                height: 1.5,
                background: '#F4F7FF',
                borderRadius: 2,
                transition: 'all 0.28s ease',
                transform: menuOpen
                  ? i === 0
                    ? 'rotate(45deg) translate(4.5px,4.5px)'
                    : i === 1
                    ? 'scaleX(0)'
                    : 'rotate(-45deg) translate(4.5px,-4.5px)'
                  : 'none',
                opacity: menuOpen && i === 1 ? 0 : 1,
              }}
            />
          ))}
        </button>
      </nav>

      {/* Mobile menu */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 890,
          background: 'rgba(11,14,26,0.97)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? 'auto' : 'none',
          transition: 'opacity 0.28s ease',
        }}
      >
        {['Overview', 'Architecture', 'Contracts', 'Compliance', 'Yield', 'Security', 'Back to App'].map((item, i) => (
          <a
            key={item}
            href={item === 'Back to App' ? '/' : `#${item.toLowerCase()}`}
            onClick={() => setMenuOpen(false)}
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 28,
              fontWeight: 700,
              color: item === 'Back to App' ? '#3B6CF6' : '#F4F7FF',
              textDecoration: 'none',
              opacity: menuOpen ? 1 : 0,
              transform: menuOpen ? 'none' : 'translateY(14px)',
              transition: `all 0.4s cubic-bezier(0.16,1,0.3,1) ${i * 45}ms`,
            }}
          >
            {item}
          </a>
        ))}
      </div>

      {/* ═══ HERO ═══ */}
      <section className="hero-section">
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 800, width: '100%' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 13px',
              borderRadius: 100,
              background: 'rgba(59,108,246,0.12)',
              border: '1px solid rgba(59,108,246,0.3)',
              marginBottom: 24,
              animation: 'heroIn 0.6s cubic-bezier(0.16,1,0.3,1) both',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#34D399',
                flexShrink: 0,
                animation: 'pulse 2.2s ease-in-out infinite',
              }}
            />
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                fontWeight: 500,
                color: '#93C5FD',
                letterSpacing: '0.14em',
              }}
            >
              LIVE ON BASE MAINNET
            </span>
          </div>

          <h1
            className="display-title"
            style={{ animation: 'heroIn 0.7s cubic-bezier(0.16,1,0.3,1) 0.08s both' }}
          >
            Institutional RWA
            <br />
            <span style={{ color: '#3B6CF6' }}>compliance at the token layer.</span>
          </h1>

          <p
            className="body-text"
            style={{
              maxWidth: 520,
              margin: '0 auto 32px',
              animation: 'heroIn 0.7s cubic-bezier(0.16,1,0.3,1) 0.16s both',
            }}
          >
            On-chain KYC, atomic sanction enforcement, automated Merkle yield settlement, and a
            Chainlink-powered circuit breaker — encoded into the token itself. No off-chain gates.
            No manual approvals. No workarounds.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              flexWrap: 'wrap',
              animation: 'heroIn 0.7s cubic-bezier(0.16,1,0.3,1) 0.24s both',
            }}
          >
            {[
              { l: 'Architecture', href: '#architecture', c: '#3B6CF6' },
              { l: 'Contracts', href: '#contracts', c: '#F5A623' },
              { l: 'Compliance', href: '#compliance', c: '#34D399' },
              { l: 'Security', href: '#security', c: '#A78BFA' },
            ].map((link) => (
              <a
                key={link.l}
                href={link.href}
                style={{
                  padding: '7px 15px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                  color: '#8896B3',
                  textDecoration: 'none',
                  letterSpacing: '0.08em',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.color = link.c;
                  el.style.borderColor = `${link.c}40`;
                  el.style.background = `${link.c}0e`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.color = '#8896B3';
                  el.style.borderColor = 'rgba(255,255,255,0.1)';
                  el.style.background = 'rgba(255,255,255,0.05)';
                }}
              >
                {link.l}
              </a>
            ))}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 28,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            animation: 'float 2.5s ease-in-out infinite',
          }}
        >
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 8,
              color: 'rgba(136,150,179,0.45)',
              letterSpacing: '0.22em',
            }}
          >
            SCROLL
          </div>
          <div
            style={{
              width: 1,
              height: 24,
              background: 'linear-gradient(to bottom, rgba(59,108,246,0.6), transparent)',
            }}
          />
        </div>
      </section>

      {/* ═══ TABLE OF CONTENTS ═══ */}
      <Sec id="toc" style={{ padding: '40px 24px 56px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div
            id="toc-block"
            data-reveal
            style={{
              padding: '28px 32px',
              borderRadius: 20,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              ...rv('toc-block'),
            }}
          >
            <div className="eyebrow">Contents</div>
            <div
              className="toc-two"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 48px' }}
            >
              {[
                ['01', 'Why This Exists', '#overview'],
                ['02', 'Protocol Architecture', '#architecture'],
                ['03', 'The Six Contracts', '#contracts'],
                ['04', 'Compliance Lifecycle', '#compliance'],
                ['05', 'Identity and KYC Tiers', '#identity'],
                ['06', 'Asset Types', '#assets'],
                ['07', 'Yield Distribution', '#yield'],
                ['08', 'NAV Oracle and Circuit Breaker', '#oracle'],
                ['09', 'Design Principles', '#philosophy'],
                ['10', 'Security and Invariants', '#security'],
              ].map(([num, label, href]) => (
                <a key={num} href={href} className="toc-link">
                  <span
                    className="mono"
                    style={{ fontSize: 9, color: 'rgba(136,150,179,0.5)', minWidth: 22 }}
                  >
                    {num}
                  </span>
                  <span>{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </Sec>

      {/* ═══ OVERVIEW ═══ */}
      <Sec id="overview" className="sec-pad" style={{ padding: '72px 24px' }}>
        <div className="sec-narrow">
          <div id="ov-hdr" data-reveal style={rv('ov-hdr')}>
            <div className="eyebrow">Why this exists</div>
            <h2 className="sec-title">
              Standard ERC-20 is the wrong primitive for regulated assets.
            </h2>
          </div>
          <div id="ov-body" data-reveal style={rv('ov-body', 90)}>
            <p className="body-text" style={{ marginBottom: 20 }}>
              Permissionless token transfers are a feature of DeFi. For tokenized Real-World Assets
              — US Treasury Bills, real estate, corporate bonds — they are a compliance catastrophe.
              A US T-Bill cannot legally be held by an Iranian national. A corporate bond cannot
              legally be sold to an unaccredited investor in a restricted jurisdiction. These rules
              exist in securities law regardless of what the blockchain does.
            </p>
            <p className="body-text" style={{ marginBottom: 20 }}>
              Most tokenization projects solve this with an off-chain approval layer: a centralized
              server that checks transfers before they go through. The blockchain records the outcome
              but not the rule. The compliance is invisible, revocable, and not cryptographically
              verifiable by anyone reading the chain.
            </p>
            <div
              style={{
                borderLeft: '2px solid rgba(59,108,246,0.5)',
                paddingLeft: 22,
                paddingTop: 16,
                paddingBottom: 16,
                background: 'rgba(59,108,246,0.04)',
                borderRadius: '0 12px 12px 0',
                margin: '28px 0',
              }}
            >
              <p
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 'clamp(14px,2vw,19px)',
                  fontWeight: 600,
                  color: '#C7D4F8',
                  lineHeight: 1.58,
                }}
              >
                Nexus RWA encodes the compliance rulebook into the token itself. Every mint, burn,
                and peer-to-peer transfer is evaluated against KYC status, OFAC sanction lists,
                jurisdictional restrictions, and supply caps in a single atomic transaction. The rule
                is the contract.
              </p>
            </div>
            <p className="body-text">
              The protocol is live on Base Mainnet with six deployed and verified contracts. It
              supports four asset classes — T-Bills, real estate, corporate bonds, and commodities —
              each with its own jurisdiction ruleset, supply cap, and maturity date. The Genesis
              Token (nUSTB) is a tokenized US Treasury Bill already operating on the system.
            </p>
          </div>
        </div>
      </Sec>

      {/* ═══ ARCHITECTURE ═══ */}
      <Sec
        id="architecture"
        style={{
          padding: '72px 24px',
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
        }}
      >
        <div className="sec-wide">
          <div id="arch-hdr" data-reveal style={{ marginBottom: 44, ...rv('arch-hdr') }}>
            <div className="eyebrow">System Design</div>
            <h2 className="sec-title">Three layers. Separation taken seriously.</h2>
            <p className="body-text" style={{ maxWidth: 560 }}>
              Every contract in Nexus RWA has exactly one job. Identity does not know about assets.
              Assets do not execute compliance. Compliance does not hold any funds.
            </p>
          </div>

          {/* Architecture diagram */}
          <div id="arch-diagram" data-reveal style={{ ...rv('arch-diagram', 80) }}>
            <div
              style={{
                padding: '22px 20px',
                borderRadius: 16,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.07)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 11,
                overflowX: 'auto',
              }}
            >
              <div style={{ color: '#3B6CF6', fontSize: 8, letterSpacing: '0.18em', marginBottom: 16 }}>
                SYSTEM LAYERS — TOP TO BOTTOM
              </div>
              {[
                { label: 'INVESTOR / DAPP', sub: 'Wagmi · Viem · RainbowKit · Base Mainnet', c: '#8896B3', arrow: true },
                { label: 'COMPLIANCE ENGINE', sub: 'Blacklist check · Sanction check · Whitelist check · Jurisdiction rules', c: '#3B6CF6', arrow: true },
                { label: 'IDENTITY REGISTRY', sub: 'KYC tier · Country code · Accreditation · Expiry', c: '#34D399', arrow: false },
                { label: 'ASSET REGISTRY', sub: 'Supply cap · Maturity date · Per-asset whitelist · Jurisdiction rule', c: '#F5A623', arrow: true },
                { label: 'RWA TOKEN', sub: 'ERC-20 + _update() hook · Forced transfer · Mint / Burn · Pause', c: '#A78BFA', arrow: false },
              ].map((layer, i) => (
                <div key={i}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: `${layer.c}0a`,
                      border: `1px solid ${layer.c}20`,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        color: layer.c,
                        fontWeight: 500,
                        fontSize: 10,
                        letterSpacing: '0.08em',
                        minWidth: 160,
                        flexShrink: 0,
                      }}
                    >
                      {layer.label}
                    </span>
                    <span style={{ color: 'rgba(136,150,179,0.6)', fontSize: 10 }}>{layer.sub}</span>
                  </div>
                  {layer.arrow && (
                    <div
                      style={{
                        textAlign: 'center',
                        color: 'rgba(255,255,255,0.15)',
                        fontSize: 14,
                        margin: '2px 0',
                      }}
                    >
                      ↓
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Sec>

      {/* ═══ CONTRACTS ═══ */}
      <Sec id="contracts" style={{ padding: '72px 24px' }}>
        <div className="sec-wide">
          <div id="con-hdr" data-reveal style={{ marginBottom: 44, ...rv('con-hdr') }}>
            <div className="eyebrow">Deployed on Base Mainnet</div>
            <h2 className="sec-title">Six contracts. One coherent system.</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {CONTRACTS.map((c, i) => (
              <div
                key={c.name}
                id={`ccard${i}`}
                data-reveal
                className="glass-card"
                style={{ padding: '24px 22px', position: 'relative', overflow: 'hidden', ...rv(`ccard${i}`, i * 80) }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -20,
                    right: -4,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 88,
                    fontWeight: 700,
                    color: `${c.c}06`,
                    lineHeight: 1,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {c.num}
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}
                >
                  <h3
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      fontSize: 'clamp(16px,2.2vw,21px)',
                      color: '#F4F7FF',
                      letterSpacing: '-0.02em',
                      lineHeight: 1,
                    }}
                  >
                    {c.name}
                  </h3>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      fontWeight: 500,
                      color: c.c,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: `${c.c}12`,
                      border: `1px solid ${c.c}28`,
                      letterSpacing: '0.07em',
                    }}
                  >
                    {c.tag}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    color: 'rgba(136,150,179,0.65)',
                    marginBottom: 14,
                    wordBreak: 'break-all',
                  }}
                >
                  {c.fullAddr}
                </div>
                <a
                  href={c.basescan}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="contract-chip"
                  style={{
                    background: `${c.c}10`,
                    border: `1px solid ${c.c}28`,
                    color: c.c,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = `${c.c}1e`)
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLElement).style.background = `${c.c}10`)
                  }
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  View on BaseScan
                </a>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      {/* ═══ COMPLIANCE LIFECYCLE ═══ */}
      <Sec
        id="compliance"
        style={{
          padding: '72px 24px',
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
        }}
      >
        <div className="sec-wide">
          <div id="comp-hdr" data-reveal style={{ marginBottom: 44, ...rv('comp-hdr') }}>
            <div className="eyebrow">How transfers work</div>
            <h2 className="sec-title">Every transfer runs four gates in sequence.</h2>
            <p className="body-text" style={{ maxWidth: 540 }}>
              One gate fails, the whole transaction reverts. No partial state. No error recovery. No
              second chances.
            </p>
          </div>
          <div
            className="two-col"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            {[
              {
                step: '01',
                title: 'Global blacklist and sanction check',
                body: 'Both sender and receiver are checked against the global investor blacklist in ComplianceEngine and against the OFAC hardcoded jurisdiction constants in JurisdictionLib. Any match reverts with `BlockedInvestor` or `SanctionedJurisdiction`.',
                c: '#3B6CF6',
              },
              {
                step: '02',
                title: 'Per-asset whitelist verification',
                body: 'Each asset maintains its own whitelist in the AssetRegistry. Both parties must appear in the specific whitelist for the asset being transferred. General KYC clearance is not sufficient — per-asset clearance is required for every individual security.',
                c: '#34D399',
              },
              {
                step: '03',
                title: 'Jurisdiction and accreditation enforcement',
                body: 'JurisdictionLib checks whether the asset allows all jurisdictions or only specific ones. If restricted, the pair of country codes must be compatible with the issuer jurisdiction. Accreditation level is enforced on the receiver — not the sender.',
                c: '#F5A623',
              },
              {
                step: '04',
                title: 'Asset lifecycle and KYC expiry',
                body: 'The AssetRegistry confirms the asset is ACTIVE and has not matured. The IdentityRegistry confirms neither wallet\'s KYC has expired. All of this happens inside the `_update()` override — the same hook OpenZeppelin calls for every balance movement.',
                c: '#A78BFA',
              },
            ].map((item, i) => (
              <div
                key={item.step}
                id={`gate${i}`}
                data-reveal
                className="glass-card"
                style={{ padding: '22px 20px', position: 'relative', overflow: 'hidden', ...rv(`gate${i}`, i * 70) }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: -16,
                    right: 8,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 72,
                    fontWeight: 700,
                    color: `${item.c}07`,
                    lineHeight: 1,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}
                >
                  {item.step}
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    color: item.c,
                    letterSpacing: '0.16em',
                    marginBottom: 10,
                    fontWeight: 500,
                  }}
                >
                  GATE {item.step}
                </div>
                <h3
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    fontSize: 'clamp(14px,1.8vw,18px)',
                    color: '#F4F7FF',
                    marginBottom: 10,
                    lineHeight: 1.22,
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ fontSize: 13.5, color: '#8896B3', lineHeight: 1.72 }}>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      {/* ═══ IDENTITY TIERS ═══ */}
      <Sec id="identity" style={{ padding: '72px 24px' }}>
        <div className="sec-wide">
          <div id="id-hdr" data-reveal style={{ marginBottom: 40, ...rv('id-hdr') }}>
            <div className="eyebrow">IdentityRegistry</div>
            <h2 className="sec-title">Five verification tiers. One registry.</h2>
            <p className="body-text" style={{ maxWidth: 520 }}>
              Identity is registered once and shared across every asset on the protocol. Upgrading a
              wallet from KYC to ACCREDITED immediately unlocks every asset that requires that
              clearance.
            </p>
          </div>
          <div
            className="three-col"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}
          >
            {TIERS.map((tier, i) => (
              <div
                key={tier.name}
                id={`tier${i}`}
                data-reveal
                className="glass-card"
                style={{ padding: '18px 16px', ...rv(`tier${i}`, i * 65) }}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 9,
                    fontWeight: 500,
                    color: tier.c,
                    letterSpacing: '0.12em',
                    marginBottom: 10,
                  }}
                >
                  {tier.name}
                </div>
                <p style={{ fontSize: 12, color: '#8896B3', lineHeight: 1.65 }}>{tier.desc}</p>
              </div>
            ))}
          </div>
          <div id="id-body" data-reveal style={{ marginTop: 40, ...rv('id-body', 80) }}>
            <p className="body-text" style={{ marginBottom: 18 }}>
              Tier upgrades are unidirectional — the contract enforces that a wallet can only move
              to a higher tier, never downgrade. This prevents a compliance officer from accidentally
              removing access from an investor who qualifies for institutional clearance.
            </p>
            <p className="body-text">
              Each identity record includes a `kycExpiry` timestamp. Once that timestamp passes, the
              wallet is treated as non-compliant even if it is active and whitelisted. The
              `renewKYC()` function refreshes this expiry — no re-registration required.
            </p>
          </div>
        </div>
      </Sec>

      {/* ═══ ASSET TYPES ═══ */}
      <Sec
        id="assets"
        style={{
          padding: '72px 24px',
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
        }}
      >
        <div className="sec-wide">
          <div id="at-hdr" data-reveal style={{ marginBottom: 40, ...rv('at-hdr') }}>
            <div className="eyebrow">AssetRegistry</div>
            <h2 className="sec-title">Four asset classes. One ledger.</h2>
          </div>
          <div
            className="two-col"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            {ASSET_TYPES.map((a, i) => (
              <div
                key={a.name}
                id={`at${i}`}
                data-reveal
                className="glass-card"
                style={{ padding: '22px 20px', ...rv(`at${i}`, i * 70) }}
              >
                <div
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    fontSize: 15,
                    color: a.c,
                    marginBottom: 10,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {a.name}
                </div>
                <p style={{ fontSize: 13.5, color: '#8896B3', lineHeight: 1.72 }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      {/* ═══ YIELD ═══ */}
      <Sec id="yield" style={{ padding: '72px 24px' }}>
        <div className="sec-narrow">
          <div id="yield-hdr" data-reveal style={rv('yield-hdr')}>
            <div className="eyebrow">YieldDistributor</div>
            <h2 className="sec-title">Yield that scales to any number of holders.</h2>
          </div>
          <div id="yield-body" data-reveal style={rv('yield-body', 90)}>
            <p className="body-text" style={{ marginBottom: 20 }}>
              Paying yield to ten thousand holders in a single loop transaction would exceed the
              block gas limit and never land. YieldDistributor.sol approaches the problem
              differently. The full distribution list — every investor and their exact allocation —
              is computed off-chain and committed to a 32-byte Merkle root stored on-chain. The
              protocol holds the cryptographic fingerprint; the proof lives with the user.
            </p>
            <p className="body-text" style={{ marginBottom: 20 }}>
              When an investor wants to claim, they submit their allocation amount alongside a
              Merkle proof generated by the frontend. The contract verifies the proof against the
              stored root — a constant-gas operation that does not depend on protocol size. Whether
              the distributor has ten holders or a hundred thousand, the gas cost to claim is
              identical.
            </p>
            <div
              style={{
                borderLeft: '2px solid rgba(245,166,35,0.5)',
                paddingLeft: 22,
                paddingTop: 16,
                paddingBottom: 16,
                background: 'rgba(245,166,35,0.04)',
                borderRadius: '0 12px 12px 0',
                margin: '28px 0',
              }}
            >
              <p
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 'clamp(14px,2vw,18px)',
                  fontWeight: 600,
                  color: '#F5E4BB',
                  lineHeight: 1.58,
                }}
              >
                Epoch cycles are advanced automatically by Chainlink Automation. When the scheduled
                interval passes, the Chainlink node calls `performUpkeep()` which opens the next
                epoch. No operator, no cron job, no multisig.
              </p>
            </div>
            <p className="body-text">
              Double-spending is prevented by writing `s_hasClaimed[epochId][investor] = true`
              before the token transfer. Any reentrant claim attempt finds the flag set and reverts
              with `AlreadyClaimed`. Batch claiming across up to 50 epochs is supported in a single
              transaction, with all state updates processed before any external transfer call.
            </p>
          </div>
        </div>
      </Sec>

      {/* ═══ NAV ORACLE ═══ */}
      <Sec
        id="oracle"
        style={{
          padding: '72px 24px',
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
        }}
      >
        <div className="sec-narrow">
          <div id="oracle-hdr" data-reveal style={rv('oracle-hdr')}>
            <div className="eyebrow">NAVOracle</div>
            <h2 className="sec-title">The circuit breaker is autonomous.</h2>
          </div>
          <div id="oracle-body" data-reveal style={rv('oracle-body', 90)}>
            <p className="body-text" style={{ marginBottom: 20 }}>
              NAVOracle integrates with Chainlink Data Feeds to provide real-time Net Asset Value
              for each registered asset. Every price read is validated for round completeness — the
              `answeredInRound` must equal the `roundId` — and staleness. Any price older than one
              hour reverts with `StalePriceFeed`.
            </p>
            <p className="body-text" style={{ marginBottom: 20 }}>
              The circuit breaker adds a second layer of protection against oracle manipulation and
              flash crashes. The oracle stores a price snapshot every 24 hours. If any subsequent
              read comes in more than 15% below that snapshot — within the same 24-hour window —
              the breaker trips and all NAV reads for that asset revert. Nothing downstream can act
              on a crashed price.
            </p>
            <p className="body-text">
              Resetting the breaker requires a manual call from the guardian address. This friction
              is intentional. Automated systems that depend on NAV — lending protocols, yield
              calculators, margin engines — should not silently resume after a 15% drop. A human
              needs to review what happened first.
            </p>
          </div>
        </div>
      </Sec>

      {/* ═══ DESIGN PHILOSOPHY ═══ */}
      <Sec id="philosophy" style={{ padding: '72px 24px' }}>
        <div className="sec-wide">
          <div id="phi-hdr" data-reveal style={{ marginBottom: 44, ...rv('phi-hdr') }}>
            <div className="eyebrow">Design Decisions</div>
            <h2 className="sec-title">Why it was built this way.</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {PRINCIPLES.map((p, i) => (
              <div
                key={p.num}
                id={`phi${i}`}
                data-reveal
                className="glass-card"
                style={{ padding: '22px 20px', ...rv(`phi${i}`, i * 65) }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div
                    style={{
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      fontSize: 20,
                      color: `${p.c}44`,
                      lineHeight: 1,
                      flexShrink: 0,
                      paddingTop: 3,
                    }}
                  >
                    {p.num}
                  </div>
                  <div>
                    <h3
                      style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 700,
                        fontSize: 'clamp(14px,1.8vw,18px)',
                        color: p.c,
                        letterSpacing: '-0.02em',
                        marginBottom: 10,
                        lineHeight: 1.2,
                      }}
                    >
                      {p.title}
                    </h3>
                    <p style={{ fontSize: 'clamp(13px,1.4vw,14.5px)', color: '#8896B3', lineHeight: 1.78 }}>
                      {p.body}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      {/* ═══ SECURITY ═══ */}
      <Sec
        id="security"
        style={{
          padding: '72px 24px',
          background: 'rgba(255,255,255,0.018)',
          borderTop: '1px solid rgba(255,255,255,0.055)',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
        }}
      >
        <div className="sec-narrow">
          <div id="sec-hdr" data-reveal style={rv('sec-hdr')}>
            <div className="eyebrow">Testing and Auditing</div>
            <h2 className="sec-title" style={{ marginBottom: 22 }}>
              219 tests. 5,000 randomised sequences. Zero critical findings.
            </h2>
          </div>
          <div id="sec-body" data-reveal style={rv('sec-body', 80)}>
            <p className="body-text" style={{ marginBottom: 20 }}>
              Every state-changing function follows the Checks-Effects-Interactions pattern without
              exception. All validation happens first. All storage writes happen second. All external
              calls happen last. Reentrancy guards are applied at the function level on every
              path that moves tokens or updates accounting state.
            </p>
            <p className="body-text" style={{ marginBottom: 32 }}>
              Beyond unit tests, the protocol's core invariants are verified through stateful
              invariant fuzzing — 5,000 randomised call sequences exercising every possible ordering
              of mint, transfer, burn, whitelist, and blacklist operations. If any sequence can
              breach a supply cap, give tokens to a blocked investor, or allow a double yield claim,
              the fuzzer will find it.
            </p>
            <h3
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 'clamp(15px,2vw,20px)',
                color: '#F4F7FF',
                marginBottom: 16,
              }}
            >
              Core invariants verified by the fuzzer
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SECURITY_INVARIANTS.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: '14px 16px',
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#34D399',
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  />
                  <div>
                    <div
                      style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 600,
                        fontSize: 13,
                        color: '#E8EDF8',
                        marginBottom: 4,
                      }}
                    >
                      {item.inv}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#8896B3', lineHeight: 1.65 }}>
                      {item.how}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 24,
                padding: '14px 16px',
                borderRadius: 12,
                background: 'rgba(239,68,68,0.04)',
                border: '1px solid rgba(239,68,68,0.15)',
              }}
            >
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  color: 'rgba(239,68,68,0.65)',
                  letterSpacing: '0.12em',
                  marginBottom: 8,
                }}
              >
                DISCLAIMER
              </div>
              <p style={{ fontSize: 12.5, color: '#8896B3', lineHeight: 1.7 }}>
                The protocol implements production-grade security patterns, CEI across all contracts,
                and has been statically analysed with Slither at zero critical or high severity.
                It has not undergone a formal external audit. Do not deploy against real capital
                without engaging a professional smart contract auditing firm.
              </p>
            </div>
          </div>
        </div>
      </Sec>

      {/* ═══ CTA ═══ */}
      <section
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '80px 24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 440,
            height: 440,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,108,246,0.06) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div
          id="cta-block"
          data-reveal
          style={{
            position: 'relative',
            zIndex: 1,
            maxWidth: 520,
            margin: '0 auto',
            ...rv('cta-block'),
          }}
        >
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              color: 'rgba(136,150,179,0.5)',
              letterSpacing: '0.2em',
              marginBottom: 22,
            }}
          >
            BASE MAINNET · CHAIN ID 8453
          </div>
          <h2
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 'clamp(24px,4vw,48px)',
              letterSpacing: '-0.035em',
              color: '#F4F7FF',
              marginBottom: 16,
              lineHeight: 1.06,
            }}
          >
            Deploy on compliant rails.
          </h2>
          <p
            style={{
              fontSize: 'clamp(13.5px,1.5vw,15.5px)',
              color: '#8896B3',
              lineHeight: 1.75,
              marginBottom: 30,
            }}
          >
            Nexus RWA is live and operational. Connect a wallet to interact with the protocol, or
            read every contract on GitHub.
          </p>
          <div
            style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}
          >
            <a
              href="/"
              style={{
                padding: '12px 24px',
                borderRadius: 11,
                background: '#3B6CF6',
                color: '#fff',
                fontSize: 14,
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
                textDecoration: 'none',
                letterSpacing: '-0.01em',
                transition: 'background 0.18s, transform 0.18s',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = '#4B7BF7';
                el.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = '#3B6CF6';
                el.style.transform = 'none';
              }}
            >
              Open App
            </a>
            <a
              href="https://github.com/NexTechArchitects/Nexus-RWA-Protocol"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '12px 20px',
                borderRadius: 11,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#8896B3',
                fontSize: 14,
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 500,
                textDecoration: 'none',
                transition: 'all 0.18s',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(255,255,255,0.09)';
                el.style.color = '#F4F7FF';
                el.style.borderColor = 'rgba(255,255,255,0.18)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.background = 'rgba(255,255,255,0.05)';
                el.style.color = '#8896B3';
                el.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Source Code
            </a>
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '18px 24px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(11,14,26,0.88)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              fontWeight: 500,
              color: '#34D399',
              padding: '3px 8px',
              borderRadius: 5,
              background: 'rgba(52,211,153,0.1)',
              border: '1px solid rgba(52,211,153,0.2)',
              letterSpacing: '0.1em',
            }}
          >
            BASE MAINNET
          </span>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'rgba(136,150,179,0.5)',
            }}
          >
            Nexus RWA Protocol Documentation
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <a
            href="/"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'rgba(136,150,179,0.5)',
              textDecoration: 'none',
              transition: 'color 0.18s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#F4F7FF')}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'rgba(136,150,179,0.5)')
            }
          >
            Back to App
          </a>
          <a
            href="https://github.com/NexTechArchitects/Nexus-RWA-Protocol"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'rgba(136,150,179,0.5)',
              textDecoration: 'none',
              transition: 'color 0.18s',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#F4F7FF')}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'rgba(136,150,179,0.5)')
            }
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            NexTechArchitects
          </a>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              color: 'rgba(136,150,179,0.35)',
            }}
          >
            2026
          </span>
        </div>
      </footer>
    </>
  );
}