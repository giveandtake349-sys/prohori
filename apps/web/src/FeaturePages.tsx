import { useEffect, useState, type FormEvent } from 'react';
import {
  corroborateReport,
  createReport,
  createTeam,
  fetchDivisions,
  fetchDistricts,
  fetchEmergencyContacts,
  checkFraudNumber,
  fetchModerationQueue,
  fetchReportByTrackingId,
  fetchReports,
  fetchTeams,
  fetchThanas,
  joinTeam,
  moderateReport,
  reportFraudNumber,
  sendSos,
  submitActionClaim,
  type AppProfile,
  type District,
  type Division,
  type EmergencyContacts,
  type FeedReport,
  type FraudCheck,
  type ReportDetail,
  type Team,
  type Thana,
} from './api';
import { CATEGORY_BN, CATEGORY_KEYS, STATUS_BN, TIER_BN } from './labels';

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
  return <span className={`chip tier tier-${tier}`}>{TIER_BN[tier] ?? TIER_BN.none}</span>;
}

function TierProgress({ report }: { report: FeedReport }) {
  if (report.verificationTier !== 'none') return null;
  const remaining = Math.max(0, 10 - report.corroborationCount);
  return remaining > 0 ? <p className="tier-progress">আরও {remaining} জন নিশ্চিত করলে জনতা যাচাইকৃত হবে</p> : null;
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

  return (
    <article className="card">
      <div className="card-top">
        <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
        <TierBadge tier={report.verificationTier} />
        <span className={`chip status st-${report.status}`}>{STATUS_BN[report.status] ?? report.status}</span>
      </div>
      <h3>{report.title}</h3>
      <p className="meta">{report.addressText} • {timeAgo(report.createdAt)}</p>
      <p className="desc">{report.description}</p>
      {report.accusedName && <p className="accused-line">অভিযুক্তের নাম: <b>{report.accusedName}</b></p>}
      <TierProgress report={report} />
      {report.status === 'submitted' && <p className="meta">এই রিপোর্টটি সরাসরি public-এ প্রকাশিত হয়েছে; এখনো যাচাই করা হয়নি।</p>}
      <div className="card-foot">
        <span className="corro">{report.corroborationCount} জন নিশ্চিত করেছে</span>
        <a className="track-link" href={`#/track/${encodeURIComponent(report.trackingId)}`}>
          ট্র্যাক করো ({report.trackingId}) →
        </a>
      </div>
      <ActionLine report={report} />
      {signedIn && report.status !== 'resolved' && report.status !== 'rejected' && (
        <div className="card-actions">
          <button className="small-btn" disabled={busy} onClick={() => void act(() => corroborateReport(report.id), 'আপনার corroboration নথিভুক্ত হয়েছে।')}>
            আমিও দেখেছি
          </button>
          <button className="small-btn" disabled={busy} onClick={() => void act(() => submitActionClaim(report.id, 'action_taken'), 'ব্যবস্থা নেওয়ার মতামত নথিভুক্ত হয়েছে।')}>
            ব্যবস্থা নেওয়া হয়েছে
          </button>
          <button className="small-btn secondary" disabled={busy} onClick={() => void act(() => submitActionClaim(report.id, 'no_action'), 'ব্যবস্থা না নেওয়ার মতামত নথিভুক্ত হয়েছে।')}>
            নেওয়া হয়নি
          </button>
        </div>
      )}
      {error && <Message error>{error}</Message>}
      {notice && <Message>{notice}</Message>}
    </article>
  );
}

export function HomePage({ signedIn }: { signedIn: boolean }) {
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = () => {
    setLoading(true);
    setError('');
    fetchReports(category || undefined)
      .then((data) => setReports(data.reports))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'রিপোর্ট লোড করা যায়নি।'))
      .finally(() => setLoading(false));
  };

  useEffect(reload, [category]);

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

