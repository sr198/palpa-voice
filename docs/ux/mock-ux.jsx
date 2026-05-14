import React, { useState } from 'react';
import {
  Box, GitBranch, Layers, Bot, ShieldCheck, Activity, Search, Lock, Mic, Hand,
  Plus, ChevronRight, AlertTriangle, FileCode, Sparkles, CheckCircle2, Circle,
  MoreHorizontal, Command, Radio, Pin, ArrowUpRight, Dot,
} from 'lucide-react';

// ─── Token reference (mirrored in CSS vars below) ──────────────────────────
// surface-0 #0A0B0D · surface-1 #101216 · surface-2 #16191F · surface-3 #1C1F26
// border-subtle #1A1D23 · border #262A33 · border-strong #353A45
// text-1 #ECEEF1 · text-2 #9AA0A8 · text-3 #6A6F78 · text-4 #4A4E56
// brand #7C6BFF · brand-hi #9B8DFF · brand-tint rgba(124,107,255,0.10)
// success #10B981 · danger #EF4444 · warning #F59E0B · info #06B6D4 · gate #A78BFA
// ───────────────────────────────────────────────────────────────────────────

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');

:root {
  --s0:#0A0B0D; --s1:#101216; --s2:#16191F; --s3:#1C1F26; --s4:#22262F;
  --b-sub:#1A1D23; --b:#262A33; --b-st:#353A45;
  --t1:#ECEEF1; --t2:#9AA0A8; --t3:#6A6F78; --t4:#4A4E56;
  --brand:#7C6BFF; --brand-hi:#9B8DFF; --brand-tint:rgba(124,107,255,0.10);
  --success:#10B981; --danger:#EF4444; --warning:#F59E0B; --info:#06B6D4; --gate:#A78BFA;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; background: var(--s0); }
body { font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif; color: var(--t1); -webkit-font-smoothing: antialiased; font-feature-settings: "ss01","cv11"; }
.mono { font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace; font-feature-settings: "zero","ss01"; }
.hairline { box-shadow: inset 0 0 0 1px var(--b); }
.hairline-sub { box-shadow: inset 0 0 0 1px var(--b-sub); }
.scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.scroll::-webkit-scrollbar-thumb { background: #2a2e37; border-radius: 4px; }
.scroll::-webkit-scrollbar-track { background: transparent; }
.dot-grid {
  background-image: radial-gradient(circle, #1f232a 1px, transparent 1px);
  background-size: 14px 14px;
  background-position: -7px -7px;
}
.pulse-dot { animation: pulse 1.8s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.shimmer { background: linear-gradient(90deg, transparent, rgba(124,107,255,0.06), transparent); background-size: 200% 100%; animation: shimmer 3s linear infinite; }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.brand-ring { box-shadow: 0 0 0 1px var(--brand), 0 0 0 4px rgba(124,107,255,0.12); }
.kbd { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--t2); background: var(--s3); padding: 1px 5px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--b); }
.lift { transition: transform .15s ease, box-shadow .15s ease; }
.lift:hover { transform: translateY(-1px); }
.uplabel { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t3); font-weight: 500; }
`;

// ── primitives ─────────────────────────────────────────────────────────────

const TypeChip = ({ kind }) => {
  const map = {
    capability: { bg: 'rgba(124,107,255,0.10)', fg: '#9B8DFF', label: 'CAP' },
    feature:    { bg: 'rgba(124,107,255,0.06)', fg: '#B4ABFF', label: 'FEAT' },
    risk:       { bg: 'rgba(245,158,11,0.10)',  fg: '#F5B547', label: 'RISK' },
    decision:   { bg: 'rgba(16,185,129,0.08)',  fg: '#34D5A4', label: 'DEC' },
    manifest:   { bg: 'rgba(6,182,212,0.08)',   fg: '#3FC2DA', label: 'MANIFEST' },
    work:       { bg: '#1C1F26',                fg: '#9AA0A8', label: 'WORK' },
    gate:       { bg: 'rgba(167,139,250,0.10)', fg: '#A78BFA', label: 'GATE' },
  };
  const s = map[kind];
  return (
    <span className="mono" style={{
      fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 600,
      padding: '2px 6px', borderRadius: 3, background: s.bg, color: s.fg,
    }}>{s.label}</span>
  );
};

const StatusPill = ({ status }) => {
  const map = {
    draft:     { fg: '#9AA0A8', dot: '#6A6F78' },
    proposed:  { fg: '#9B8DFF', dot: '#7C6BFF' },
    locked:    { fg: '#34D5A4', dot: '#10B981' },
    executing: { fg: '#3FC2DA', dot: '#06B6D4' },
    blocked:   { fg: '#F08080', dot: '#EF4444' },
    pending:   { fg: '#F5B547', dot: '#F59E0B' },
    approved:  { fg: '#34D5A4', dot: '#10B981' },
  };
  const s = map[status];
  return (
    <span className="mono" style={{ fontSize: 10.5, color: s.fg, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, display: 'inline-block' }} />
      {status}
    </span>
  );
};

const HumanChip = ({ initials, name, size = 'sm' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{
      width: size === 'sm' ? 18 : 22, height: size === 'sm' ? 18 : 22, borderRadius: '50%',
      background: '#2A2E37', color: '#ECEEF1', fontSize: 9.5, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: 'inset 0 0 0 1px #353A45',
    }}>{initials}</span>
    {name && <span style={{ fontSize: 12, color: 'var(--t2)' }}>{name}</span>}
  </span>
);

const AgentChip = ({ role, provider, size = 'sm' }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{
      width: size === 'sm' ? 18 : 22, height: size === 'sm' ? 18 : 22, borderRadius: 4,
      background: '#0E1217', color: '#3FC2DA', fontSize: 10, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: 'inset 0 0 0 1px rgba(6,182,212,0.35)',
    }}>
      <Sparkles size={size === 'sm' ? 10 : 12} strokeWidth={2.2} />
    </span>
    <span style={{ fontSize: 12, color: 'var(--t2)' }}>
      {role} <span className="mono" style={{ color: 'var(--t3)', marginLeft: 4 }}>· {provider}</span>
    </span>
  </span>
);

const EvidenceChip = ({ icon: Icon, label }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11,
    color: 'var(--t2)', padding: '3px 7px', borderRadius: 4,
    background: 'var(--s3)', boxShadow: 'inset 0 0 0 1px var(--b)',
  }} className="lift">
    <Icon size={11} strokeWidth={1.8} />
    <span className="mono" style={{ fontSize: 10.5 }}>{label}</span>
  </span>
);

// ── left rail ──────────────────────────────────────────────────────────────

const navItems = [
  { id: 'studio',    icon: Box,         label: 'Studio',    active: true },
  { id: 'graph',     icon: GitBranch,   label: 'Graph' },
  { id: 'work',      icon: Layers,      label: 'Work' },
  { id: 'agents',    icon: Bot,         label: 'Agents' },
  { id: 'assurance', icon: ShieldCheck, label: 'Assurance' },
  { id: 'operate',   icon: Activity,    label: 'Operate' },
];

const LeftRail = () => (
  <aside style={{ width: 52, background: 'var(--s0)', borderRight: '1px solid var(--b-sub)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, paddingBottom: 10, flexShrink: 0 }}>
    <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #7C6BFF 0%, #5B4ED0 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 4px 16px rgba(124,107,255,0.20)' }}>
      <span style={{ fontFamily: 'Geist Mono, monospace', fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '-0.02em' }}>P</span>
    </div>
    <div style={{ height: 16 }} />
    <div style={{ width: 28, height: 1, background: 'var(--b-sub)' }} />
    <div style={{ height: 12 }} />
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      {navItems.map(({ id, icon: Icon, label, active }) => (
        <button key={id} title={label} style={{
          width: 32, height: 32, borderRadius: 7, border: 0, cursor: 'pointer',
          background: active ? 'var(--brand-tint)' : 'transparent',
          color: active ? 'var(--brand-hi)' : 'var(--t3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: active ? 'inset 0 0 0 1px rgba(124,107,255,0.30)' : 'none',
          transition: 'all .12s ease',
        }}>
          <Icon size={16} strokeWidth={1.8} />
        </button>
      ))}
    </nav>
    <button style={{ width: 32, height: 32, borderRadius: 7, border: 0, background: 'transparent', color: 'var(--t3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Command">
      <Command size={15} strokeWidth={1.8} />
    </button>
    <div style={{ height: 8 }} />
    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#3A2F1E', color: '#E89B4C', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px #4A3D26' }}>MK</div>
  </aside>
);

// ── top bar ────────────────────────────────────────────────────────────────

const TopBar = () => (
  <header style={{ height: 44, background: 'var(--s0)', borderBottom: '1px solid var(--b-sub)', display: 'flex', alignItems: 'center', paddingLeft: 16, paddingRight: 12, gap: 12, flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
      <span style={{ color: 'var(--t2)' }}>Acme Commerce</span>
      <ChevronRight size={12} color="var(--t4)" />
      <span style={{ color: 'var(--t2)' }}>Subscription Billing</span>
      <ChevronRight size={12} color="var(--t4)" />
      <span style={{ color: 'var(--t1)', fontWeight: 500 }}>Refactor recurring charge retry logic</span>
      <span className="mono" style={{ color: 'var(--t4)', marginLeft: 8, fontSize: 11 }}>HUD-218</span>
    </div>

    <div style={{ flex: 1 }} />

    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 5, background: 'rgba(239,68,68,0.08)', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.20)' }}>
      <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
      <span className="mono" style={{ fontSize: 10.5, color: '#F08080', letterSpacing: '0.06em' }}>LIVE · 12:14</span>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', marginLeft: 4 }}>
      {[
        { initials: 'MA', color: '#3A2F1E', fg: '#E89B4C' },
        { initials: 'RJ', color: '#1E2E3A', fg: '#7DB4D8' },
        { initials: 'SO', color: '#2E1E3A', fg: '#B89BD8' },
      ].map((p, i) => (
        <div key={i} style={{
          width: 22, height: 22, borderRadius: '50%', background: p.color, color: p.fg,
          fontSize: 9.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 2px var(--s0)`,
          marginLeft: i === 0 ? 0 : -6, zIndex: 4 - i,
        }}>{p.initials}</div>
      ))}
      <div style={{
        width: 22, height: 22, borderRadius: 5, background: '#0E1217', color: '#3FC2DA',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(6,182,212,0.40), 0 0 0 2px var(--s0)',
        marginLeft: -6, zIndex: 0,
      }}><Sparkles size={11} strokeWidth={2.2} /></div>
    </div>

    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 5, background: 'var(--s1)', boxShadow: 'inset 0 0 0 1px var(--b-sub)', minWidth: 200 }}>
      <Search size={12} color="var(--t3)" />
      <span style={{ fontSize: 12, color: 'var(--t3)', flex: 1 }}>Search graph</span>
      <span className="kbd">⌘K</span>
    </div>
  </header>
);

