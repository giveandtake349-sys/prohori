import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  corroborateReport,
  createReport,
  createTeam,
  fetchAdminUsers,
  fetchDivisions,
  fetchDistricts,
  fetchEmergencyContacts,
  fetchModerationStats,
  fetchNearbySummary,
  fetchReportHistory,
  fetchModerationQueue,
  fetchReportByTrackingId,
  fetchReports,
  fetchTeamDetail,
  fetchTeams,
  fetchTeamsNearby,
  fetchThanas,
  joinTeam,
  leaveTeam,
  moderateReport,
  removeTeamMember,
  reportFraudNumber,
  checkFraudNumber,
  setUserRole,
  submitActionClaim,
  shareReport,
  caseShareUrl,
  TEAM_TYPE_META,
  TEAM_TYPES,
  type AdminUser,
  type AppProfile,
  type District,
  type Division,
  type EmergencyContacts,
  type FeedReport,
  type FeedSort,
  type FraudCheck,
  type ModerationStats,
  type NearbySummary,
  type ReportDetail,
  type ReportHistory,
  type Team,
  type TeamDetail,
  type TeamType,
  type Thana,
} from './api';
import { CATEGORY_BN, CATEGORY_KEYS, STATUS_BN, TIER_BN } from './labels';
import MapPicker from './MapPicker';
import ShareButtons from './share';
import { supabase } from './supabaseClient';
import {
  ClaimVotes,
  DeadlineTag,
  FollowButton,
  ReportMediaRow,
  SortToggle,
  SpotlightRail,
  StageBadge,
  StageProgress,
  stageOf,
} from './v12';

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'এইমাত্র';
  if (minutes < 60) return `${minutes} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ঘণ্টা আগে`;
  return `${Math.floor(hours / 24)} দিন আগে`;
}

function Message({ error, children }: { error?: boolean; children: string }) {
  return <p className={error ? 'form-error' : 'form-notice'} role={error ? 'alert' : 'status'}>{children}</p>;
}

function TierBadge({ tier }: { tier: FeedReport['verificationTier'] }) {
  const icon =
    tier === 'official' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
    ) : tier === 'community' ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
    );
  return <span className={`chip tier tier-${tier}`}>{icon}{TIER_BN[tier] ?? TIER_BN.none}</span>;
}

function TierProgress({ report }: { report: FeedReport }) {
  const stage = stageOf(report);
  if (stage === 3) {
    return <StageProgress count={report.corroborationCount} threshold={report.stageThreshold} stage={stage} />;
  }
  // Legacy fallback thresholds when the API omits stageThreshold:
  // stage 0 → 2 (প্রাথমিক), stage 1/2 → 10 (old community target).
  const threshold = report.stageThreshold ?? (stage === 0 ? 2 : 10);
  return <StageProgress count={report.corroborationCount} threshold={threshold} stage={stage} />;
}

function ActionLine({ report }: { report: FeedReport }) {
  if (report.actionTakenCount === 0 && report.noActionCount === 0) return null;
  return (
    <div className="action-line">
      <span className="a-taken">{report.actionTakenCount} জন বলছে ব্যবস্থা নেওয়া হয়েছে</span>
      <span className="a-no">{report.noActionCount} জন বলছে নেওয়া হয়নি</span>
    </div>
  );
}

function ReportCard({ report, signedIn, reload }: { report: FeedReport; signedIn: boolean; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const act = async (operation: () => Promise<unknown>, text: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(text);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'কাজটি করা যায়নি।');
    } finally {
      setBusy(false);
    }
  };

  const canAct = signedIn && report.status !== 'resolved' && report.status !== 'rejected';
  const stage = stageOf(report);
  const proofIcon =
    stage === 3 ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
    );

  return (
    <article className={`rcard tier-${report.verificationTier} stage-${stage}`}>
      <div className="rbody">
        <div className="rtop">
          <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
          <StageBadge stage={stage} />
        </div>
        <DeadlineTag
          deadlineAt={report.deadlineAt}
          overdue={report.overdue}
          escalationLevel={report.escalationLevel}
          resolved={report.status === 'resolved'}
        />
        <h3>{report.title}</h3>
        <p className="rmeta">{report.addressText} • {timeAgo(report.createdAt)}</p>
        <ReportMediaRow media={report.media} trackingId={report.trackingId} />
        <ActionLine report={report} />
      </div>
      <div className="proof">
        <span className={`pic${stage === 3 ? ' ok' : ''}`}>{proofIcon}</span>
        <div className="proof-main">
          {stage < 2 ? (
            <>
              <small><b>{report.corroborationCount} জন</b> নিশ্চিত করেছে</small>
              <TierProgress report={report} />
            </>
          ) : stage === 2 ? (
            <small><b>{report.corroborationCount} জন</b> নিশ্চিত করেছে • <span className="hl-b">জনতা যাচাইকৃত</span></small>
          ) : (
            <small><span className="hl-g">প্রহরী যাচাইকৃত ✓</span> • <b>{report.corroborationCount} জন</b> নিশ্চিত করেছিল</small>
          )}
        </div>
      </div>
      <div className="rfoot">
        <a className="btn blue" href={`#/track/${encodeURIComponent(report.trackingId)}`}>বিস্তারিত</a>
        {canAct && (
          <button className={`btn ${stage === 0 ? 'yellow' : 'dark'}`} disabled={busy} onClick={() => void act(() => corroborateReport(report.id), 'আপনার corroboration নথিভুক্ত হয়েছে।')}>
            ✓ নিশ্চিত করো
          </button>
        )}
        <FollowButton
          kind="report"
          id={report.id}
          initialFollowing={report.following}
          initialCount={report.followerCount}
          signedIn={signedIn}
        />
      </div>
      {canAct && (
        <div className="rfoot sub">
          <button className="btn dark" disabled={busy} onClick={() => void act(() => submitActionClaim(report.id, 'action_taken'), 'ব্যবস্থা নেওয়ার মতামত নথিভুক্ত হয়েছে।')}>
            ব্যবস্থা নেওয়া হয়েছে
          </button>
          <button className="btn dark" disabled={busy} onClick={() => void act(() => submitActionClaim(report.id, 'no_action'), 'ব্যবস্থা না নেওয়ার মতামত নথিভুক্ত হয়েছে।')}>
            নেওয়া হয়নি
          </button>
        </div>
      )}
      {(error || notice) && (
        <div style={{ padding: '0 14px 10px' }}>
          {error && <Message error>{error}</Message>}
          {notice && <Message>{notice}</Message>}
        </div>
      )}
    </article>
  );
}

