import { useEffect, useState } from 'react';
import {
  fetchReports,
  fetchReportByTrackingId,
  fetchTeams,
  fetchEmergencyContacts,
  sendSos,
  type FeedReport,
  type ReportDetail,
  type Team,
  type EmergencyContacts,
  type SosResult,
} from './api';
import { CATEGORY_BN, STATUS_BN, CATEGORY_KEYS } from './labels';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'এইমাত্র';
  if (mins < 60) return `${mins} মিনিট আগে`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ঘণ্টা আগে`;
  return `${Math.floor(hrs / 24)} দিন আগে`;
}

/** "15 jon bolche byabostha neya hoyni" — the public accountability line. */
function ActionLine({ r }: { r: FeedReport }) {
  if (r.actionTakenCount === 0 && r.noActionCount === 0) return null;
  return (
    <div className="action-line">
      <span className="a-taken">{r.actionTakenCount} জন বলছে ব্যবস্থা নেওয়া হয়েছে</span>
      <span className="a-no">{r.noActionCount} জন বলছে নেওয়া হয়নি</span>
    </div>
  );
}

function ReportCard({ r }: { r: FeedReport }) {
  return (
    <article className="card">
      <div className="card-top">
        <span className="chip cat">{CATEGORY_BN[r.category] ?? r.category}</span>
        <span className={`chip status st-${r.status}`}>{STATUS_BN[r.status] ?? r.status}</span>
      </div>
      <h3>{r.title}</h3>
      <p className="meta">
        {r.addressText} • {timeAgo(r.createdAt)}
      </p>
      <p className="desc">{r.description}</p>
      <div className="card-foot">
        <span className="corro">{r.corroborationCount} জন নিশ্চিত করেছে</span>
        <a className="track-link" href={`#/track/${encodeURIComponent(r.trackingId)}`}>
          ট্র্যাক করো ({r.trackingId}) →
        </a>
      </div>
      <ActionLine r={r} />
    </article>
  );
}

function HomePage() {
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchReports(category || undefined)
      .then((d) => setReports(d.reports))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  }, [category]);

  return (
    <div className="page">
      <header className="hero">
        <h1>প্রহরী</h1>
        <p>জনতার চোখ — অপরাধ দেখলে চুপ নয়</p>
        <a className="hero-link" href="#/teams">
          পাশে আছি টিম →
        </a>
      </header>
      <div className="filters">
        <button className={category === '' ? 'fchip on' : 'fchip'} onClick={() => setCategory('')}>
          সব
        </button>
        {CATEGORY_KEYS.map((k) => (
          <button
            key={k}
            className={category === k ? 'fchip on' : 'fchip'}
            onClick={() => setCategory(k)}
          >
            {CATEGORY_BN[k]}
          </button>
        ))}
      </div>
      {loading && <p className="state">লোড হচ্ছে…</p>}
      {error && <p className="state err">সার্ভার পাওয়া যাচ্ছে না — API চালু আছে তো? ({error})</p>}
      {!loading && !error && reports.length === 0 && (
        <p className="state">এখনো কোনো যাচাইকৃত রিপোর্ট নেই।</p>
      )}
      <div className="feed">
        {reports.map((r) => (
          <ReportCard key={r.id} r={r} />
        ))}
      </div>
    </div>
  );
}