// ── huddle sub-header ──────────────────────────────────────────────────────

const HuddleSubBar = () => (
  <div style={{ height: 40, background: 'var(--s0)', borderBottom: '1px solid var(--b-sub)', display: 'flex', alignItems: 'center', paddingLeft: 16, paddingRight: 12, gap: 14, flexShrink: 0 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Radio size={13} color="var(--brand-hi)" strokeWidth={1.8} />
      <span style={{ fontSize: 12.5, color: 'var(--t1)', fontWeight: 500 }}>Huddle</span>
      <span style={{ color: 'var(--t4)' }}>·</span>
      <span className="uplabel">Floor</span>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 4, background: 'rgba(124,107,255,0.08)', boxShadow: 'inset 0 0 0 1px rgba(124,107,255,0.25)' }}>
        <Sparkles size={10} color="#3FC2DA" strokeWidth={2.2} />
        <span style={{ fontSize: 11, color: 'var(--t1)' }}>Architecture Agent</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>· Claude</span>
      </div>
      <span style={{ color: 'var(--t4)' }}>·</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>granted by Sofia · 14:04</span>
    </div>

    <div style={{ flex: 1 }} />

    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button style={{ padding: '5px 10px', fontSize: 11.5, color: 'var(--t2)', background: 'var(--s1)', border: 0, borderRadius: 5, boxShadow: 'inset 0 0 0 1px var(--b-sub)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Hand size={11} strokeWidth={1.8} /> Request floor
      </button>
      <button style={{ padding: '5px 10px', fontSize: 11.5, color: 'var(--t2)', background: 'var(--s1)', border: 0, borderRadius: 5, boxShadow: 'inset 0 0 0 1px var(--b-sub)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <Mic size={11} strokeWidth={1.8} /> Mic
      </button>
      <button style={{ padding: '5px 12px', fontSize: 11.5, color: '#fff', background: 'var(--brand)', border: 0, borderRadius: 5, cursor: 'pointer', fontWeight: 500, boxShadow: '0 0 0 1px rgba(255,255,255,0.06), 0 1px 0 rgba(0,0,0,0.20)' }}>
        Lock plan
      </button>
    </div>
  </div>
);

// ── canvas node card ───────────────────────────────────────────────────────

const NodeCard = ({ kind, id, title, body, status, actor, selected, footer, style }) => (
  <div style={{
    position: 'absolute', borderRadius: 8, background: 'var(--s1)',
    boxShadow: selected
      ? 'inset 0 0 0 1px var(--brand), 0 0 0 4px rgba(124,107,255,0.10), 0 8px 32px rgba(0,0,0,0.40)'
      : 'inset 0 0 0 1px var(--b), 0 1px 0 rgba(255,255,255,0.02)',
    padding: 12, cursor: 'pointer', transition: 'all .15s ease', ...style,
  }} className="lift">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <TypeChip kind={kind} />
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>{id}</span>
      <div style={{ flex: 1 }} />
      {status && <StatusPill status={status} />}
    </div>
    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--t1)', lineHeight: 1.35, marginBottom: body ? 6 : 0 }}>{title}</div>
    {body && <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45 }}>{body}</div>}
    {(actor || footer) && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--b-sub)' }}>
        {actor}
        <div style={{ flex: 1 }} />
        {footer}
      </div>
    )}
  </div>
);