export function HomePage({ signedIn, initialCategory }: { signedIn: boolean; initialCategory?: string }) {
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [category, setCategory] = useState(initialCategory ?? '');
  const [sort, setSort] = useState<FeedSort>('hot');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = () => {
    setLoading(true);
    setError('');
    fetchReports(category || undefined, sort)
      .then((data) => setReports(data.reports))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'রিপোর্ট লোড করা যায়নি।'))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [category, sort]);

  return (
    <div className="page">
      <header className="hero">
        <h1>প্রহরী</h1>
        <p>জনতার চোখ — অপরাধ দেখলে চুপ নয়</p>
        <p className="hero-intro">নিরাপদে রিপোর্ট করুন, তথ্য যাচাই করুন, আর আপনার এলাকার মানুষের পাশে দাঁড়ান।</p>
      </header>
      <div className="quick-actions">
        <a className="quick-action" href="#/reports/new">＋ রিপোর্ট জমা দিন</a>
        <a className="quick-action" href="#/teams">পাশে আছি টিম</a>
        <a className="quick-action" href="#/fraud">প্রতারণার নম্বর যাচাই</a>
      </div>
      <h2 className="sec">জনসমক্ষে প্রকাশিত রিপোর্ট</h2>
      <SpotlightRail />
      <SortToggle sort={sort} onChange={setSort} />
      <p className="meta">রিপোর্ট জমা দিলেই public-এ দেখা যায়। “প্রকাশিত · যাচাই বাকি” মানে moderator এখনো তথ্য যাচাই করেননি—status দেখে সিদ্ধান্ত নিন।</p>
      <div className="filters">
        <button className={category === '' ? 'fchip on' : 'fchip'} onClick={() => setCategory('')}>সব</button>
        {CATEGORY_KEYS.map((key) => (
          <button key={key} className={category === key ? 'fchip on' : 'fchip'} onClick={() => setCategory(key)}>
            {CATEGORY_BN[key]}
          </button>
        ))}
      </div>
      {loading && <p className="state">লোড হচ্ছে…</p>}
      {error && <p className="state err">রিপোর্ট লোড হয়নি: {error}</p>}
      {!loading && !error && reports.length === 0 && <p className="state">এখনো কোনো প্রকাশিত রিপোর্ট নেই। নতুন রিপোর্ট জমা দিতে উপরের বোতাম চাপুন।</p>}
      <div className="feed">
        {reports.map((report) => <ReportCard key={report.id} report={report} signedIn={signedIn} reload={reload} />)}
      </div>
    </div>
  );
}

