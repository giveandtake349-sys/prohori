import { useEffect, useRef, useState } from 'react';
import { checkShield, reportScam, type ShieldCheckResult } from './api';

/**
 * BlackHole Dhapa 1A — Share-to-Prohori receiver.
 * Opened by the PWA share_target (any app → Share → Prohori) with
 * ?text=&title=&url= in the hash query. Auto-runs the check on mount.
 */
const VERDICT_META: Record<string, { badge: string; cls: string }> = {
  fraud: { badge: '🚨 SCAM DETECTED', cls: 'red' },
  suspect: { badge: '⚠️ সন্দেহজনক', cls: 'yellow' },
  blacklisted: { badge: '⛔ BLACKLISTED', cls: 'red' },
  unknown: { badge: '❓ অজানা', cls: 'yellow' },
  clean: { badge: '🟢 পরিষ্কার', cls: 'green' },
};

export default function SharePage({ sharedText, source }: { sharedText: string; source: string }) {
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<ShieldCheckResult | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!sharedText.trim()) {
      setBusy(false);
      setError('শেয়ার করা কিছু পাওয়া যায়নি।');
      return;
    }
    checkShield(sharedText.trim())
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : 'যাচাই করা যায়নি।'))
      .finally(() => setBusy(false));
  }, [sharedText]);

  const doReport = async () => {
    if (!result) return;
    try {
      await reportScam({
        type: result.type === 'text' ? 'offer' : result.type,
        value: result.entityId ?? result.title,
        title: result.title,
        details: `Shared via #/share. ${result.reasons.join(' | ')}`,
      });
      setMsg('রিপোর্ট জমা হয়েছে — moderator যাচাই করবে।');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'রিপোর্ট করা যায়নি। Login লাগতে পারে।');
    }
  };

  const waLink = result
    ? `https://wa.me/?text=${encodeURIComponent(
        `🛡️ Prohori Shield: "${result.title}" — ${VERDICT_META[result.verdict]?.badge ?? ''} (${result.riskPct}% risk). যাচাই করো: ${window.location.origin}${window.location.pathname}#/shield`,
      )}`
    : '#';

  const meta = result ? (VERDICT_META[result.verdict] ?? VERDICT_META.unknown) : null;

  return (
    <div className="page bh-page">
      <div className="bh-bg"><i /><i /><i /></div>
      <header className="bh-hero">
        <a className="bh-back" href="#/" aria-label="হোম">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <p className="bh-kicker">SHARE-TO-PROHORI</p>
        <h1>যাচাই <span className="bh-gold">হচ্ছে…</span></h1>
      </header>

      {source && <p className="bh-src">💬 {source} থেকে আনা</p>}
      {sharedText && (
        <div className="bh-glass">
          <p className="bh-shared">“{sharedText.slice(0, 220)}{sharedText.length > 220 ? '…' : ''}”</p>
        </div>
      )}

      {busy && <p className="bh-state">🛡️ যাচাই হচ্ছে…</p>}
      {error && <p className="bh-err">{error}</p>}

      {result && meta && (
        <div className="bh-glass" style={{ textAlign: 'center' }}>
          <span className={`bh-vbadge ${meta.cls}`}>{meta.badge}</span>
          <div className="bh-vtitle">{result.title}</div>
          <p className="bh-vsub">{result.reasons.filter(Boolean).slice(0, 3).join(' • ')}</p>
          <div className="bh-vstats">
            <div className="bh-vstat"><b>{result.riskPct}%</b><small>risk</small></div>
            <div className="bh-vstat"><b>{result.stats.reports}</b><small>রিপোর্ট</small></div>
            <div className="bh-vstat"><b>{result.stats.confirms}</b><small>confirm</small></div>
          </div>
          <div className="bh-btnrow">
            <a className="bh-btn-gold" href={waLink} target="_blank" rel="noreferrer">⚠️ Family কে জানাও</a>
            <button type="button" className="bh-btn-ghost" onClick={() => void doReport()}>+ Report</button>
          </div>
          {msg && <p className="bh-note">{msg}</p>}
          <a className="bh-link" href="#/shield">পুরো Shield খোলো →</a>
        </div>
      )}
    </div>
  );
}
