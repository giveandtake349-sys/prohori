import { useEffect, useState, type ReactNode } from 'react';
import {
  checkShield,
  fetchShieldRadar,
  fetchShieldStats,
  fetchWatchdog,
  confirmScam,
  reportScam,
  issueGuarantee,
  type ShieldCheckResult,
  type RadarAlert,
  type ShieldStats,
  type LedgerItem,
} from './api';

/** V20 Shield — anti-scam system. Tabs: যাচাই | রাডার | শিল্ড | ওয়াচডগ. */

type Tab = 'check' | 'radar' | 'shield' | 'watchdog';

/** Chip hints — placeholder guidance per check type. */
const CHIP_HINTS: Record<string, string> = {
  offer: 'টেলিগ্রাম লিংক দাও…',
  number: 'নাম্বার দাও…',
  app: 'অ্যাপ লিংক দাও…',
  shop: 'পেজ / সাইট লিংক দাও…',
};

/** Line icons (feather-style) matching the app's circle-box buttons — no emojis. */
const ICO = {
  className: 'sh-ico',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
  width: 26,
  height: 26,
} as const;

const ICONS: Record<string, ReactNode> = {
  back: (<svg {...ICO} width={20} height={20}><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>),
  check: (<svg {...ICO}><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z" /><path d="M9 12l2 2 4-4" /></svg>),
  radar: (<svg {...ICO}><circle cx="12" cy="12" r="2" /><path d="M12 12l7-7" /><path d="M12 2a10 10 0 019.54 7" /><path d="M12 6a6 6 0 015.66 4" /></svg>),
  stats: (<svg {...ICO}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M2 20h20" /></svg>),
  scale: (<svg {...ICO}><path d="M12 3v18" /><path d="M5 7l7-4 7 4" /><path d="M5 7l-3 7a3.5 3.5 0 007 0L5 7z" /><path d="M19 7l-3 7a3.5 3.5 0 007 0l-4-7z" /></svg>),
  offer: (<svg {...ICO} width={22} height={22}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg>),
  number: (<svg {...ICO} width={22} height={22}><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.13.96.36 1.9.7 2.8a2 2 0 01-.45 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0122 16.9z" /></svg>),
  app: (<svg {...ICO} width={22} height={22}><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></svg>),
  shop: (<svg {...ICO} width={22} height={22}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 01-8 0" /></svg>),
};

const VERDICT_META: Record<string, { badge: string; cls: string; icon: string }> = {
  fraud: { badge: '🔴 SCAM', cls: 'red', icon: '🚨' },
  suspect: { badge: '🟡 সন্দেহজনক', cls: 'yellow', icon: '⚠️' },
  blacklisted: { badge: '⛔ BLACKLISTED', cls: 'red', icon: '🚫' },
  unknown: { badge: '❓ অজানা', cls: 'yellow', icon: '🔍' },
  clean: { badge: '✅ পরিষ্কার', cls: 'green', icon: '✓' },
};

function VerdictCard({ result, onReported, signedIn }: { result: ShieldCheckResult; onReported: () => void; signedIn: boolean }) {
  const meta = VERDICT_META[result.verdict] ?? VERDICT_META.unknown;
  const [reporting, setReporting] = useState(false);
  const [reportMsg, setReportMsg] = useState('');
  const [protecting, setProtecting] = useState(false);
  const [receiptCode, setReceiptCode] = useState('');
  const isSafe = result.verdict === 'clean' || result.verdict === 'unknown';
  const doReport = async () => {
    setReporting(true);
    setReportMsg('');
    try {
      await reportScam({
        type: result.type === 'text' ? 'offer' : result.type,
        value: result.entityId ?? result.title,
        title: result.title,
        details: result.reasons.join(' | '),
      });
      setReportMsg('রিপোর্ট জমা হয়েছে — moderator যাচাই করবে।');
      onReported();
    } catch (e) {
      setReportMsg(e instanceof Error ? e.message : 'রিপোর্ট করা যায়নি।');
    } finally {
      setReporting(false);
    }
  };
  return (
    <div className={`sh-verdict ${meta.cls}`}>
      <div className="sh-vtop">
        <span className="sh-vico">{meta.icon}</span>
        <div>
          <b>{result.title}</b>
          <span className="sh-vbadge">{meta.badge}</span>
          {typeof result.riskPct === 'number' && <span className="sh-risk">{result.riskPct}% risk</span>}
        </div>
      </div>
      <div className="sh-vstats">
        <div><b>{result.stats.reports}</b><small>রিপোর্ট</small></div>
        <div><b>{result.stats.confirms}</b><small>confirm</small></div>
        <div><b>{result.type}</b><small>ধরন</small></div>
      </div>
      {result.reasons.length > 0 && (
        <div className="sh-vwhy">
          <h4>কেন এই verdict</h4>
          <ul>{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      <div className="sh-vactions">
        {isSafe && !receiptCode && (
          <button
            type="button"
            className="hot protect"
            disabled={protecting}
            title="Safe verdict — ৳১০,০০০ guarantee receipt নাও"
            onClick={() => {
              if (!signedIn) {
                window.location.hash = '#/login';
                return;
              }
              if (!result.checkId || protecting) return;
              setProtecting(true);
              issueGuarantee(result.checkId)
                .then((d) => setReceiptCode(d.receipt.code))
                .catch((e) => setReportMsg(e instanceof Error ? e.message : 'Receipt করা যায়নি।'))
                .finally(() => setProtecting(false));
            }}
          >
            {protecting ? '…' : '🛡️ Protected করো'}
          </button>
        )}
        {receiptCode && (
          <a className="hot receipt-link" href="#/guarantee" title={receiptCode}>🧾 {receiptCode}</a>
        )}
        <button type="button" className="hot" onClick={() => {
          const text = `🛡️ Prohori Shield: "${result.title}" — ${meta.badge}. যাচাই করো: ${window.location.origin}${window.location.pathname}#/shield`;
          void navigator.clipboard?.writeText(text).then(() => setReportMsg('শেয়ার টেক্সট কপি হয়েছে।'));
        }}>⚠️ সবাইকে জানাও</button>
        <button type="button" disabled={reporting} onClick={() => void doReport()}>+ রিপোর্ট</button>
      </div>
      {reportMsg && <p className="sh-note">{reportMsg}</p>}
    </div>
  );
}

function CheckTab({ signedIn, initialInput }: { signedIn: boolean; initialInput?: string }) {
  const [input, setInput] = useState(initialInput ?? '');
  const [hintType, setHintType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShieldCheckResult | null>(null);
  const [error, setError] = useState('');
  const run = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await checkShield(input.trim());
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'যাচাই করা যায়নি।');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="sh-checker">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hintType ? CHIP_HINTS[hintType] : 'এখানে paste করো… (Telegram offer, phone number, app নাম, shop link)'}
          rows={3}
        />
        <div className="sh-cchips">
          {(['offer', 'number', 'app', 'shop'] as const).map((k) => (
            <button key={k} type="button" className={`sh-cchip${hintType === k ? ' on' : ''}`} onClick={() => setHintType(k)}>
              <span className="sh-cc">{ICONS[k]}</span>
              <small>{k === 'offer' ? 'Offer' : k === 'number' ? 'Number' : k === 'app' ? 'App' : 'Shop'}</small>
            </button>
          ))}
        </div>
        <button type="button" className="sh-checkbtn" disabled={busy || !input.trim()} onClick={() => void run()}>
          {busy ? 'যাচাই হচ্ছে…' : '🛡️ যাচাই করো'}
        </button>
        {!signedIn && <p className="sh-note">Login করলে তোমার শিল্ড stats জমবে। <a href="#/login">Login করো</a></p>}
      </div>
      {error && <p className="sh-err">{error}</p>}
      {result && <VerdictCard result={result} onReported={() => {}} signedIn={signedIn} />}
    </div>
  );
}

function RadarTab({ signedIn }: { signedIn: boolean }) {
  const [alerts, setAlerts] = useState<RadarAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState('সব');
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    fetchShieldRadar()
      .then((d) => setAlerts(d.alerts))
      .catch(() => setAlerts([]))
      .finally(() => setLoading(false));
  }, []);
  const shown = area === 'সব' ? alerts : alerts.filter((a) => (a.label ?? '').includes(area));
  const doConfirm = async (id: string) => {
    if (!signedIn) {
      window.location.hash = '#/login';
      return;
    }
    try {
      const r = await confirmScam(id);
      setConfirmed((c) => ({ ...c, [id]: true }));
      setAlerts((list) => list.map((a) => (a.id === id ? { ...a, confirmCount: r.confirmCount } : a)));
    } catch { /* ignore */ }
  };
  if (loading) return <p className="sh-state">লোড হচ্ছে…</p>;
  return (
    <div>
      <div className="sh-fchips">
        {['সব', 'ঢাকা', 'সারাদেশ'].map((a) => (
          <button key={a} type="button" className={`sh-fchip${area === a ? ' on' : ''}`} onClick={() => setArea(a)}>{a}</button>
        ))}
      </div>
      {shown.length === 0 && <p className="sh-state">এখনো কোনো active alert নাই — ভালো খবর!</p>}
      {shown.map((a) => (
        <div key={a.id} className={`sh-alert ${a.status === 'fraud' || a.status === 'blacklisted' ? 'crit' : 'warn'}`}>
          <div className="sh-atop">
            <span className="sh-sev">{a.status === 'fraud' || a.status === 'blacklisted' ? '🔴 ACTIVE' : '🟡 WATCH'}</span>
            <span className="sh-time">{a.verifiedAt ? new Date(a.verifiedAt).toLocaleDateString('bn-BD') : ''}</span>
          </div>
          <b>{a.label ?? a.type}</b>
          {a.type === 'number' && a.value && <code className="sh-num">{a.value}</code>}
          <div className="sh-arow">
            <button
              type="button"
              className={`sh-confirm${confirmed[a.id] ? ' done' : ''}`}
              disabled={!!confirmed[a.id]}
              onClick={() => void doConfirm(a.id)}
            >
              {confirmed[a.id] ? '✓ আমিও পেয়েছি' : 'আমিও পেয়েছি'}
            </button>
            <span className="sh-ccount">{a.confirmCount} confirm • {a.reportCount} রিপোর্ট</span>
          </div>
          {a.reports.slice(0, 2).map((r) => (
            <p key={r.id} className="sh-rep">“{r.title ?? r.details?.slice(0, 80)}”</p>
          ))}
        </div>
      ))}
    </div>
  );
}

function ShieldTab({ signedIn }: { signedIn: boolean }) {
  const [stats, setStats] = useState<ShieldStats | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    fetchShieldStats()
      .then((d) => { setStats(d.stats); setLedger(d.ledger); })
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [signedIn]);
  if (!signedIn) {
    return (
      <div className="sh-login">
        <p>🛡️ তোমার শিল্ড দেখতে login করো</p>
        <a className="sh-checkbtn" href="#/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Login করো</a>
      </div>
    );
  }
  if (loading) return <p className="sh-state">লোড হচ্ছে…</p>;
  const weekDots = [1, 1, 1, 1, 0, 0, 0]; // illustrative from streak
  return (
    <div>
      <div className="sh-card sh-level">
        <div className="sh-medal">🛡️</div>
        <b>{(stats?.streak ?? 0) >= 30 ? 'মহল্লা গার্ডিয়ান' : (stats?.streak ?? 0) >= 7 ? 'সতর্ক প্রহরী' : 'নতুন প্রহরী'}</b>
        <div className="sh-streak">🔥 {stats?.streak ?? 0} দিন streak</div>
        <div className="sh-week">
          {weekDots.map((hit, i) => <span key={i} className={hit ? 'hit' : ''}>{hit ? '✓' : ''}</span>)}
        </div>
      </div>
      <div className="sh-card">
        <div className="sh-statgrid">
          <div><b>{stats?.checks ?? 0}</b><small>যাচাই</small></div>
          <div><b>{stats?.dodged ?? 0}</b><small>scam এড়ানো</small></div>
          <div><b>৳{((stats?.savedEstimate ?? 0) / 1000).toFixed(0)}K</b><small>বাঁচানো</small></div>
        </div>
      </div>
      <div className="sh-card">
        <h4 className="sh-h4">💰 বাঁচানোর হিসাব</h4>
        {ledger.length === 0 && <p className="sh-state">এখনো scam এড়ানোর রেকর্ড নাই — check করতে থাকো!</p>}
        {ledger.map((l, i) => (
          <div key={i} className="sh-lrow">
            <div>{l.inputType === 'number' ? '📞 Fraud number' : l.inputType === 'app' ? '📱 ভুয়া app' : l.inputType === 'shop' ? '🛍️ সন্দেহজনক shop' : '💼 Scam offer'}
              <small>{new Date(l.createdAt).toLocaleDateString('bn-BD')}</small>
            </div>
            <span className="sh-amt">+৳{(l.savedEstimate / 1000).toFixed(0)}K</span>
          </div>
        ))}
        <button
          type="button"
          className="sh-sharebtn"
          onClick={() => {
            const text = `🛡️ Prohori Shield: আমি এখন পর্যন্ত ${stats?.dodged ?? 0} টা scam এড়িয়েছি, ৳${((stats?.savedEstimate ?? 0) / 1000).toFixed(0)}K বাঁচিয়েছি! তুমিও যাচাই করো: ${window.location.origin}${window.location.pathname}#/shield`;
            void navigator.clipboard?.writeText(text).then(() => alert('Shield card কপি হয়েছে — share করো!'));
          }}
        >
          📤 Shield Card Share করো
        </button>
      </div>
    </div>
  );
}

function WatchdogTab({ signedIn }: { signedIn: boolean }) {
  const [wall, setWall] = useState<RadarAlert[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchWatchdog()
      .then((d) => setWall(d.wall))
      .catch(() => setWall([]))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <p className="sh-state">লোড হচ্ছে…</p>;
  return (
    <div>
      <div className="sh-trust">🔒 প্রতিটি verify public log এ থাকে।<br /><b>যে watchdog কেনা যায় না।</b></div>
      {wall.length === 0 && <p className="sh-state">এখনো verified fraud নাই।</p>}
      {wall.map((e) => (
        <div key={e.id} className="sh-wcard">
          <div className="sh-wtop">
            <div><b>{e.label ?? e.type}</b><div className="sh-sub">{e.type}</div></div>
            <span className="sh-vbadge">{e.status === 'blacklisted' ? '⛔ BLACKLIST' : `${e.reportCount} রিপোর্ট`}</span>
          </div>
          <div className="sh-proof">
            <div><b>{e.reportCount}</b>রিপোর্ট</div>
            <div><b>{e.confirmCount}</b>confirm</div>
            <div><b>{e.verifiedAt ? new Date(e.verifiedAt).toLocaleDateString('bn-BD') : '—'}</b>verify</div>
          </div>
          {e.reports.slice(0, 2).map((r) => (
            <p key={r.id} className="sh-rep">“{r.title ?? r.details?.slice(0, 90)}”</p>
          ))}
        </div>
      ))}
      <a className="sh-fab" href={signedIn ? '#/shield?tab=check' : '#/login'} aria-label="রিপোর্ট করো">+</a>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'check', label: 'যাচাই', icon: ICONS.check },
  { id: 'radar', label: 'রাডার', icon: ICONS.radar },
  { id: 'shield', label: 'শিল্ড', icon: ICONS.stats },
  { id: 'watchdog', label: 'ওয়াচডগ', icon: ICONS.scale },
];

export default function ShieldPage({ signedIn, initialTab, initialInput }: { signedIn: boolean; initialTab?: Tab; initialInput?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'check');
  // sync when navigating via #/shield?tab=... links (e.g. watchdog FAB)
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  return (
    <div className="page sh-page">
      <header className="sh-hero">
        <a className="sh-back" href="#/" aria-label="পেছনে">{ICONS.back}</a>
        <p className="sh-kicker">ANTI-SCAM SHIELD</p>
        <h1>ঠকার <span className="sh-gold">আগে</span> যাচাই করো</h1>
      </header>
      <nav className="sh-ctabs" aria-label="Shield sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`sh-ctab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
            <span className="sh-cc">{t.icon}</span>
            <small>{t.label}</small>
          </button>
        ))}
      </nav>
      <div className="sh-body">
        {tab === 'check' && <CheckTab signedIn={signedIn} initialInput={initialInput} />}
        {tab === 'radar' && <RadarTab signedIn={signedIn} />}
        {tab === 'shield' && <ShieldTab signedIn={signedIn} />}
        {tab === 'watchdog' && <WatchdogTab signedIn={signedIn} />}
      </div>
    </div>
  );
}