// ── canvas ─────────────────────────────────────────────────────────────────

const Canvas = () => (
  <section style={{ position: 'relative', background: 'var(--s0)', borderRight: '1px solid var(--b-sub)', overflow: 'hidden', minWidth: 0 }} className="dot-grid">
    {/* canvas tool strip */}
    <div style={{ position: 'absolute', top: 12, left: 16, display: 'flex', alignItems: 'center', gap: 8, zIndex: 10 }}>
      <span className="uplabel">Typed canvas</span>
      <span style={{ color: 'var(--t4)' }}>·</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>5 nodes · 4 edges</span>
    </div>
    <div style={{ position: 'absolute', top: 12, right: 16, display: 'flex', alignItems: 'center', gap: 6, zIndex: 10 }}>
      <button style={{ width: 26, height: 26, borderRadius: 5, background: 'var(--s1)', border: 0, color: 'var(--t2)', boxShadow: 'inset 0 0 0 1px var(--b-sub)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Plus size={13} strokeWidth={1.8} /></button>
      <button style={{ width: 26, height: 26, borderRadius: 5, background: 'var(--s1)', border: 0, color: 'var(--t2)', boxShadow: 'inset 0 0 0 1px var(--b-sub)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Pin size={12} strokeWidth={1.8} /></button>
    </div>

    {/* edges svg */}
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#353A45" />
        </marker>
        <marker id="arrow-brand" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#7C6BFF" />
        </marker>
      </defs>
      {/* CAP-218 → FEAT-441 */}
      <path d="M 260 110 C 305 110, 305 130, 350 130" stroke="#2A2E37" strokeWidth="1" fill="none" markerEnd="url(#arrow)" />
      {/* FEAT-441 → RISK-09 */}
      <path d="M 560 130 C 605 130, 605 150, 650 150" stroke="#2A2E37" strokeWidth="1" fill="none" markerEnd="url(#arrow)" />
      {/* RISK-09 → DEC-77 (highlighted, brand) */}
      <path d="M 760 200 C 760 240, 760 260, 760 300" stroke="#7C6BFF" strokeWidth="1.2" fill="none" markerEnd="url(#arrow-brand)" strokeDasharray="0" />
      {/* FEAT-441 → MANIFEST */}
      <path d="M 460 200 C 460 250, 240 250, 240 330" stroke="#2A2E37" strokeWidth="1" fill="none" markerEnd="url(#arrow)" strokeDasharray="3 3" />
      {/* DEC-77 → WORK preview */}
      <path d="M 760 410 C 760 440, 540 440, 540 360" stroke="#2A2E37" strokeWidth="1" fill="none" markerEnd="url(#arrow)" />
    </svg>

    <NodeCard
      kind="capability" id="CAP-218" title="Subscription Billing"
      body="Parent capability. Owns recurring charge lifecycle."
      status="locked"
      actor={<HumanChip initials="MA" name="Maya" />}
      footer={<span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>3 features · 2 services</span>}
      style={{ left: 40, top: 70, width: 220 }}
    />

    <NodeCard
      kind="feature" id="FEAT-441" title="Retry recurring charges with backoff"
      body="Card declines spike on the 1st; need bounded retries without double-charge."
      status="proposed"
      actor={<HumanChip initials="MA" name="Maya" />}
      style={{ left: 350, top: 80, width: 210 }}
    />

    <NodeCard
      kind="risk" id="RISK-09" title="PCI exposure during retry"
      body="Retries past auth could re-expose card data."
      status="pending"
      actor={<AgentChip role="Architecture" provider="Claude" />}
      style={{ left: 650, top: 80, width: 210 }}
    />

    <NodeCard
      kind="decision" id="DEC-77"
      title="Exponential backoff with jitter; dedupe via existing IdempotencyKey"
      body="Scope retries to declines only — never post-auth failures."
      status="locked"
      actor={<HumanChip initials="SO" name="Sofia" />}
      footer={<span className="mono" style={{ fontSize: 10.5, color: 'var(--brand-hi)' }}>resolves RISK-09</span>}
      selected
      style={{ left: 650, top: 300, width: 220 }}
    />

    <NodeCard
      kind="manifest" id="services/billing-svc"
      title="billing-svc / manifest.yaml"
      body="C4: Subscription Billing · 2 endpoints touched"
      actor={<span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>v2.14.0 · main</span>}
      style={{ left: 130, top: 330, width: 220 }}
    />

    <div style={{ position: 'absolute', left: 410, top: 300, width: 200, padding: 10, borderRadius: 8, background: 'var(--s1)', boxShadow: 'inset 0 0 0 1px var(--b-sub)', opacity: 0.85 }} className="shimmer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <TypeChip kind="work" />
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>WORK-1124</span>
        <div style={{ flex: 1 }} />
        <StatusPill status="draft" />
      </div>
      <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.4 }}>Wire retry scheduler into billing-svc</div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--t4)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Sparkles size={10} color="#3FC2DA" strokeWidth={2.2} />
        <span className="mono">drafting…</span>
      </div>
    </div>
  </section>
);

// ── transcript ─────────────────────────────────────────────────────────────

const TranscriptTurn = ({ ts, who, body, kind = 'speech', evidence }) => {
  if (kind === 'decision') {
    return (
      <div style={{ padding: '10px 14px', borderLeft: '2px solid var(--success)', background: 'rgba(16,185,129,0.04)', margin: '6px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Lock size={11} color="#34D5A4" strokeWidth={2} />
          <span className="uplabel" style={{ color: '#34D5A4' }}>Decision captured</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>{ts}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--t1)', lineHeight: 1.4 }}>{body}</div>
      </div>
    );
  }
  if (kind === 'floor') {
    return (
      <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Hand size={11} color="var(--brand-hi)" strokeWidth={1.8} />
        <span className="uplabel" style={{ color: 'var(--brand-hi)' }}>Floor request</span>
        <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>{who}</span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--t4)', marginLeft: 'auto' }}>{ts}</span>
      </div>
    );
  }
  const isAgent = who?.role === 'agent';
  return (
    <div style={{ padding: '10px 14px', display: 'flex', gap: 10 }}>
      <div style={{ marginTop: 2 }}>
        {isAgent
          ? <div style={{ width: 22, height: 22, borderRadius: 5, background: '#0E1217', color: '#3FC2DA', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(6,182,212,0.40)' }}><Sparkles size={11} strokeWidth={2.2} /></div>
          : <div style={{ width: 22, height: 22, borderRadius: '50%', background: who.bg, color: who.fg, fontSize: 9.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}>{who.initials}</div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--t1)' }}>{who.name}</span>
          {isAgent && <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>· {who.role_label}</span>}
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--t4)', marginLeft: 'auto' }}>{ts}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--t2)', lineHeight: 1.5 }}>{body}</div>
        {evidence && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {evidence.map((e, i) => <EvidenceChip key={i} icon={e.icon} label={e.label} />)}
          </div>
        )}
      </div>
    </div>
  );
};