export function TrackPage({ trackingId }: { trackingId: string }) {
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
  const { report, history, media } = detail;
  return (
    <div className="page">
      <a className="back" href="#/">← সব রিপোর্ট</a>
      <article className="card">
        <div className="card-top">
          <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
          <TierBadge tier={report.verificationTier} />
          <span className={`chip status st-${report.status}`}>{STATUS_BN[report.status] ?? report.status}</span>
        </div>
        <h3>{report.title}</h3>
        <p className="meta">{report.addressText} • {report.trackingId}</p>
        <p className="desc">{report.description}</p>
        {report.accusedName && <p className="accused-line">অভিযুক্তের নাম: <b>{report.accusedName}</b></p>}
        <TierProgress report={report} />
        <p className="corro">{report.corroborationCount} জন নিশ্চিত করেছে • {media.length}টি প্রমাণ সংযুক্ত</p>
        <ActionLine report={report} />
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
        <h1>রিপোর্ট ট্র্যাক করুন</h1>
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

export function NewReportPage({ signedIn }: { signedIn: boolean }) {
  const [category, setCategory] = useState(CATEGORY_KEYS[0] ?? 'other');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accusedName, setAccusedName] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number; address: string; districtId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trackingId, setTrackingId] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setTrackingId('');
    if (!signedIn) { setError('রিপোর্ট জমা দিতে login করুন।'); return; }
    if (!location) { setError('বিভাগ/জেলা/থানা বেছে নিন অথবা GPS অবস্থান দিন।'); return; }
    setBusy(true);
    try {
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
      });
      setTrackingId(result.tracking_id);
      setTitle('');
      setDescription('');
      setAccusedName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'রিপোর্ট জমা হয়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <a className="back" href="#/">← হোম</a>
      <section className="card">
        <h1>নিরাপদে অপরাধের রিপোর্ট দিন</h1>
        <p className="meta">তাৎক্ষণিক বিপদের ক্ষেত্রে জরুরি সেবা ৯৯৯-এ কল করুন। এই app জরুরি সেবার বিকল্প নয়।</p>
        <p className="meta">জমা দিলেই রিপোর্টটি public-এ প্রকাশ হবে। Anonymous বেছে নিলে আপনার পরিচয় গোপন থাকবে; কিন্তু report-এর শিরোনাম, বিবরণ ও অবস্থান public-এ দেখা যাবে।</p>
        {!signedIn && <Message error>রিপোর্ট জমা দিতে আগে login করুন।</Message>}
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label>ঘটনার ধরন<select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORY_KEYS.map((key) => <option key={key} value={key}>{CATEGORY_BN[key]}</option>)}</select></label>
          <label>শিরোনাম<input required minLength={3} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>ঘটনার বিবরণ<textarea required minLength={10} maxLength={5000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          {['dhorshon', 'khun', 'ghum'].includes(category) && <label>অভিযুক্তের নাম (ঐচ্ছিক)<input value={accusedName} onChange={(event) => setAccusedName(event.target.value)} maxLength={200} /><span className="meta">Officially verified না হওয়া পর্যন্ত এই নাম public-এ দেখানো হবে না।</span></label>}
          <div>
            <p className="field-label">ঘটনার অবস্থান</p>
            <LocationSelectors onLocation={setLocation} />
            {location && <p className="location-summary">নির্বাচিত অবস্থান: {location.address} ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})</p>}
          </div>
          <label className="checkbox-row"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> রিপোর্টটি public-এ anonymous রাখুন</label>
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
        <h1>প্রতারণার নম্বর যাচাই</h1>
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

