import { useState } from 'react';
import { requestApiKey } from './api';

/** BlackHole Dhapa 2 — Bank Trust API developer portal (newest UI). */

const CURL = `curl -X POST https://prohori-api.onrender.com/api/v1/check \\
  -H "x-api-key: bk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"input":"01312345678"}'`;

const RESP = `{
  "verdict": "fraud",      // fraud | suspect | blacklisted | unknown | clean
  "riskPct": 95,           // 0-100
  "reports": 23,
  "confirms": 41,
  "label": "bKash OTP scam",
  "checkedAt": "2026-10-18T...",
  "latencyMs": 41
}`;

const TIERS = [
  { id: 'starter', name: 'Starter', price: '৳5K', per: '/মাস', checks: '10K check', desc: 'ছোট fintech / pilot' },
  { id: 'growth', name: 'Growth', price: '৳50K', per: '/মাস', checks: '200K check', desc: 'MFS / বড় app', hl: true },
  { id: 'bank', name: 'Bank', price: 'Custom', per: '', checks: 'unlimited', desc: 'SLA + dedicated support' },
];

export default function DevelopersPage() {
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<'starter' | 'growth' | 'bank'>('growth');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await requestApiKey({ name: name.trim(), org: org.trim(), email: email.trim(), plan, note: note.trim() });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request পাঠানো যায়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page bh-page">
      <div className="bh-bg"><i /><i /><i /></div>
      <header className="bh-hero">
        <a className="bh-back" href="#/" aria-label="হোম">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <p className="bh-kicker">PROHORI TRUST API</p>
        <h1>বাংলাদেশের live scam DB,<br />তোমার app এ <span className="bh-gold">1 line</span> এ</h1>
        <p className="bh-sub">Send-money এর আগে number check — fraud ঠেকাও real-time এ।</p>
      </header>

      <div className="bh-glass">
        <h3 className="bh-h3">🔌 Endpoint</h3>
        <div className="bh-code"><span className="k">POST</span> /api/v1/check</div>
        <pre className="bh-code">{CURL}</pre>
        <h3 className="bh-h3">📦 Response</h3>
        <pre className="bh-code">{RESP}</pre>
        <p className="bh-note">Auth: <code>x-api-key</code> header। Quota শেষ হলে <code>429</code>।</p>
      </div>

      <h2 className="bh-sec">💰 Pricing</h2>
      <div className="bh-tiers">
        {TIERS.map((t) => (
          <div key={t.id} className={`bh-tier${t.hl ? ' hl' : ''}`}>
            <small>{t.name}</small>
            <b>{t.price}<span>{t.per}</span></b>
            <p>{t.checks}</p>
            <p className="bh-tdesc">{t.desc}</p>
          </div>
        ))}
      </div>

      <h2 className="bh-sec">🔑 API Key চাও</h2>
      <div className="bh-glass">
        {done ? (
          <p className="bh-ok">✅ Request পৌঁছেছে! Team review করে তোমাকে key পাঠাবে।</p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="bh-form">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="তোমার নাম *" required maxLength={120} />
            <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="প্রতিষ্ঠান (bKash / ব্যাংক / app)" maxLength={160} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" type="email" required maxLength={160} />
            <div className="bh-plans">
              {TIERS.map((t) => (
                <button key={t.id} type="button" className={plan === t.id ? 'on' : ''} onClick={() => setPlan(t.id as typeof plan)}>{t.name}</button>
              ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="কেন লাগবে? (ঐচ্ছিক)" rows={2} maxLength={1000} />
            {error && <p className="bh-err">{error}</p>}
            <button type="submit" className="bh-btn-gold" disabled={busy}>{busy ? 'পাঠানো হচ্ছে…' : 'Request পাঠাও'}</button>
          </form>
        )}
      </div>
      <p className="bh-note" style={{ textAlign: 'center', marginTop: 16 }}>User রা free ব্যবহার করে — bank/MFS pay করে। 🤝</p>
    </div>
  );
}