const Transcript = () => (
  <div style={{ background: 'var(--s0)', borderBottom: '1px solid var(--b-sub)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--b-sub)' }}>
      <span className="uplabel">Transcript</span>
      <span style={{ color: 'var(--t4)' }}>·</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>auto · en-US</span>
      <div style={{ flex: 1 }} />
      <MoreHorizontal size={14} color="var(--t3)" />
    </div>
    <div className="scroll" style={{ flex: 1, overflowY: 'auto' }}>
      <TranscriptTurn ts="14:02" who={{ name: 'Maya', initials: 'MA', bg: '#3A2F1E', fg: '#E89B4C' }} body="We keep seeing card declines spike on the 1st of the month. We need retry logic that doesn't risk double-charging customers." />
      <TranscriptTurn ts="14:03" who={{ name: 'Raj', initials: 'RJ', bg: '#1E2E3A', fg: '#7DB4D8' }} body="Could we just key off the existing idempotency token per attempt window?" />
      <TranscriptTurn ts="14:04" kind="floor" who="Architecture Agent / Claude" />
      <TranscriptTurn
        ts="14:04"
        who={{ name: 'Architecture Agent', role: 'agent', role_label: 'Claude · architecture' }}
        body="Reviewed billing-svc manifest and the C4 fragment for Subscription Billing. The current retry path bypasses the dedupe table for failed-after-auth states — that's the risk vector. Recommend scoping retries to decline states only, never post-auth failures, and re-using the existing IdempotencyKey from the charges table. Drafting RISK-09 and a decision proposal."
        evidence={[
          { icon: FileCode, label: 'manifest.yaml' },
          { icon: GitBranch, label: 'C4 / Container' },
          { icon: AlertTriangle, label: 'RISK-09' },
        ]}
      />
      <TranscriptTurn ts="14:06" who={{ name: 'Sofia', initials: 'SO', bg: '#2E1E3A', fg: '#B89BD8' }} body="Agree with the scoping. Let's lock it as the approach." />
      <TranscriptTurn ts="14:06" kind="decision" body="Exponential backoff with jitter; dedupe via existing IdempotencyKey. Retries scoped to declines only." />
    </div>
  </div>
);

