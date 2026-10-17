import { useEffect, useState } from 'react';
import {
  myGuarantees,
  guaranteeFundInfo,
  fileGuaranteeClaim,
  type GuaranteeReceipt,
  type FundInfo,
} from './api';

/** BlackHole Dhapa 3 — Guarantee: "verify kore thokle, taka ferot" (newest UI). */

function ReceiptCard({ r, onClaimed }: { r: GuaranteeReceipt; onClaimed: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [proofs, setProofs] = useState('');
  const [gd, setGd] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const active = r.status === 'active' && (!r.expiresAt || new Date(r.expiresAt) > new Date());

  const claim = async () => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const urls = proofs.split('\n').map((s) => s.trim()).filter(Boolean);
      await fileGuaranteeClaim({ receipt_id: r.id, amount: Number(amount), proof_urls: urls, gd_number: gd.trim() });
      setMsg('✅ Claim জমা হয়েছে — moderator review করবে (7 দিনের মধ্যে)।');
      setOpen(false);
      onClaimed();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Claim করা যায়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bh-receipt">
      <div className="bh-rk">PROHORI PROTECTED</div>
      <h3>৳<span>{(r.maxAmount ?? 10000).toLocaleString('bn-BD')}</span> Guarantee</h3>
      <div className="bh-gcode">{r.code}</div>
      <div className="bh-rmeta">
        <span><b>{(r.verdictSnapshot as { verdict?: string } | null)?.verdict ?? 'safe'}</b>verdict</span>
        <span><b>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString('bn-BD') : '—'}</b>মেয়াদ</span>
        <span><b>{r.status === 'active' ? 'সক্রিয়' : r.status === 'claimed' ? 'দাবি হয়েছে' : r.status}</b>অবস্থা</span>
      </div>
      {r.claims.map((c) => (
        <p key={c.id} className="bh-note" style={{ marginTop: 8 }}>
          Claim ৳{c.amount.toLocaleString('bn-BD')} — {c.status === 'pending' ? '⏳ review চলছে' : c.status === 'approved' ? '✅ টাকা ফেরত দেওয়া হয়েছে' : '❌ বাতিল'}
        </p>
      ))}
      {active && !open && (
        <button type="button" className="bh-btn-ghost" onClick={() => setOpen(true)}>ঠকেছো? Claim করো</button>
      )}
      {open && (
        <div className="bh-form" style={{ marginTop: 12, textAlign: 'left' }}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`ক্ষতির পরিমাণ (সর্বোচ্চ ৳${r.maxAmount ?? 10000})`} inputMode="numeric" />
          <textarea value={proofs} onChange={(e) => setProofs(e.target.value)} placeholder="প্রমাণের লিংক (প্রতি লাইনে ১টা) — bKash receipt screenshot, chat screenshot…" rows={3} />
          <input value={gd} onChange={(e) => setGd(e.target.value)} placeholder="GD নম্বর *" />
          <button type="button" className="bh-btn-gold" disabled={busy || !amount || !gd.trim()} onClick={() => void claim()}>
            {busy ? 'জমা হচ্ছে…' : 'Claim জমা দাও'}
          </button>
          <button type="button" className="bh-btn-ghost" onClick={() => setOpen(false)}>বাতিল</button>
        </div>
      )}
      {msg && <p className="bh-note">{msg}</p>}
    </div>
  );
}

export default function GuaranteePage({ signedIn }: { signedIn: boolean }) {
  const [receipts, setReceipts] = useState<GuaranteeReceipt[]>([]);
  const [fund, setFund] = useState<FundInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    guaranteeFundInfo().then(setFund).catch(() => setFund(null));
    if (signedIn) {
      myGuarantees().then((d) => setReceipts(d.receipts)).catch(() => setReceipts([])).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  };
  useEffect(load, [signedIn]);

  return (
    <div className="page bh-page">
      <div className="bh-bg"><i /><i /><i /></div>
      <header className="bh-hero">
        <a className="bh-back" href="#/" aria-label="হোম">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <p className="bh-kicker">PROHORI GUARANTEE</p>
        <h1>Verify করে ঠকলে,<br /><span className="bh-gold">টাকা ফেরত</span></h1>
        <p className="bh-sub">Shield এ safe verdict পেয়ে payment করো → ঠকলে claim করো → 7 দিনে ফেরত।</p>
      </header>

      {/* PUBLIC fund panel — transparency, live numbers */}
      <h2 className="bh-sec">🏦 Guarantee Fund <small style={{ fontWeight: 400, color: '#8b93a7' }}>— public ledger</small></h2>
      <div className="bh-glass">
        {fund ? (
          <>
            <div className="bh-vstats">
              <div className="bh-vstat"><b>৳{fund.fundBalance.toLocaleString('bn-BD')}</b><small>fund balance</small></div>
              <div className="bh-vstat"><b>{fund.protectedActive}</b><small>protected</small></div>
              <div className="bh-vstat"><b>৳{fund.totalPaidOut.toLocaleString('bn-BD')}</b><small>ফেরত দেওয়া</small></div>
            </div>
            {fund.ledger.length > 0 && (
              <div className="bh-ledger">
                {fund.ledger.map((l, i) => (
                  <div key={i} className="bh-lrow">
                    <span>{l.kind === 'credit' ? '➕' : '➖'} {l.note ?? (l.kind === 'credit' ? 'Fund top-up' : 'Payout')}</span>
                    <b className={l.kind === 'credit' ? 'in' : 'out'}>৳{l.amount.toLocaleString('bn-BD')}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="bh-state">Fund তথ্য লোড হচ্ছে…</p>
        )}
      </div>

      <h2 className="bh-sec">🧾 আমার Receipts</h2>
      {!signedIn && (
        <div className="bh-glass" style={{ textAlign: 'center' }}>
          <p>Receipt দেখতে login করো</p>
          <a className="bh-btn-gold" href="#/login" style={{ display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>Login করো</a>
        </div>
      )}
      {signedIn && loading && <p className="bh-state">লোড হচ্ছে…</p>}
      {signedIn && !loading && receipts.length === 0 && (
        <div className="bh-glass" style={{ textAlign: 'center' }}>
          <p className="bh-state">এখনো কোনো Protected receipt নাই।<br />Shield এ safe verdict পেলে “🛡️ Protected করো” চাপো।</p>
          <a className="bh-btn-gold" href="#/shield" style={{ display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>Shield খোলো</a>
        </div>
      )}
      {signedIn && receipts.map((r) => <ReceiptCard key={r.id} r={r} onClaimed={load} />)}

      <p className="bh-note" style={{ textAlign: 'center', marginTop: 18 }}>
        Claim এ লাগবে: transaction proof + GD নম্বর। ভুয়া claim = ban।<br />
        Pilot fund ৳৫ লাখ — প্রতি payout public ledger এ দেখাবে।
      </p>
    </div>
  );
}