export function TrackPage({ trackingId, signedIn }: { trackingId: string; signedIn: boolean }) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await fetchReportByTrackingId(trackingId);
        if (active) { setDetail(next); setError(''); }
      } catch {
        if (active) setError((current) => current || 'এই tracking ID-তে কোনো রিপোর্ট পাওয়া যায়নি।');
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [trackingId]);

  if (error) return <div className="page"><p className="state err">{error}</p><a href="#/">← ফিরে যান</a></div>;
  if (!detail) return <div className="page"><p className="state">রিপোর্ট খোঁজা হচ্ছে…</p></div>;
  const { report, history, media, claims } = detail;
  const stage = stageOf(report);
  const shareUrl = caseShareUrl(trackingId);
  return (
    <div className="page">
      <a className="back-arrow" href="#/track" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
      <div className="dhero">
        <StageBadge stage={stage} />
        <h2>{report.title}</h2>
        <p className="rmeta">{report.trackingId} • {report.addressText}</p>
        <DeadlineTag
          deadlineAt={report.deadlineAt}
          overdue={report.overdue}
          escalationLevel={report.escalationLevel}
          resolved={report.status === 'resolved'}
        />
      </div>
      <div className="share-prominent">
        <ShareButtons
          url={shareUrl}
          text={report.title}
          onShared={() => {
            void shareReport(report.id).catch(() => undefined);
          }}
        />
      </div>
      <article className="card">
        <div className="card-top">
          <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
          <span className={`chip status st-${report.status}`}>{STATUS_BN[report.status] ?? report.status}</span>
        </div>
        <p className="desc">{report.description}</p>
        {report.accusedName && <p className="accused-line">অভিযুক্তের নাম: <b>{report.accusedName}</b></p>}
        <TierProgress report={report} />
        <p className="corro">{report.corroborationCount} জন নিশ্চিত করেছে • {media.length}টি প্রমাণ সংযুক্ত</p>
        <ActionLine report={report} />
        <ClaimVotes reportId={report.id} claims={claims} signedIn={signedIn} />
        {media.length > 0 && (
          <>
            <p className="field-label" style={{ marginTop: 12 }}>প্রমাণ ({media.length})</p>
            <div className="evrow scroll-x">
              {media.map((m, i) => (
                <a key={i} className="ev" href={m.url} target="_blank" rel="noreferrer" title={`SHA-256: ${m.sha256}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  <img src={m.url} alt="প্রমাণ" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  <span className="hash">{(m.sha256 ?? '').slice(0, 4)}…✓</span>
                </a>
              ))}
            </div>
            <div className="follow-row">
              <FollowButton
                kind="report"
                id={report.id}
                initialFollowing={report.following}
                initialCount={report.followerCount}
                signedIn={signedIn}
              />
            </div>
          </>
        )}
      </article>
      <div className="section-heading">
        <h2 className="sec">আপডেট ও নোটিফিকেশন</h2>
        <button className="small-btn" type="button" onClick={() => {
          void fetchReportByTrackingId(trackingId).then((next) => { setDetail(next); setError(''); }).catch(() => undefined);
        }}>এখন refresh করুন</button>
      </div>
      <p className="meta">প্রতিটি status পরিবর্তন ও moderator-এর note এখানে দেখা যাবে; page প্রতি ৩০ সেকেন্ডে নিজে refresh হয়। এখনো email বা push notification পাঠানো হয় না।</p>
      <ol className="timeline">
        {history.map((entry, index) => (
          <li key={`${entry.createdAt}-${index}`} className={index === history.length - 1 ? 'now' : 'done'}>
            {entry.fromStatus && entry.fromStatus !== entry.toStatus && <span>{STATUS_BN[entry.fromStatus] ?? entry.fromStatus} → </span>}
            {entry.fromStatus && entry.fromStatus === entry.toStatus && <span>অতিরিক্ত update · </span>}
            <b>{STATUS_BN[entry.toStatus] ?? entry.toStatus}</b>
            {entry.note && <span>{entry.note}</span>}
            <small>{new Date(entry.createdAt).toLocaleString('bn-BD')}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TrackSearchPage() {
  const [trackingId, setTrackingId] = useState('');
  return (
    <div className="page">
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}><a className="back-arrow" href="#/" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
          <h1 style={{ margin: 0 }}>রিপোর্ট ট্র্যাক করুন</h1>
        </div>
        <form className="stack-form" onSubmit={(event) => { event.preventDefault(); if (trackingId.trim()) window.location.hash = `#/track/${encodeURIComponent(trackingId.trim())}`; }}>
          <label>আপনার tracking ID<input required value={trackingId} onChange={(event) => setTrackingId(event.target.value)} placeholder="যেমন: PRH-..." /></label>
          <button className="primary-btn" type="submit">রিপোর্ট খুঁজুন</button>
        </form>
      </section>
    </div>
  );
}

function LocationSelectors({
  onLocation,
}: {
  onLocation: (location: { lat: number; lng: number; address: string; districtId?: string; thanaId?: string } | null) => void;
}) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [thanas, setThanas] = useState<Thana[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [thanaId, setThanaId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { void fetchDivisions().then((data) => setDivisions(data.divisions)).catch(() => setError('বিভাগের তথ্য লোড হয়নি।')); }, []);
  useEffect(() => {
    setDistrictId('');
    setThanaId('');
    setDistricts([]);
    setThanas([]);
    if (divisionId) void fetchDistricts(divisionId).then((data) => setDistricts(data.districts)).catch(() => setError('জেলার তথ্য লোড হয়নি।'));
  }, [divisionId]);
  useEffect(() => {
    setThanaId('');
    setThanas([]);
    if (districtId) void fetchThanas(districtId).then((data) => setThanas(data.thanas)).catch(() => setError('থানার তথ্য লোড হয়নি।'));
  }, [districtId]);

  const chooseDistrict = (id: string) => {
    setDistrictId(id);
    const district = districts.find((item) => item.id === id);
    if (!district || district.lat === null || district.lng === null) onLocation(null);
    if (district && district.lat !== null && district.lng !== null) {
      onLocation({ lat: district.lat, lng: district.lng, address: district.name_bn, districtId: district.id });
    }
  };
  const chooseThana = (id: string) => {
    setThanaId(id);
    const thana = thanas.find((item) => item.id === id);
    if (!thana) onLocation(null);
    const district = districts.find((item) => item.id === districtId);
    if (thana) {
      onLocation({
        lat: thana.lat,
        lng: thana.lng,
        address: `${thana.name}${district ? `, ${district.name_bn}` : ''}`,
        districtId: district?.id,
        thanaId: thana.id,
      });
    }
  };
  const useGps = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('এই browser-এ GPS নেই। বিভাগ/জেলা/থানা বেছে নিন।');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => onLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        address: districtId ? districts.find((item) => item.id === districtId)?.name_bn ?? 'GPS অবস্থান' : 'GPS অবস্থান',
        districtId: districtId || undefined,
        thanaId: thanaId || undefined,
      }),
      () => setError('GPS অনুমতি পাওয়া যায়নি। অবস্থান বেছে নিতে বিভাগ/জেলা/থানা নির্বাচন করুন.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="location-box">
      <label>বিভাগ<select value={divisionId} onChange={(event) => { onLocation(null); setDivisionId(event.target.value); }}><option value="">বিভাগ বেছে নিন</option>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}</select></label>
      <label>জেলা<select value={districtId} disabled={!divisionId} onChange={(event) => chooseDistrict(event.target.value)}><option value="">জেলা বেছে নিন</option>{districts.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}</select></label>
      <label>থানা (ঐচ্ছিক)<select value={thanaId} disabled={!districtId} onChange={(event) => chooseThana(event.target.value)}><option value="">থানা বেছে নিন</option>{thanas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="small-btn" type="button" onClick={useGps}>GPS দিয়ে সুনির্দিষ্ট অবস্থান নিন</button>
      {error && <Message error>{error}</Message>}
    </div>
  );
}

// 30-day verified crime history near the picked pin (debounced while dragging).
function NearbyBox({ lat, lng }: { lat: number; lng: number }) {
  const [summary, setSummary] = useState<NearbySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setSummary(null);
    const t = setTimeout(() => {
      fetchNearbySummary(lat, lng)
        .then(setSummary)
        .catch(() => setSummary(null))
        .finally(() => setLoading(false));
    }, 700);
    return () => clearTimeout(t);
  }, [lat, lng]);

  if (loading && !summary) {
    return <div className="nearby-box"><p className="meta">এলাকার তথ্য আনা হচ্ছে…</p></div>;
  }
  if (!summary) return null;
  const entries = Object.entries(summary.by_category);
  if (summary.total === 0) {
    return <div className="nearby-box"><p className="meta">১ কি.মি. এর মধ্যে গত ৩০ দিনে কোনো যাচাইকৃত রিপোর্ট নেই।</p></div>;
  }
  return (
    <div className="warnbox">
      ⚠️ এই এলাকায় গত ৩০ দিনে: {entries.map(([cat, n]) => `${CATEGORY_BN[cat] ?? cat} ${n}`).join(' • ')}
    </div>
  );
}

export function NewReportPage({ signedIn }: { signedIn: boolean }) {
  const [category, setCategory] = useState(CATEGORY_KEYS[0] ?? 'other');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accusedName, setAccusedName] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number; address: string; districtId?: string } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trackingId, setTrackingId] = useState('');
  // v12: multi-image evidence (max 5, images only — no video).
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoErr, setPhotoErr] = useState('');
  // Bangla voice input (Web Speech API, bn-BD). Hidden if unsupported.
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SpeechRecognition | null>(null);
  const voiceBaseRef = useRef('');
  const voiceSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleVoice = () => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    recogRef.current = rec;
    rec.lang = 'bn-BD';
    rec.interimResults = true;
    rec.continuous = false;
    voiceBaseRef.current = description ? description.replace(/\s+$/, '') + ' ' : '';
    let finalSoFar = '';
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript ?? '';
        if (e.results[i].isFinal) finalSoFar += text;
        else interim += text;
      }
      setDescription(voiceBaseRef.current + finalSoFar + interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
      setError('');
    } catch {
      setListening(false);
    }
  };

  useEffect(() => () => recogRef.current?.stop(), []);

  const pickOnMap = (lat: number, lng: number) => {
    setLocation((current) => ({
      lat,
      lng,
      address: current?.address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      districtId: current?.districtId,
    }));
  };

  const onPickPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    setPhotoErr('');
    const files = Array.from(event.target.files ?? []);
    const slots = 5 - photos.length;
    if (slots <= 0) {
      setPhotoErr('সর্বোচ্চ ৫টি ছবি দেওয়া যাবে।');
      event.target.value = '';
      return;
    }
    const accepted: File[] = [];
    for (const f of files.slice(0, slots)) {
      if (!f.type.startsWith('image/')) {
        setPhotoErr('শুধু ছবি ফাইল দিন (ভিডিও নয়)।');
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        setPhotoErr('প্রতিটি ছবি ৫MB-এর কম হতে হবে।');
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length > 0) {
      setPhotos((cur) => [...cur, ...accepted]);
      setPhotoPreviews((cur) => [...cur, ...accepted.map((f) => URL.createObjectURL(f))]);
    }
    event.target.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotos((cur) => cur.filter((_, i) => i !== index));
    setPhotoPreviews((cur) => {
      const url = cur[index];
      if (url) URL.revokeObjectURL(url);
      return cur.filter((_, i) => i !== index);
    });
  };

  const uploadPhotos = async (): Promise<Array<{ url: string; sha256: string }>> => {
    const uploaded: Array<{ url: string; sha256: string }> = [];
    for (const file of photos) {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `reports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('report-media').upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw new Error('ছবি আপলোড হয়নি: ' + upErr.message);
      const url = supabase.storage.from('report-media').getPublicUrl(path).data.publicUrl;
      uploaded.push({ url, sha256 });
    }
    return uploaded;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setTrackingId('');
    if (!signedIn) { setError('রিপোর্ট জমা দিতে login করুন।'); return; }
    if (!location) { setError('বিভাগ/জেলা/থানা বেছে নিন অথবা GPS অবস্থান দিন।'); return; }
    setBusy(true);
    try {
      const media = photos.length > 0 ? await uploadPhotos() : undefined;
      const result = await createReport({
        category,
        title: title.trim(),
        description: description.trim(),
        lat: location.lat,
        lng: location.lng,
        address_text: location.address,
        is_anonymous: anonymous,
        district_id: location.districtId,
        accused_name: ['dhorshon', 'khun', 'ghum'].includes(category) && accusedName.trim() ? accusedName.trim() : null,
        media,
      });
      setTrackingId(result.tracking_id);
      setTitle('');
      setDescription('');
      setAccusedName('');
      setPhotos([]);
      setPhotoPreviews((cur) => {
        cur.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'রিপোর্ট জমা হয়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <a className="back-arrow" href="#/" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
      <section className="card">
        <h1>নিরাপদে অপরাধের রিপোর্ট দিন</h1>
        <p className="meta">তাৎক্ষণিক বিপদের ক্ষেত্রে জরুরি সেবা ৯৯৯-এ কল করুন। এই app জরুরি সেবার বিকল্প নয়।</p>
        <p className="meta">জমা দিলেই রিপোর্টটি public-এ প্রকাশ হবে। Anonymous বেছে নিলে আপনার পরিচয় গোপন থাকবে; কিন্তু report-এর শিরোনাম, বিবরণ ও অবস্থান public-এ দেখা যাবে।</p>
        {!signedIn && <Message error>রিপোর্ট জমা দিতে আগে login করুন।</Message>}
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <div>
            <p className="field-label">ঘটনার ধরন</p>
            <div className="catchips" role="radiogroup" aria-label="ঘটনার ধরন">
              {CATEGORY_KEYS.map((key) => (
                <button key={key} type="button" role="radio" aria-checked={category === key} className={category === key ? 'catchip sel' : 'catchip'} onClick={() => setCategory(key)}>
                  {CATEGORY_BN[key]}
                </button>
              ))}
            </div>
          </div>
          <label>শিরোনাম<input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>ঘটনার বিবরণ
            <div className="desc-row">
              <textarea required minLength={10} maxLength={5000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="কী ঘটেছে, কখন, কীভাবে — বিস্তারিত লিখুন (সর্বনিম্ন ১০ অক্ষর)" />
              {voiceSupported && (
                <button
                  type="button"
                  className={listening ? 'mic-btn listening' : 'mic-btn'}
                  onClick={toggleVoice}
                  title={listening ? 'বন্ধ করুন' : 'বলে লিখুন (বাংলা)'}
                  aria-label={listening ? 'ভয়েস ইনপুট বন্ধ করুন' : 'বাংলায় বলে বিবরণ লিখুন'}
                >
                  🎙️
                </button>
              )}
            </div>
            <span className="meta">{voiceSupported ? '— মাইকে চাপ দিয়ে বলেও লিখতে পারেন' : null}{listening ? ' 🎙️ শুনছি… বাংলায় বলুন' : null}</span>
          </label>
          {['dhorshon', 'khun', 'ghum'].includes(category) && <label>অভিযুক্তের নাম (ঐচ্ছিক)<input value={accusedName} onChange={(event) => setAccusedName(event.target.value)} maxLength={200} /><span className="meta">Officially verified না হওয়া পর্যন্ত এই নাম public-এ দেখানো হবে না।</span></label>}
          <div>
            <p className="field-label">ঘটনার অবস্থান *</p>
            <LocationSelectors onLocation={setLocation} />
            <button
              type="button"
              className={location ? 'gps-btn done' : 'gps-btn'}
              onClick={() => setShowMap((v) => !v)}
              aria-expanded={showMap}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
              </svg>
              {location ? `✓ অবস্থান নেওয়া হয়েছে` : 'GPS দিয়ে সুনির্দিষ্ট অবস্থান নিন'}
            </button>
            {showMap && (
              <div className="map-wrap">
                <p className="meta">ম্যাপে পিন বসান:</p>
                <MapPicker lat={location?.lat ?? null} lng={location?.lng ?? null} onPick={pickOnMap} />
              </div>
            )}
            {location && <p className="location-summary">নির্বাচিত অবস্থান: {location.address} ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})</p>}
            {location && <NearbyBox lat={location.lat} lng={location.lng} />}
          </div>
          <div className="anonrow" role="switch" aria-checked={anonymous} tabIndex={0}
            onClick={() => setAnonymous((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAnonymous((v) => !v); } }}>
            <div><b>পরিচয় গোপন রাখো</b><small>কেউ জানবে না কে রিপোর্ট করেছে</small></div>
            <span className={`switch${anonymous ? ' on' : ''}`} />
          </div>
          <div>
            <p className="field-label">প্রমাণের ছবি (সর্বোচ্চ ৫টি)</p>
            <label className="upload-box">
              <input type="file" accept="image/*" multiple hidden onChange={onPickPhotos} disabled={photos.length >= 5} />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
              </svg>
              <b>{photos.length > 0 ? `${photos.length}/৫ ছবি যোগ হয়েছে` : 'ছবি যোগ করো'}</b>
              <small>একসাথে একাধিক ছবি বেছে নিতে পারো</small>
            </label>
            {photoPreviews.length > 0 && (
              <div className="thumb-grid">
                {photoPreviews.map((src, i) => (
                  <span className="thumb" key={src}>
                    <img src={src} alt={`প্রমাণ ${i + 1}`} />
                    <button type="button" className="thumb-x" onClick={() => removePhoto(i)} aria-label="ছবি সরাও">×</button>
                  </span>
                ))}
              </div>
            )}
            {photoErr && <Message error>{photoErr}</Message>}
          </div>
          {error && <Message error>{error}</Message>}
          {trackingId && <div className="success-box"><b>রিপোর্ট public-এ প্রকাশ হয়েছে</b><span>এটি এখনো যাচাই করা হয়নি। আপনার tracking ID: <strong>{trackingId}</strong></span><a href={`#/track/${encodeURIComponent(trackingId)}`}>সব update ও status দেখুন →</a></div>}
          <button className="primary-btn" type="submit" disabled={busy || !signedIn}>{busy ? 'জমা হচ্ছে…' : 'রিপোর্ট জমা দিন'}</button>
        </form>
      </section>
    </div>
  );
}