// ── outcomes ───────────────────────────────────────────────────────────────

const OutcomeRow = ({ kind, id, title, status, actor, right }) => (
  <div className="lift" style={{ padding: '10px 14px', borderBottom: '1px solid var(--b-sub)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
    <TypeChip kind={kind} />
    <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>{id}</span>
    <span style={{ fontSize: 12, color: 'var(--t1)', flex: 1, lineHeight: 1.35 }}>{title}</span>
    {actor}
    {status && <StatusPill status={status} />}
    {right}
  </div>
);

const GateRow = ({ name, status, evidence }) => {
  const isPass = status === 'passing';
  const isPending = status === 'pending';
  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--b-sub)', display: 'flex', alignItems: 'center', gap: 10 }}>
      {isPass
        ? <CheckCircle2 size={14} color="#34D5A4" strokeWidth={2} />
        : isPending
          ? <Circle size={14} color="#F5B547" strokeWidth={1.8} />
          : <Circle size={14} color="var(--t4)" strokeWidth={1.8} />
      }
      <span style={{ fontSize: 12, color: 'var(--t1)', flex: 1 }}>{name}</span>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>{evidence}</span>
      <StatusPill status={status === 'passing' ? 'approved' : 'pending'} />
    </div>
  );
};

const Outcomes = () => (
  <div style={{ background: 'var(--s0)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
    <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--b-sub)' }}>
      <span className="uplabel">Outcomes</span>
      <span style={{ color: 'var(--t4)' }}>·</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--t3)' }}>1 decision · 3 work · 3 gates</span>
      <div style={{ flex: 1 }} />
      <button style={{ fontSize: 11, color: 'var(--t2)', background: 'transparent', border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Inspect <ArrowUpRight size={11} />
      </button>
    </div>

    <div className="scroll" style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '10px 14px 6px', background: 'var(--s1)' }}>
        <span className="uplabel">Decision</span>
      </div>
      <OutcomeRow
        kind="decision" id="DEC-77"
        title="Exponential backoff with jitter; dedupe via existing IdempotencyKey"
        status="locked"
        actor={<HumanChip initials="SO" />}
      />

      <div style={{ padding: '10px 14px 6px', background: 'var(--s1)', borderTop: '1px solid var(--b-sub)' }}>
        <span className="uplabel">Draft work items</span>
      </div>
      <OutcomeRow kind="work" id="WORK-1124" title="Wire retry scheduler into billing-svc" status="draft" actor={<AgentChip role="" provider="Claude" />} />
      <OutcomeRow kind="work" id="WORK-1125" title="Add backoff config to billing manifest" status="draft" actor={<AgentChip role="" provider="Claude" />} />
      <OutcomeRow kind="work" id="WORK-1126" title="Audit charges table for orphaned retry rows" status="proposed" actor={<HumanChip initials="RJ" />} />

      <div style={{ padding: '10px 14px 6px', background: 'var(--s1)', borderTop: '1px solid var(--b-sub)' }}>
        <span className="uplabel">Gates</span>
      </div>
      <GateRow name="Architecture review" status="passing" evidence="C4 / manifest" />
      <GateRow name="PCI compliance review" status="pending" evidence="awaiting Sec" />
      <GateRow name="Test coverage ≥ 85%" status="pending" evidence="not yet run" />

      <div style={{ padding: '10px 14px 6px', background: 'var(--s1)', borderTop: '1px solid var(--b-sub)' }}>
        <span className="uplabel">Evidence</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <EvidenceChip icon={FileCode} label="billing-svc/manifest.yaml" />
        <EvidenceChip icon={GitBranch} label="C4 / Subscription Billing" />
        <EvidenceChip icon={Radio} label="HUD-218 transcript" />
        <EvidenceChip icon={AlertTriangle} label="RISK-09" />
      </div>
    </div>
  </div>
);

// ── compose ────────────────────────────────────────────────────────────────

export default function PalpaHuddle() {
  return (
    <>
      <style>{styles}</style>
      <div style={{ height: '100vh', width: '100%', display: 'flex', background: 'var(--s0)', color: 'var(--t1)', fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif", fontSize: 13 }}>
        <LeftRail />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TopBar />
          <HuddleSubBar />
          <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.35fr 1fr', minHeight: 0 }}>
            <Canvas />
            <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', minHeight: 0 }}>
              <Transcript />
              <Outcomes />
            </div>
          </main>
        </div>
      </div>
    </>
  );
}