function TeamCard({ team, profile, onJoined }: { team: Team; profile: AppProfile | null; onJoined: () => void }) {
  const [contacts, setContacts] = useState<EmergencyContacts | null>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const showContacts = async () => {
    setError('');
    try {
      setContacts(await fetchEmergencyContacts(team.id));
      setOpen((value) => !value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'যোগাযোগের তথ্য পাওয়া যায়নি।');
    }
  };
  const join = async () => {
    if (!profile) { setError('Team-এ যোগ দিতে login করুন।'); return; }
    setBusy(true); setError('');
    try {
      await joinTeam(team.id, phone.trim());
      onJoined();
      setContacts(await fetchEmergencyContacts(team.id));
      setOpen(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Team-এ যোগ দেওয়া যায়নি।'); }
    finally { setBusy(false); }
  };

  return (
    <article className="card">
      <h3>{team.name}</h3>
      <p className="meta">{team.area_text ?? 'এলাকা উল্লেখ নেই'} • {team.member_count} জন সদস্য</p>
      {team.distance_km !== null && <p className="meta">প্রায় {team.distance_km} কিমি দূরে</p>}
      <div className="card-actions">
        <button className="small-btn" onClick={() => void showContacts()}>জরুরি যোগাযোগ দেখুন</button>
      </div>
      {error && <Message error>{error.includes('403') || error.includes('only team members') ? 'এই নম্বরগুলো শুধু team member-রা দেখতে পারেন। যোগ দিতে নিচে আপনার নম্বর দিন।' : error}</Message>}
      {!open && (
        <div className="join-box">
          <label>যোগাযোগের নম্বর<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" /></label>
          <button className="small-btn" disabled={busy || !profile || phone.trim().length < 6} onClick={() => void join()}>{busy ? 'যোগ দিচ্ছে…' : 'এই team-এ যোগ দিন'}</button>
        </div>
      )}
      {open && contacts && (
        <div className="contacts">
          <a className="contact-row call999" href="tel:999"><b>৯৯৯ — জাতীয় জরুরি সেবা</b><span>কল করুন →</span></a>
          {contacts.members.map((member) => (
            <a className="contact-row" key={member.user_id} href={`tel:${member.emergency_phone}`}>
              <b>{member.name} {member.role === 'lead' ? '(টিম লিড)' : ''}</b><span>{member.emergency_phone} →</span>
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

export function TeamsPage({ profile }: { profile: AppProfile | null }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [thanas, setThanas] = useState<Thana[]>([]);
  const [divisionId, setDivisionId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [thanaId, setThanaId] = useState('');
  const [sosMessage, setSosMessage] = useState('');
  const [sosBusy, setSosBusy] = useState(false);
  const [sosStatus, setSosStatus] = useState('');
  const [sosError, setSosError] = useState('');

  const reload = () => {
    setLoading(true); setError('');
    fetchTeams().then((data) => setTeams(data.teams)).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Team লোড হয়নি।')).finally(() => setLoading(false));
  };
  useEffect(reload, []);
  useEffect(() => { void fetchDivisions().then((data) => setDivisions(data.divisions)).catch(() => undefined); }, []);
  useEffect(() => {
    setDistrictId(''); setThanaId(''); setDistricts([]); setThanas([]);
    if (divisionId) void fetchDistricts(divisionId).then((data) => setDistricts(data.districts)).catch(() => undefined);
  }, [divisionId]);
  useEffect(() => {
    setThanaId(''); setThanas([]);
    if (districtId) void fetchThanas(districtId).then((data) => setThanas(data.thanas)).catch(() => undefined);
  }, [districtId]);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) { setError('Team তৈরি করতে login করুন।'); return; }
    setError(''); setMessage('');
    try {
      const result = await createTeam({ name: name.trim(), district_id: districtId || undefined, thana_id: thanaId || undefined, area_text: area.trim() || undefined, emergency_phone: phone.trim() });
      setMessage(`“${result.team.name}” team তৈরি হয়েছে। আপনি team lead।`);
      setName(''); setArea(''); setShowCreate(false); reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'Team তৈরি হয়নি।'); }
  };

  const sendEmergency = () => {
    setSosError(''); setSosStatus('');
    if (!profile) { setSosError('SOS পাঠাতে login করুন।'); return; }
    if (!navigator.geolocation) { setSosError('এই browser GPS দেয় না।'); return; }
    setSosBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const result = await sendSos(position.coords.latitude, position.coords.longitude, 'GPS location', sosMessage.trim());
          setSosStatus(`SOS server-এ নথিভুক্ত। ${result.notified_user_count} কাছের user ও ${result.notified_teams.length} team চিহ্নিত হয়েছে।`);
          setSosMessage('');
        } catch (err) { setSosError(err instanceof Error ? err.message : 'SOS পাঠানো যায়নি।'); }
        finally { setSosBusy(false); }
      },
      () => { setSosError('লোকেশন অনুমতি দরকার। Browser location permission চালু করে আবার চেষ্টা করুন।'); setSosBusy(false); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  return (
    <div className="page">
      <header className="hero"><h1>পাশে আছি</h1><p>আপনার মহল্লার ভলান্টিয়ার টিম — বিপদে একসাথে</p></header>
      <section className="card sos-card">
        <h2>জরুরি SOS</h2>
        <p className="meta">আপনার GPS অবস্থান দিয়ে কাছের user ও team শনাক্ত হবে। এই MVP এখনো push notification বা SMS পাঠায় না—শুধু alert database-এ নথিভুক্ত করে এবং কাছের recipient গণনা করে। জীবন-ঝুঁকিতে ৯৯৯-এ কল করুন।</p>
        <label>বার্তা (ঐচ্ছিক)<input className="input" value={sosMessage} onChange={(event) => setSosMessage(event.target.value)} maxLength={500} placeholder="কী ধরনের সাহায্য দরকার?" /></label>
        <button className="sos-btn" onClick={sendEmergency} disabled={sosBusy || !profile}>{sosBusy ? 'অবস্থান নিচ্ছে…' : 'GPS দিয়ে SOS পাঠান'}</button>
        {sosError && <Message error>{sosError}</Message>}{sosStatus && <Message>{sosStatus}</Message>}
      </section>
      <div className="section-heading"><h2 className="sec">ভলান্টিয়ার টিম</h2><button className="small-btn" onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'ফর্ম বন্ধ' : '＋ নতুন team তৈরি'}</button></div>
      {showCreate && (
        <form className="card stack-form" onSubmit={(event) => void onCreate(event)}>
          <h3>পাশে আছি team তৈরি করুন</h3>
          <label>Team-এর নাম<input required minLength={3} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>এলাকা/মহল্লা<input maxLength={300} value={area} onChange={(event) => setArea(event.target.value)} placeholder="যেমন: মিরপুর ১০" /></label>
          <label>যোগাযোগের ফোন<input required minLength={6} maxLength={20} value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" /></label>
          <label>বিভাগ<select value={divisionId} onChange={(event) => setDivisionId(event.target.value)}><option value="">বেছে নিন</option>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}</select></label>
          <label>জেলা<select value={districtId} disabled={!divisionId} onChange={(event) => setDistrictId(event.target.value)}><option value="">বেছে নিন</option>{districts.map((item) => <option key={item.id} value={item.id}>{item.name_bn}</option>)}</select></label>
          <label>থানা<select value={thanaId} disabled={!districtId} onChange={(event) => setThanaId(event.target.value)}><option value="">বেছে নিন</option>{thanas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {!profile && <Message error>Team তৈরি করতে login করুন।</Message>}
          <button className="primary-btn" type="submit" disabled={!profile}>Team তৈরি করুন</button>
        </form>
      )}
      {message && <Message>{message}</Message>}{error && <Message error>{error}</Message>}
      {loading && <p className="state">Team লোড হচ্ছে…</p>}
      {!loading && !error && teams.length === 0 && <p className="state">এখনো কোনো team নেই। প্রথম team তৈরি করুন।</p>}
      <div className="feed">{teams.map((team) => <TeamCard key={team.id} team={team} profile={profile} onJoined={reload} />)}</div>
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
  const statusOptions = Object.keys(STATUS_BN);

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
      <h1>Moderator / Admin — report control</h1>
      <p className="meta">রিপোর্ট জমা হলেই public-এ যায়। এখান থেকে আপনি যাচাই, status update বা reject করে public feed থেকে সরাতে পারবেন। আপনার note reporter-এর Track page-এ দেখা যাবে।</p>
      {!profile && <Message error>Login করে profile সম্পূর্ণ করুন।</Message>}
      <div className="filters">
        <button className={scope === 'pending' ? 'fchip on' : 'fchip'} onClick={() => setScope('pending')}>যাচাই বাকি</button>
        <button className={scope === 'all' ? 'fchip on' : 'fchip'} onClick={() => setScope('all')}>সব report ({total})</button>
      </div>
      {loading && <p className="state">Report লোড হচ্ছে…</p>}
      {error && <Message error>{error}</Message>}
      {!loading && !error && queue.length === 0 && <p className="state">{scope === 'pending' ? 'যাচাইয়ের অপেক্ষায় কোনো report নেই।' : 'এখনো কোনো report জমা হয়নি।'}</p>}
      <div className="feed">{queue.map((report) => (
        <article className="card" key={report.id}>
          <div className="card-top">
            <span className="chip cat">{CATEGORY_BN[report.category] ?? report.category}</span>
            <span className={`chip status st-${report.status}`}>{STATUS_BN[report.status] ?? report.status}</span>
            <span className="chip status">{report.corroborationCount} corroboration</span>
          </div>
          <h3>{report.title}</h3>
          <p className="meta">{report.addressText} • tracking: {report.trackingId}</p>
          <p className="desc">{report.description}</p>
          <label>Reporter-এর Track page-এ দেখানোর moderator note
            <textarea rows={2} maxLength={1000} value={notes[report.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))} placeholder="যাচাই বা status update সম্পর্কে জানাতে লিখুন" />
          </label>
          <div className="card-actions">
            {scope === 'pending' ? (
              <>
                <button className="small-btn" disabled={workingId === report.id} onClick={() => void change(report.id, 'verified')}>যাচাই হয়েছে mark করুন</button>
                <button className="small-btn danger" disabled={workingId === report.id} onClick={() => void change(report.id, 'rejected')}>Reject করে public থেকে সরান</button>
              </>
            ) : (
              <>
                <select aria-label={`${report.trackingId} report status`} value={targetStatuses[report.id] ?? report.status} disabled={workingId === report.id} onChange={(event) => setTargetStatuses((current) => ({ ...current, [report.id]: event.target.value }))}>
                  {statusOptions.map((status) => <option key={status} value={status}>{STATUS_BN[status] ?? status}</option>)}
                </select>
                <button className="small-btn" disabled={workingId === report.id || ((targetStatuses[report.id] ?? report.status) === report.status && !notes[report.id]?.trim())} onClick={() => void change(report.id, targetStatuses[report.id] ?? report.status)}>Status / note update করুন</button>
              </>
            )}
          </div>
        </article>
      ))}</div>
      {nextOffset !== null && <button className="small-btn" disabled={loading} onClick={() => load(nextOffset, true)}>আরও report দেখুন</button>}
    </div>
  );
}