function TrackPage({ trackingId }: { trackingId: string }) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReportByTrackingId(trackingId)
      .then(setDetail)
      .catch(() => setError('রিপোর্ট পাওয়া যায়নি'));
  }, [trackingId]);

  if (error) return <div className="page"><p className="state err">{error}</p><a href="#/">← ফিরে যাও</a></div>;
  if (!detail) return <div className="page"><p className="state">লোড হচ্ছে…</p></div>;
  const { report: r, history, media } = detail;

  return (
    <div className="page">
      <a className="back" href="#/">← সব রিপোর্ট</a>
      <article className="card">
        <div className="card-top">
          <span className="chip cat">{CATEGORY_BN[r.category] ?? r.category}</span>
          <span className={`chip status st-${r.status}`}>{STATUS_BN[r.status] ?? r.status}</span>
        </div>
        <h3>{r.title}</h3>
        <p className="meta">{r.addressText} • {r.trackingId}</p>
        <p className="desc">{r.description}</p>
        <p className="corro">{r.corroborationCount} জন নিশ্চিত করেছে • {media.length}টি প্রমাণ সংযুক্ত</p>
        <ActionLine r={r} />
      </article>
      <h2 className="sec">অগ্রগতি</h2>
      <ol className="timeline">
        {history.map((h, i) => (
          <li key={i} className={i === history.length - 1 ? 'now' : 'done'}>
            <b>{STATUS_BN[h.toStatus] ?? h.toStatus}</b>
            {h.note && <span>{h.note}</span>}
            <small>{new Date(h.createdAt).toLocaleString('bn-BD')}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const [contacts, setContacts] = useState<EmergencyContacts | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    if (!open && !contacts) {
      setLoading(true);
      fetchEmergencyContacts(team.id)
        .then(setContacts)
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }
    setOpen(!open);
  };

  return (
    <article className="card">
      <h3>{team.name}</h3>
      <p className="meta">
        {team.area_text ?? 'এলাকা উল্লেখ নেই'} • {team.member_count} জন সদস্য
      </p>
      <button className="fchip" onClick={toggle}>
        {open ? 'যোগাযোগ লুকাও' : 'জরুরি যোগাযোগ দেখো'}
      </button>
      {open && (
        <div className="contacts">
          {loading && <p className="state">লোড হচ্ছে…</p>}
          {contacts && (
            <>
              <a className="contact-row call999" href="tel:999">
                <b>৯৯৯ — জাতীয় জরুরি সেবা</b>
                <span>কল করো →</span>
              </a>
              {contacts.members.map((m) => (
                <a className="contact-row" key={m.user_id} href={`tel:${m.emergency_phone}`}>
                  <b>
                    {m.name} {m.role === 'lead' ? '(টিম লিড)' : ''}
                  </b>
                  <span>
                    {m.emergency_phone} →
                  </span>
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </article>
  );
}

function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [message, setMessage] = useState('');
  const [sosResult, setSosResult] = useState<SosResult | null>(null);
  const [sosError, setSosError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchTeams()
      .then((d) => setTeams(d.teams))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  }, []);

  const doSos = () => {
    if (!userId.trim()) {
      setSosError('তোমার user ID (uuid) দাও');
      return;
    }
    setSending(true);
    setSosError('');
    setSosResult(null);
    // Demo location: Dhaka. The real app sends the phone's GPS position.
    sendSos(userId.trim(), 23.8103, 90.4125, message.trim() || undefined)
      .then(setSosResult)
      .catch((e: unknown) => setSosError(e instanceof Error ? e.message : 'SOS failed'))
      .finally(() => setSending(false));
  };

  return (
    <div className="page">
      <a className="back" href="#/">
        ← সব রিপোর্ট
      </a>
      <header className="hero">
        <h1>পাশে আছি</h1>
        <p>তোমার মহল্লার ভলান্টিয়ার টিম — বিপদে একসাথে</p>
      </header>

      <div className="card sos-card">
        <h3>জরুরি SOS</h3>
        <p className="meta">
          চাপ দিলে ৫ কিমির মধ্যে থাকা সব ইউজার + কাছের ভলান্টিয়ার টিমের কাছে
          অ্যালার্ট যাবে (ডেমো অবস্থান: ঢাকা)
        </p>
        <input
          className="input"
          placeholder="তোমার user ID (uuid)"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <input
          className="input"
          placeholder="বার্তা (ঐচ্ছিক)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="sos-btn" onClick={doSos} disabled={sending}>
          {sending ? 'পাঠানো হচ্ছে…' : 'SOS পাঠাও'}
        </button>
        {sosError && <p className="state err">{sosError}</p>}
        {sosResult && (
          <div className="sos-result">
            <b>SOS পাঠানো হয়েছে ✓</b>
            <span>{sosResult.notified_user_count} জন কাছের ইউজারকে জানানো হয়েছে</span>
            {sosResult.notified_teams.map((t) => (
              <span key={t.id}>
                {t.name} — {t.member_count} জন সদস্য
              </span>
            ))}
          </div>
        )}
      </div>

      <h2 className="sec">ভলান্টিয়ার টিম</h2>
      {loading && <p className="state">লোড হচ্ছে…</p>}
      {error && <p className="state err">সার্ভার পাওয়া যাচ্ছে না — API চালু আছে তো? ({error})</p>}
      {!loading && !error && teams.length === 0 && (
        <p className="state">এখনো কোনো টিম নেই — প্রথম টিম তুমিই বানাও।</p>
      )}
      <div className="feed">
        {teams.map((t) => (
          <TeamCard key={t.id} team={t} />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const hash = useHashRoute();
  if (hash.startsWith('#/track/')) {
    return <TrackPage trackingId={decodeURIComponent(hash.slice(8))} />;
  }
  if (hash.startsWith('#/teams')) {
    return <TeamsPage />;
  }
  return <HomePage />;
}
