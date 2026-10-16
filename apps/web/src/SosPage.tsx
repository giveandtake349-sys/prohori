import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from './i18n';
import {
  cancelSos,
  fetchActiveSos,
  fetchMySos,
  respondSos,
  sendSos,
  type AppProfile,
} from './api';

function timeAgo(iso: string, bn: boolean): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!bn) {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const h = Math.floor(minutes / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  if (minutes < 1) return 'এইমাত্র';
  if (minutes < 60) return `${minutes} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ঘণ্টা আগে`;
  return `${Math.floor(hours / 24)} দিন আগে`;
}

function BackArrow() {
  return (
    <a className="back-arrow" href="#/" aria-label="ফিরে যাও">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
      </svg>
    </a>
  );
}

interface FeedAlert {
  id: string;
  message: string | null;
  reporter_name: string;
  created_at: string;
  distance_km: number;
  address_text?: string | null;
  responders: Array<{ name: string; created_at: string }>;
  i_responded: boolean;
  mine: boolean;
}

interface MySos {
  id: string;
  address_text: string | null;
  message: string | null;
  created_at: string;
  responders: Array<{ name: string; created_at: string }>;
}

export default function SosPage({ profile }: { profile: AppProfile | null }) {
  const { lang } = useLang();
  const bn = lang === 'bn';
  const signedIn = !!profile;

  const [step, setStep] = useState<'idle' | 'locating' | 'confirm' | 'sending'>('idle');
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState('');
  const [message, setMessage] = useState('');
  const [sendError, setSendError] = useState('');
  const [sendResult, setSendResult] = useState<{ notified: number; teams: number } | null>(null);

  const [mySos, setMySos] = useState<MySos | null>(null);
  const [mySosLoading, setMySosLoading] = useState(false);
  const [feed, setFeed] = useState<FeedAlert[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [responding, setResponding] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadMySos = useCallback(async () => {
    if (!signedIn) return;
    setMySosLoading(true);
    try {
      const data = await fetchMySos();
      setMySos(data.sos);
    } catch {
      /* non-fatal */
    } finally {
      setMySosLoading(false);
    }
  }, [signedIn]);

  const loadFeed = useCallback(async () => {
    if (!signedIn) return;
    const load = async (lat: number, lng: number) => {
      setFeedLoading(true);
      setFeedError('');
      try {
        const data = await fetchActiveSos(lat, lng);
        setFeed(data.sos);
      } catch (err) {
        setFeedError(err instanceof Error ? err.message : bn ? 'লোড হয়নি।' : 'Failed to load.');
      } finally {
        setFeedLoading(false);
      }
    };
    if (!navigator.geolocation) {
      // Fallback: Dhaka center so the feed still shows something.
      void load(23.8103, 90.4125);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => void load(p.coords.latitude, p.coords.longitude),
      () => void load(23.8103, 90.4125),
      { timeout: 10000 },
    );
  }, [signedIn, bn]);

  useEffect(() => {
    void loadMySos();
    void loadFeed();
    // Poll for new alerts / responders every 30s while the page is open.
    pollRef.current = window.setInterval(() => {
      void loadMySos();
      void loadFeed();
    }, 30000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadMySos, loadFeed]);

  const onSosTap = () => {
    setLocError('');
    setSendError('');
    setSendResult(null);
    if (!navigator.geolocation) {
      setLocError(bn ? 'এই browser GPS দেয় না।' : 'This browser has no GPS.');
      return;
    }
    setStep('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude });
        setStep('confirm');
      },
      () => {
        setLocError(
          bn
            ? 'লোকেশন অনুমতি দরকার। Browser location permission চালু করে আবার চেষ্টা করুন।'
            : 'Location permission needed. Enable it and try again.',
        );
        setStep('idle');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const onSend = async () => {
    if (!loc) return;
    setSendError('');
    setStep('sending');
    try {
      const res = await sendSos(loc.lat, loc.lng, '', message.trim() || undefined);
      setSendResult({ notified: res.notified_user_count, teams: res.notified_teams.length });
      setStep('idle');
      setMessage('');
      setLoc(null);
      await loadMySos();
      await loadFeed();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : bn ? 'পাঠানো যায়নি।' : 'Failed to send.');
      setStep('confirm');
    }
  };

  const onCancel = async () => {
    if (!mySos || cancelling) return;
    setCancelling(true);
    try {
      await cancelSos(mySos.id);
      setMySos(null);
      await loadFeed();
    } catch {
      /* non-fatal */
    } finally {
      setCancelling(false);
    }
  };

  const onRespond = async (id: string) => {
    setResponding(id);
    try {
      await respondSos(id);
      await loadFeed();
    } catch {
      /* error surfaces on next poll; keep UI simple */
    } finally {
      setResponding(null);
    }
  };

  return (
    <div className="page sos-page">
      <header className="page-head">
        <BackArrow />
        <h1>{bn ? 'SOS — জরুরি সাহায্য' : 'SOS — Emergency Help'}</h1>
      </header>

      {!signedIn && (
        <section className="card">
          <p className="meta">
            {bn ? 'SOS পাঠাতে বা respond করতে login করুন।' : 'Log in to send or respond to SOS.'}
          </p>
          <a className="primary-btn" href="#/login">
            {bn ? 'Login / Sign up' : 'Login / Sign up'}
          </a>
        </section>
      )}

      {signedIn && mySosLoading && <p className="state">{bn ? 'লোড হচ্ছে…' : 'Loading…'}</p>}

      {signedIn && !mySosLoading && mySos && (
        <section className="card sos-active-card">
          <h2>
            <span className="sos-live-dot" aria-hidden />{' '}
            {bn ? 'তোমার SOS সক্রিয়' : 'Your SOS is active'}
          </h2>
          <p className="meta">
            {timeAgo(mySos.created_at, bn)}
            {mySos.address_text ? ` · ${mySos.address_text}` : ''}
            {mySos.message ? ` — "${mySos.message}"` : ''}
          </p>
          <div className="responders">
            {mySos.responders.length === 0 ? (
              <p className="meta">{bn ? 'এখনো কেউ respond করেনি।' : 'No one has responded yet.'}</p>
            ) : (
              mySos.responders.map((r) => (
                <div className="responder-row" key={r.name + r.created_at}>
                  <span className="ok">✅</span>
                  <b>{r.name}</b>
                  <small>{bn ? 'আসছে' : 'responded'} · {timeAgo(r.created_at, bn)}</small>
                </div>
              ))
            )}
          </div>
          <div className="btn-row">
            <a className="contact-row call999" href="tel:999">
              <b>{bn ? '৯৯৯ — জাতীয় জরুরি সেবা' : '999 — National Emergency'}</b>
              <span>{bn ? 'কল করুন →' : 'Call →'}</span>
            </a>
            <button className="small-btn danger" disabled={cancelling} onClick={() => void onCancel()}>
              {cancelling ? (bn ? 'বাতিল হচ্ছে…' : 'Cancelling…') : bn ? 'SOS বাতিল করো' : 'Cancel SOS'}
            </button>
          </div>
        </section>
      )}

      {signedIn && !mySosLoading && !mySos && (
        <section className="sos-hero">
          {step === 'idle' && (
            <>
              <button className="sos-btn" onClick={onSosTap} aria-label={bn ? 'SOS পাঠাও' : 'Send SOS'}>
                <span className="sos-btn-inner">
                  <b>SOS</b>
                  <small>{bn ? 'চাপ দাও' : 'TAP'}</small>
                </span>
              </button>
              <p className="hint">
                {bn
                  ? 'বিপদে পড়লে চাপ দাও — ৫ কিমির ভেতর সবাইকে জানানো হবে'
                  : 'In danger? Tap — everyone within 5 km will be notified'}
              </p>
            </>
          )}
          {step === 'locating' && (
            <p className="state">{bn ? '📍 লোকেশন নেওয়া হচ্ছে…' : '📍 Getting location…'}</p>
          )}
          {step === 'confirm' && loc && (
            <div className="sheet sos-confirm">
              <div className="loc">
                📍{' '}
                <span>
                  {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}{' '}
                  <small className="ok-text">· {bn ? 'GPS locked' : 'GPS locked'}</small>
                </span>
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={bn ? 'কি বিপদ? (optional) — যেমন: ছিনতাই হচ্ছে…' : 'What happened? (optional)'}
                maxLength={500}
              />
              <div className="btn-row">
                <button
                  className="btn cancel"
                  onClick={() => {
                    setStep('idle');
                    setLoc(null);
                    setMessage('');
                  }}
                >
                  {bn ? 'বাদ দাও' : 'Cancel'}
                </button>
                <button className="btn send" onClick={() => void onSend()}>
                  🚨 {bn ? 'Alert পাঠাও' : 'Send Alert'}
                </button>
              </div>
            </div>
          )}
          {step === 'sending' && (
            <p className="state">{bn ? '🚨 Alert পাঠানো হচ্ছে…' : '🚨 Sending alert…'}</p>
          )}
          {locError && <p className="form-error">{locError}</p>}
          {sendError && <p className="form-error">{sendError}</p>}
          {sendResult && (
            <p className="form-notice">
              {bn
                ? `✅ Alert পাঠানো হয়েছে — ${sendResult.notified} জন + ${sendResult.teams}টি টিমকে জানানো হয়েছে`
                : `✅ Alert sent — ${sendResult.notified} people + ${sendResult.teams} teams notified`}
            </p>
          )}
          <a className="contact-row call999 sos-999" href="tel:999">
            <b>{bn ? '৯৯৯ — জাতীয় জরুরি সেবা' : '999 — National Emergency'}</b>
            <span>{bn ? 'কল করুন →' : 'Call →'}</span>
          </a>
        </section>
      )}

      {signedIn && (
        <section className="sos-feed">
          <div className="section-heading">
            <h2 className="sec">{bn ? '📡 আশেপাশে সক্রিয় SOS' : '📡 Active SOS nearby'}</h2>
          </div>
          {feedLoading && <p className="state">{bn ? 'লোড হচ্ছে…' : 'Loading…'}</p>}
          {feedError && <p className="form-error">{feedError}</p>}
          {!feedLoading && feed.length === 0 && (
            <p className="state">
              {bn ? 'এই মুহূর্তে আশেপাশে কোনো SOS নেই।' : 'No active SOS nearby right now.'}
            </p>
          )}
          {feed.map((a) => (
            <div className={`alert-card${a.responders.length > 0 ? ' has-responders' : ''}`} key={a.id}>
              <div className="top">
                <span className="who">🆘 {a.reporter_name}</span>
                <span className="time">● {timeAgo(a.created_at, bn)}</span>
              </div>
              {a.message && <div className="msg">"{a.message}"</div>}
              <div className="dist">
                📍{' '}
                {a.distance_km < 1
                  ? bn
                    ? `${Math.round(a.distance_km * 1000)} মিটার দূরে`
                    : `${Math.round(a.distance_km * 1000)}m away`
                  : bn
                    ? `${a.distance_km} কিমি দূরে`
                    : `${a.distance_km} km away`}
                {a.address_text ? ` · ${a.address_text}` : ''}
              </div>
              {a.mine ? (
                <p className="meta">{bn ? 'এটা তোমার SOS' : 'This is your SOS'}</p>
              ) : a.i_responded ? (
                <div className="responded">✅ {bn ? 'তুমি respond করেছ' : 'You responded'}</div>
              ) : (
                <button
                  className="btn respond"
                  disabled={responding === a.id}
                  onClick={() => void onRespond(a.id)}
                >
                  {responding === a.id
                    ? bn
                      ? 'পাঠানো হচ্ছে…'
                      : 'Sending…'
                    : `✋ ${bn ? 'আমি যাচ্ছি' : "I'm responding"}`}
                </button>
              )}
              {a.responders.length > 0 && (
                <div className="responder-names">
                  {a.responders.map((r) => (
                    <span key={r.name + r.created_at} className="responder-chip">
                      ✅ {r.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