export function FraudPage({ profile }: { profile: AppProfile | null }) {
  const [number, setNumber] = useState('');
  const [result, setResult] = useState<FraudCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const check = async () => {
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try { setResult(await checkFraudNumber(number)); }
    catch (err) { setError(err instanceof Error ? err.message : 'নম্বর যাচাই হয়নি।'); }
    finally { setBusy(false); }
  };
  const report = async () => {
    if (!profile) { setError('নম্বর report করতে login করুন।'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await reportFraudNumber(number);
      setNotice(`ধন্যবাদ। এই নম্বরটি ${response.report_count} বার report হয়েছে।`);
      setResult({ is_fraud: response.verified || response.report_count >= 3, report_count: response.report_count, verified: response.verified });
    } catch (err) { setError(err instanceof Error ? err.message : 'Report জমা হয়নি।'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}><a className="back-arrow" href="#/" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
          <h1 style={{ margin: 0 }}>প্রতারণার নম্বর যাচাই</h1>
        </div>
        <p className="meta">বিকাশ/নগদ OTP বা অন্য প্রতারণার সন্দেহজনক নম্বর খুঁজুন। এটি community report, সরকারি তালিকা নয়।</p>
        <div className="stack-form">
          <label>ফোন নম্বর<input value={number} onChange={(event) => setNumber(event.target.value)} inputMode="tel" placeholder="যেমন: 01XXXXXXXXX" /></label>
          <div className="button-row">
            <button className="primary-btn" type="button" disabled={busy || number.trim().length < 6} onClick={() => void check()}>নম্বর যাচাই</button>
            <button className="small-btn danger" type="button" disabled={busy || number.trim().length < 6} onClick={() => void report()}>প্রতারণা হিসেবে report</button>
          </div>
          {result && <div className={result.is_fraud ? 'fraud-result is-fraud' : 'fraud-result'}><b>{result.is_fraud ? 'সতর্কতা: community-তে সন্দেহজনক হিসেবে report হয়েছে' : 'এখনো যথেষ্ট fraud report নেই'}</b><span>Report: {result.report_count} • {result.verified ? 'যাচাইকৃত' : 'community signal'}</span></div>}
          {error && <Message error>{error}</Message>}{notice && <Message>{notice}</Message>}
          {!profile && <p className="meta">Report দিতে login দরকার; নম্বর check করা সবার জন্য খোলা।</p>}
        </div>
      </section>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  const meta = TEAM_TYPE_META[team.team_type] ?? TEAM_TYPE_META.general;
  const area = [team.elaka_text ?? team.area_text, team.goli_text].filter(Boolean).join(', ');
  return (
    <a className="team-card" href={`#/teams/${team.id}`}>
      <div className="team-card-top">
        <h3>{team.name}</h3>
        <span className="team-type">{meta.emoji} {meta.bn}</span>
      </div>
      <p className="meta">{area || 'এলাকা উল্লেখ নেই'} • {team.member_count} জন volunteer</p>
      {team.distance_km !== null && <p className="meta dist">📍 প্রায় {team.distance_km} কিমি দূরে</p>}
    </a>
  );
}

export function TeamsPage({ profile }: { profile: AppProfile | null }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [nearby, setNearby] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | TeamType>('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Creation form state
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [thanas, setThanas] = useState<Thana[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [thanaId, setThanaId] = useState('');
  const [elaka, setElaka] = useState('');
  const [goli, setGoli] = useState('');
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [teamType, setTeamType] = useState<TeamType>('general');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // SOS state

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const reload = () => {
    setLoading(true); setError('');
    fetchTeams({ type: typeFilter || undefined, search: debouncedSearch || undefined })
      .then((data) => setTeams(data.teams))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Team লোড হয়নি।'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [typeFilter, debouncedSearch]);

  const loadNearby = () => {
    setNearbyError(''); setNearby([]);
    if (!navigator.geolocation) { setNearbyError('এই browser GPS দেয় না।'); return; }
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        fetchTeamsNearby(position.coords.latitude, position.coords.longitude, 8, typeFilter || undefined)
          .then((data) => {
            let list = data.teams;
            if (debouncedSearch) {
              const q = debouncedSearch.toLowerCase();
              list = list.filter((t) => t.name.toLowerCase().includes(q) || (t.elaka_text ?? t.area_text ?? '').toLowerCase().includes(q));
            }
            setNearby(list);
          })
          .catch(() => setNearbyError('আশেপাশের team লোড হয়নি।'))
          .finally(() => setNearbyLoading(false));
      },
      () => { setNearbyError('লোকেশন অনুমতি দরকার। Browser location permission চালু করে আবার চেষ্টা করুন।'); setNearbyLoading(false); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };
  useEffect(loadNearby, [typeFilter, debouncedSearch]);

  useEffect(() => { void fetchDivisions().then((data) => setDivisions(data.divisions)).catch(() => undefined); }, []);
  useEffect(() => {
    setDistrictId(''); setThanaId(''); setDistricts([]); setThanas([]);
    if (divisionId) void fetchDistricts(divisionId).then((data) => setDistricts(data.districts)).catch(() => undefined);
  }, [divisionId]);
  useEffect(() => {
    setThanaId(''); setThanas([]);
    if (districtId) void fetchThanas(districtId).then((data) => setThanas(data.thanas)).catch(() => undefined);
  }, [districtId]);

  const step1Valid = districtId !== '' && thanaId !== '' && elaka.trim().length >= 2 && pinLat !== null && pinLng !== null;

  const onCreate = async () => {
    setCreateError('');
    if (!profile) { setCreateError('Team তৈরি করতে login করুন।'); return; }
    if (!step1Valid || teamName.trim().length < 3 || phone.trim().length < 6) {
      setCreateError('লাল * চিহ্নিত সব ঘর পূরণ করুন।');
      return;
    }
    setCreateBusy(true);
    try {
      const result = await createTeam({
        name: teamName.trim(),
        district_id: districtId,
        thana_id: thanaId,
        elaka_text: elaka.trim(),
        goli_text: goli.trim() || undefined,
        lat: pinLat!,
        lng: pinLng!,
        description: description.trim() || undefined,
        team_type: teamType,
        emergency_phone: phone.trim(),
      });
      window.location.hash = `#/teams/${result.team.id}`;
    } catch (err) { setCreateError(err instanceof Error ? err.message : 'Team তৈরি হয়নি।'); }
    finally { setCreateBusy(false); }
  };


  return (
    <div className="page">
      <header className="hero page-hero">
        <a className="back-arrow" href="#/" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <div><h1>পাশে আছি</h1><p>আপনার মহল্লার ভলান্টিয়ার টিম — বিপদে একসাথে</p></div>
      </header>


      <div className="teams-toolbar">
        <div className="searchbar">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="🔍 টিমের নাম / এলাকা লিখো…" aria-label="টিম খুঁজুন" />
        </div>
        <div className="typechips">
          <button className={`tchip${typeFilter === '' ? ' on' : ''}`} onClick={() => setTypeFilter('')}>সব</button>
          {TEAM_TYPES.map((t) => (
            <button key={t} className={`tchip${typeFilter === t ? ' on' : ''}`} onClick={() => setTypeFilter(typeFilter === t ? '' : t)}>
              {TEAM_TYPE_META[t].emoji} {TEAM_TYPE_META[t].bn}
            </button>
          ))}
        </div>
      </div>

      <div className="section-heading">
        <h2 className="sec">📍 আশেপাশের টিম</h2>
        <button className="small-btn" onClick={loadNearby} disabled={nearbyLoading}>{nearbyLoading ? 'খুঁজছে…' : '↻ রিফ্রেশ'}</button>
      </div>
      {nearbyError && <Message error>{nearbyError}</Message>}
      {!nearbyError && nearbyLoading && <p className="state">আশেপাশের team খুঁজছে…</p>}
      {!nearbyError && !nearbyLoading && nearby.length === 0 && <p className="state">আশেপাশে কোনো team পাওয়া যায়নি। নিচে সব team দেখুন।</p>}
      <div className="feed">{nearby.map((team) => <TeamCard key={team.id} team={team} />)}</div>

      <div className="section-heading">
        <h2 className="sec">🌍 সব টিম</h2>
        <button className="small-btn" onClick={() => { setShowCreate((v) => !v); setStep(1); }}>{showCreate ? 'ফর্ম বন্ধ' : '＋ নতুন টিম'}</button>
      </div>

      {showCreate && (
        <div className="card stack-form">
          <div className="form-steps"><div className={`form-step${step >= 1 ? ' on' : ''}`} /><div className={`form-step${step >= 2 ? ' on' : ''}`} /></div>
          {step === 1 && (
            <>
              <h3>নতুন টিম — লোকেশন</h3>
              <label>বিভাগ
                <select value={divisionId} onChange={(event) => setDivisionId(event.target.value)}>
                  <option value="">বেছে নিন</option>
                  {divisions.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}
                </select>
              </label>
              <div className="loc-grid">
                <label>জেলা <span className="req">*</span>
                  <select value={districtId} disabled={!divisionId} onChange={(event) => setDistrictId(event.target.value)}>
                    <option value="">বেছে নিন</option>
                    {districts.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}
                  </select>
                </label>
                <label>থানা <span className="req">*</span>
                  <select value={thanaId} disabled={!districtId} onChange={(event) => setThanaId(event.target.value)}>
                    <option value="">বেছে নিন</option>
                    {thanas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="loc-grid">
                <label>এলাকা <span className="req">*</span>
                  <input value={elaka} onChange={(event) => setElaka(event.target.value)} placeholder="যেমন: মিরপুর ১০, ব্লক C" maxLength={200} />
                </label>
                <label>গলি / রোড
                  <input value={goli} onChange={(event) => setGoli(event.target.value)} placeholder="ঐচ্ছিক" maxLength={200} />
                </label>
              </div>
              {!showMap && (
                <button type="button" className="gps-btn" onClick={() => setShowMap(true)}>
                  📍 Map-এ টিমের location pin করো <span className="req">*</span>
                </button>
              )}
              {showMap && (
                <div className="map-wrap">
                  <MapPicker lat={pinLat} lng={pinLng} onPick={(la, ln) => { setPinLat(la); setPinLng(ln); }} />
                  {pinLat !== null && <p className="meta ok">✓ Pin বসেছে ({pinLat.toFixed(4)}, {pinLng!.toFixed(4)})</p>}
                </div>
              )}
              <button className="primary-btn" disabled={!step1Valid} onClick={() => setStep(2)}>পরবর্তী →</button>
            </>
          )}
          {step === 2 && (
            <>
              <h3>নতুন টিম — তথ্য</h3>
              <label>টিমের নাম <span className="req">*</span>
                <input required minLength={3} maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="যেমন: মিরপুর ১০ যুব সংঘ" />
              </label>
              <label>Emergency phone <span className="req">*</span>
                <input required minLength={6} maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" />
              </label>
              <label>বিবরণ
                <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="টিম সম্পর্কে লিখো (ঐচ্ছিক)" maxLength={1000} />
              </label>
              <label>টিমের ধরন <span className="req">*</span></label>
              <div className="type-grid">
                {TEAM_TYPES.map((t) => (
                  <button type="button" key={t} className={`type-opt${teamType === t ? ' on' : ''}`} onClick={() => setTeamType(t)}>
                    <span className="type-emoji">{TEAM_TYPE_META[t].emoji}</span>
                    <span>{TEAM_TYPE_META[t].bn}</span>
                  </button>
                ))}
              </div>
              {!profile && <Message error>Team তৈরি করতে login করুন।</Message>}
              {createError && <Message error>{createError}</Message>}
              <div className="form-nav">
                <button className="small-btn" onClick={() => setStep(1)}>← পেছনে</button>
                <button className="primary-btn" disabled={!profile || createBusy} onClick={() => void onCreate()}>
                  {createBusy ? 'তৈরি হচ্ছে…' : '✓ টিম তৈরি করো'}
                </button>
              </div>
              <p className="meta">তুমি হবে এই টিমের <b>lead</b>।</p>
            </>
          )}
        </div>
      )}

      {error && <Message error>{error}</Message>}
      {loading && <p className="state">Team লোড হচ্ছে…</p>}
      {!loading && !error && teams.length === 0 && <p className="state">কোনো team পাওয়া যায়নি। প্রথম team তৈরি করুন।</p>}
      <div className="feed">{teams.map((team) => <TeamCard key={team.id} team={team} />)}</div>
    </div>
  );
}

export function TeamDetailPage({ teamId, profile }: { teamId: string; profile: AppProfile | null }) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [isLead, setIsLead] = useState(false);

  const reload = () => {
    setLoading(true); setError('');
    fetchTeamDetail(teamId)
      .then((data) => {
        setDetail(data);
        const me = data.roster.find((m) => profile && m.user_id === profile.id);
        setIsMember(!!me);
        setIsLead(me?.role === 'lead');
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Team লোড হয়নি।'))
      .finally(() => setLoading(false));
  };
  useEffect(reload, [teamId]);

  const join = async () => {
    if (!profile) { setError('Team-এ যোগ দিতে login করুন।'); return; }
    if (phone.trim().length < 6) { setError('যোগাযোগের সঠিক নম্বর দিন।'); return; }
    setBusy(true); setError('');
    try { await joinTeam(teamId, phone.trim()); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Team-এ যোগ দেওয়া যায়নি।'); }
    finally { setBusy(false); }
  };

  const leave = async () => {
    if (!window.confirm('এই team ছেড়ে দেবে?')) return;
    setBusy(true); setError('');
    try { await leaveTeam(teamId); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Team ছাড়া যায়নি।'); }
    finally { setBusy(false); }
  };

  const removeMember = async (userId: string, name: string) => {
    if (!window.confirm(`${name}-কে team থেকে সরিয়ে দেবে?`)) return;
    try { await removeTeamMember(teamId, userId); reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'সরানো যায়নি।'); }
  };

  if (loading) return <div className="page"><p className="state">Team লোড হচ্ছে…</p></div>;
  if (error || !detail) return <div className="page"><p className="state err">{error || 'Team পাওয়া যায়নি।'}</p><a className="back-arrow" href="#/teams" aria-label="ফিরে যাও">‹ টিমে ফিরে যাও</a></div>;

  const { team, roster } = detail;
  const meta = TEAM_TYPE_META[team.team_type] ?? TEAM_TYPE_META.general;
  const area = [team.elaka_text ?? team.area_text, team.goli_text, team.thana_name, team.district_name].filter(Boolean).join(', ');

  return (
    <div className="page">
      <header className="hero page-hero">
        <a className="back-arrow" href="#/teams" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <div>
          <p className="hero-kicker">{meta.emoji} {meta.bn} টিম</p>
          <h1>{team.name}</h1>
          <p>{area}</p>
        </div>
      </header>

      {team.description && <section className="card"><p>{team.description}</p></section>}

      <div className="stat-row">
        <div className="stat"><b>{roster.length}</b><small>volunteer</small></div>
        <div className="stat"><b>{team.distance_km !== null ? `${team.distance_km}km` : '—'}</b><small>দূরত্ব</small></div>
        <div className="stat"><b>০</b><small>SOS responded</small></div>
      </div>

      <section className="card sos-card">
        <h2>🚨 Emergency যোগাযোগ</h2>
        {isMember ? (
          <TeamContacts teamId={teamId} />
        ) : (
          <p className="meta">যোগাযোগের নম্বর শুধু team member-রা দেখতে পারেন। নিচে Join করো।</p>
        )}
        <a className="contact-row call999" href="tel:999"><b>৯৯৯ — জাতীয় জরুরি সেবা</b><span>কল করুন →</span></a>
      </section>

      <div className="section-heading"><h2 className="sec">সদস্যরা ({roster.length})</h2></div>
      {roster.length === 0 && <p className="state">এখনো কোনো সদস্য নেই।</p>}
      {roster.map((m) => (
        <div className="member-row" key={m.user_id}>
          <div className="avatar">👤</div>
          <div className="member-info"><b>{m.name}{m.role === 'lead' && <span className="lead-tag">LEAD</span>}</b></div>
          {isLead && m.role !== 'lead' && (
            <button className="small-btn danger" onClick={() => void removeMember(m.user_id, m.name)}>সরাও</button>
          )}
        </div>
      ))}

      <div className="detail-actions">
        {!isMember && (
          <div className="join-box">
            <label>যোগাযোগের নম্বর <span className="req">*</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="01XXXXXXXXX" />
            </label>
            <button className="primary-btn" disabled={busy || !profile} onClick={() => void join()}>
              {busy ? 'যোগ দিচ্ছে…' : 'এই team-এ যোগ দিন'}
            </button>
            {!profile && <p className="meta">Join করতে login করুন।</p>}
          </div>
        )}
        {isMember && !isLead && (
          <button className="small-btn" disabled={busy} onClick={() => void leave()}>Team ছেড়ে দাও</button>
        )}
      </div>
      {error && <Message error>{error}</Message>}
    </div>
  );
}

function TeamContacts({ teamId }: { teamId: string }) {
  const [contacts, setContacts] = useState<EmergencyContacts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetchEmergencyContacts(teamId)
      .then(setContacts)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'যোগাযোগের তথ্য পাওয়া যায়নি।'));
  }, [teamId]);
  if (error) return <p className="meta err">{error}</p>;
  if (!contacts) return <p className="meta">লোড হচ্ছে…</p>;
  return (
    <div className="contacts">
      {contacts.members.map((member) => (
        <a className="contact-row" key={member.user_id} href={`tel:${member.emergency_phone}`}>
          <b>{member.name} {member.role === 'lead' ? '(টিম লিড)' : ''}</b><span>{member.emergency_phone} →</span>
        </a>
      ))}
    </div>
  );
}

function HistoryPanel({ reportId }: { reportId: string }) {
  const [history, setHistory] = useState<ReportHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReportHistory(reportId)
      .then(setHistory)
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) return <p className="state">ইতিহাস লোড হচ্ছে…</p>;
  if (!history) return <p className="state err">ইতিহাস লোড হয়নি।</p>;
  return (
    <div className="history-panel">
      {history.accused_name && (
        <p className="meta"><b>অভিযুক্ত (শুধু মডারেটর):</b> {history.accused_name}</p>
      )}
      <b>স্ট্যাটাস ইতিহাস</b>
      {history.status_history.length === 0 && <p className="meta">কোনো পরিবর্তন নেই।</p>}
      <ul className="audit-list">
        {history.status_history.map((h, i) => (
          <li key={i}>
            <span className="chip status">{STATUS_BN[h.toStatus] ?? h.toStatus}</span>
            <small>{h.fromStatus ? `${STATUS_BN[h.fromStatus] ?? h.fromStatus} → ` : ''}{new Date(h.createdAt).toLocaleString('bn-BD')}</small>
            {h.note && <p className="meta">{h.note}</p>}
          </li>
        ))}
      </ul>
      <b>মডারেশন লগ</b>
      {history.moderation_actions.length === 0 && <p className="meta">কোনো মডারেশন অ্যাকশন নেই।</p>}
      <ul className="audit-list">
        {history.moderation_actions.map((a, i) => (
          <li key={i}>
            <span className={`chip status ${a.action === 'verify' ? 'st-verified' : 'st-rejected'}`}>
              {a.action === 'verify' ? 'যাচাই' : 'বাতিল'}
            </span>
            <small>{a.moderatorName ?? 'মডারেটর'} • {new Date(a.createdAt).toLocaleString('bn-BD')}</small>
            {a.reason && <p className="meta">{a.reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    fetchAdminUsers()
      .then((d) => setUsers(d.users))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'ব্যবহারকারী লোড হয়নি।'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const changeRole = async (id: string, role: 'citizen' | 'volunteer' | 'moderator') => {
    setWorkingId(id);
    setError('');
    try {
      await setUserRole(id, role);
      setUsers((current) => current.map((u) => (u.id === id ? { ...u, role } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'রোল বদলানো যায়নি।');
    } finally {
      setWorkingId('');
    }
  };

  const roleName = (role: string) =>
    role === 'admin' ? 'অ্যাডমিন' : role === 'moderator' ? 'মডারেটর' : role === 'volunteer' ? 'স্বেচ্ছাসেবক' : 'নাগরিক';

  return (
    <div>
      <p className="meta">শুধু অ্যাডমিন: citizen / volunteer / moderator রোল দিন। admin রোল এখানে বদলানো যায় না, নিজের রোলও না।</p>
      {loading && <p className="state">ব্যবহারকারী লোড হচ্ছে…</p>}
      {error && <Message error>{error}</Message>}
      <div className="feed">
        {users.map((u) => (
          <div className="card user-row" key={u.id}>
            <div className="user-main">
              <b>{u.name}</b>
              <small className="meta">{u.phone} • বর্তমান: {roleName(u.role)}</small>
            </div>
            {u.role === 'admin' ? (
              <span className="chip status">সুরক্ষিত</span>
            ) : (
              <div className="card-actions">
                {(['citizen', 'volunteer', 'moderator'] as const).map((r) => (
                  <button
                    key={r}
                    className={u.role === r ? 'small-btn on' : 'small-btn'}
                    disabled={workingId === u.id || u.role === r}
                    onClick={() => void changeRole(u.id, r)}
                  >
                    {roleName(r)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {!loading && !error && users.length === 0 && <p className="state">কোনো ব্যবহারকারী নেই।</p>}
    </div>
  );
}

export function ModerationPage({ profile }: { profile: AppProfile | null }) {
  const [queue, setQueue] = useState<FeedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [workingId, setWorkingId] = useState('');
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [targetStatuses, setTargetStatuses] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<ModerationStats | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'reports' | 'users'>('reports');
  const statusOptions = Object.keys(STATUS_BN);
  const isAdmin = profile?.role === 'admin';

  const load = (offset = 0, append = false) => {
    setLoading(true); setError('');
    fetchModerationQueue(scope, offset)
      .then((data) => {
        setQueue((current) => append ? [...current, ...data.queue] : data.queue);
        setTotal(data.count);
        setNextOffset(data.nextOffset);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Report list লোড হয়নি।'))
      .finally(() => setLoading(false));
    fetchModerationStats().then(setStats).catch(() => setStats(null));
  };
  useEffect(() => { load(0, false); }, [scope]);

  const change = async (reportId: string, status: string) => {
    setWorkingId(reportId); setError('');
    try {
      await moderateReport(reportId, status, notes[reportId]?.trim() || undefined);
      setNotes((current) => ({ ...current, [reportId]: '' }));
      load(0, false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Status পরিবর্তন হয়নি।'); }
    finally { setWorkingId(''); }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}><a className="back-arrow" href="#/" aria-label="ফিরে যাও">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <h1 style={{ margin: 0 }}>Moderator / Admin — report control</h1>
      </div>
      <p className="meta">রিপোর্ট জমা হলেই public-এ যায়। এখান থেকে আপনি যাচাই, status update বা reject করে public feed থেকে সরাতে পারবেন। আপনার note reporter-এর Track page-এ দেখা যাবে।</p>
      {!profile && <Message error>Login করে profile সম্পূর্ণ করুন।</Message>}
      {stats && (
        <div className="stat-grid mod-stats">
          <div><b>{stats.pending}</b><small>অপেক্ষমাণ</small></div>
          <div><b>{stats.verified_today}</b><small>আজ যাচাই</small></div>
          <div><b>{stats.rejected_today}</b><small>আজ বাতিল</small></div>
          <div><b>{stats.avg_verify_hours ?? '—'}</b><small>গড় যাচাই (ঘণ্টা)</small></div>
        </div>
      )}
      <div className="filters">
        <button className={tab === 'reports' ? 'fchip on' : 'fchip'} onClick={() => setTab('reports')}>রিপোর্ট</button>
        {isAdmin && <button className={tab === 'users' ? 'fchip on' : 'fchip'} onClick={() => setTab('users')}>ব্যবহারকারী</button>}
      </div>
      {tab === 'users' && isAdmin && <AdminUsersTab />}
      {tab === 'reports' && (
      <>
      <div className="filters">
        <button className={scope === 'pending' ? 'fchip on' : 'fchip'} onClick={() => setScope('pending')}>যাচাই বাকি</button>
        <button className={scope === 'all' ? 'fchip on' : 'fchip'} onClick={() => setScope('all')}>সব report ({total})</button>
      </div>
      {loading && <p className="state">Report লোড হচ্ছে…</p>}
      {error && <Message error>{error}</Message>}
      {!loading && !error && queue.length === 0 && <p className="state">{scope === 'pending' ? 'যাচাইয়ের অপেক্ষায় কোনো report নেই।' : 'এখনো কোনো report জমা হয়নি।'}</p>}
      <div className="feed">{queue.map((report) => (
        <article className="mcard" key={report.id}>
          <div className="rtop">
            <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
            <TierBadge tier={report.verificationTier} />
          </div>
          <h3>{report.title}</h3>
          <div className="mrow">
            <span>✓ <b>{report.corroborationCount}</b> নিশ্চিত</span>
            <span className={`chip status st-${report.status}`}>{STATUS_BN[report.status] ?? report.status}</span>
            <span>tracking: <b>{report.trackingId}</b></span>
          </div>
          <p className="meta">{report.addressText}</p>
          <p className="desc">{report.description}</p>
          <label className="form-label">Reporter-এর Track page-এ দেখানোর moderator note
            <textarea rows={2} maxLength={1000} value={notes[report.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="যাচাই বা status update সম্পর্কে জানাতে লিখুন" />
          </label>
          <div className="mbtns">
            <button className="mbtn info" onClick={() => setExpandedId((current) => current === report.id ? null : report.id)}>
              {expandedId === report.id ? 'ইতিহাস লুকান' : 'ইতিহাস / লগ'}
            </button>
            {scope === 'pending' ? (
              <>
                <button className="mbtn ok" disabled={workingId === report.id} onClick={() => void change(report.id, 'verified')}>✓ প্রহরী সিল</button>
                <button className="mbtn no" disabled={workingId === report.id} onClick={() => void change(report.id, 'rejected')}>✕ বাতিল</button>
              </>
            ) : (
              <>
                <select aria-label={`${report.trackingId} report status`} value={targetStatuses[report.id] ?? report.status} disabled={workingId === report.id} onChange={(event) => setTargetStatuses((current) => ({ ...current, [report.id]: event.target.value }))}>
                  {statusOptions.map((status) => <option key={status} value={status}>{STATUS_BN[status] ?? status}</option>)}
                </select>
                <button className="mbtn ok" disabled={workingId === report.id || ((targetStatuses[report.id] ?? report.status) === report.status && !notes[report.id]?.trim())} onClick={() => void change(report.id, targetStatuses[report.id] ?? report.status)}>Status / note update করুন</button>
              </>
            )}
          </div>
          {expandedId === report.id && <HistoryPanel reportId={report.id} />}
        </article>
      ))}</div>
      {nextOffset !== null && <button className="small-btn" disabled={loading} onClick={() => load(nextOffset, true)}>আরও report দেখুন</button>}
      </>)}
    </div>
  );
}
