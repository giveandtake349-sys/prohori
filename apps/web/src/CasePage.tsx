import { useEffect, useState } from 'react';
import { fetchReportByTrackingId, caseShareUrl, shareReport, recordView, corroborateReport, type ReportDetail } from './api';
import { CaseTeamBox } from './growth';
import { useLang } from './i18n';
import { STATUS_BN } from './labels';
import ShareButtons from './share';
import {
  CasePrintView,
  ClaimVotes,
  DeadlineTag,
  FollowButton,
} from './v12';

/** v17: Viral Case File — report as a shareable weapon, not a form.
 *  Face (reporter) + Follow + Views are all real. Witness = 1-tap সাক্ষী
 *  (reuses corroborate). প্রমাণসহ badge is automatic (has media). */

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

export default function CasePage({ trackingId, signedIn }: { trackingId: string; signedIn: boolean }) {
  const { t, label } = useLang();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const [witnessed, setWitnessed] = useState(false);
  const [witnessCount, setWitnessCount] = useState(0);
  const [witnessBusy, setWitnessBusy] = useState(false);
  const [witnessMsg, setWitnessMsg] = useState('');

  useEffect(() => {
    fetchReportByTrackingId(trackingId)
      .then((d) => {
        setDetail(d);
        setWitnessCount(d.report.corroborationCount ?? 0);
        // v17: record a view once per session per report
        try {
          const key = `viewed_${d.report.id}`;
          if (!window.localStorage.getItem(key)) {
            window.localStorage.setItem(key, '1');
            recordView(d.report.id).catch(() => {});
          }
        } catch { /* private mode */ }
      })
      .catch(() => setError('রিপোর্ট পাওয়া যায়নি / Report not found'));
  }, [trackingId]);

  const doWitness = async () => {
    if (!detail || witnessBusy) return;
    if (!signedIn) {
      setWitnessMsg('সাক্ষী হতে login করো');
      return;
    }
    setWitnessBusy(true);
    setWitnessMsg('');
    try {
      const r = await corroborateReport(detail.report.id);
      setWitnessCount(r.corroboration_count);
      setWitnessed(true);
    } catch (e) {
      setWitnessMsg(e instanceof Error && e.message.includes('already') ? 'তুমি আগেই সাক্ষী দিয়েছো' : 'চেষ্টা ব্যর্থ হয়েছে');
    } finally {
      setWitnessBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <p className="state err">{error}</p>
        <a className="back" href="#/">{t('back_home')}</a>
      </div>
    );
  }
  if (!detail) return <div className="page"><p className="state">{t('loading')}</p></div>;
  const { report: r, history, media, claims } = detail;
  const resolved = r.status === 'resolved';
  const shareUrl = caseShareUrl(trackingId);
  const shareText = `${r.title} — ${resolved ? t('case_resolved') : t('case_unresolved')}`;
  const hasEvidence = media.length > 0;
  const views = r.viewCount ?? 0;
  const reporterLabel = r.isAnonymous ? 'বেনামী রিপোর্টার' : (r.reporterName ?? 'রিপোর্টার');
  const reporterInitial = r.isAnonymous ? '?' : (r.reporterName?.charAt(0) ?? 'র');

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>

      {/* HERO */}
      <div className="case-hero">
        <div className="badges">
          <span className="badge b-red">{label('category', r.category)}</span>
          {hasEvidence && <span className="badge b-green">✓ প্রমাণসহ</span>}
          {r.verificationTier === 'official' && <span className="badge b-gold">✓ প্রহরী যাচাইকৃত</span>}
          {r.verificationTier === 'community' && <span className="badge b-green">✓ জনতা যাচাইকৃত</span>}
        </div>
        <h1>{r.title}</h1>
        <p className="meta">{r.trackingId} · {fmtNum(views)} দেখেছে · {new Date(r.occurredAt).toLocaleDateString('bn-BD')}</p>
        <div className="reporter-row">
          <div className="avatar">{reporterInitial}</div>
          <div>
            <b>{reporterLabel}</b>
            <small>{r.addressText}</small>
          </div>
        </div>
      </div>

      {/* FACT BOX */}
      <div className="card factbox">
        <h4>মূল তথ্য</h4>
        <div className="frow"><span>কবে</span><b>{new Date(r.occurredAt).toLocaleString('bn-BD')}</b></div>
        <div className="frow"><span>কোথায়</span><b>{r.addressText}</b></div>
        <div className="frow"><span>অবস্থা</span><b>{STATUS_BN[r.status] ?? r.status}</b></div>
        <div className="frow"><span>প্রমাণ</span><b>{media.length} টি {hasEvidence ? '✓' : '(নেই)'}</b></div>
        {!resolved && (
          <DeadlineTag
            deadlineAt={r.deadlineAt}
            overdue={r.overdue}
            escalationLevel={r.escalationLevel}
            resolved={resolved}
          />
        )}
      </div>

      {/* DESCRIPTION + EVIDENCE */}
      <article className="card">
        <p className="desc">{r.description}</p>
        {r.accusedName && (
          <p className="accused-line">
            {t('accused_label')}: <b>{r.accusedName}</b>
          </p>
        )}
        {media.length > 0 && (
          <div className="evrow scroll-x">
            {media.map((m, i) => (
              <a key={i} className="ev" href={m.url} target="_blank" rel="noreferrer" title={`SHA-256: ${m.sha256}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                <img src={m.url} alt="প্রমাণ" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="hash">{(m.sha256 ?? '').slice(0, 4)}…✓</span>
              </a>
            ))}
          </div>
        )}
      </article>

      {/* WITNESS — 1-tap সাক্ষী (replaces staged thresholds) */}
      <div className="card witness-card">
        <div className="witness-top">
          <div>
            <b>{fmtNum(witnessCount)} জন সাক্ষী</b>
            <small>তুমিও এটা দেখেছো বা জানো?</small>
          </div>
          <button
            type="button"
            className={`witness-btn${witnessed ? ' done' : ''}`}
            onClick={doWitness}
            disabled={witnessBusy || witnessed}
          >
            {witnessed ? '✓ সাক্ষী দিয়েছো' : witnessBusy ? '…' : 'আমিও সাক্ষী'}
          </button>
        </div>
        {witnessMsg && <p className="meta" style={{ marginTop: 8 }}>{witnessMsg}</p>}
        <ClaimVotes reportId={r.id} claims={claims} signedIn={signedIn} />
      </div>

      {/* SHARE — the weapon */}
      <div className="card share-card">
        <h4>শেয়ার করো — চাপ বাড়াও</h4>
        <p className="meta">যত শেয়ার, তত চাপ। এটাই বিচারের পথ।</p>
        <div className="share-prominent">
          <ShareButtons
            url={shareUrl}
            text={shareText}
            onShared={() => {
              void shareReport(r.id).catch(() => undefined);
            }}
          />
          <FollowButton
            kind="report"
            id={r.id}
            initialFollowing={r.following}
            initialCount={r.followerCount}
            signedIn={signedIn}
          />
          <button type="button" className="pdf-btn" onClick={() => setShowPrint(true)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg> PDF
          </button>
        </div>
      </div>

      <CaseTeamBox reportId={r.id} signedIn={signedIn} />

      {/* PRESS KIT */}
      <div className="card presskit">
        <h4>সাংবাদিকদের জন্য</h4>
        <p><b>শিরোনাম:</b> {r.title}</p>
        <p><b>তারিখ:</b> {new Date(r.occurredAt).toLocaleDateString('bn-BD')} · <b>স্থান:</b> {r.addressText}</p>
        <p><b>প্রমাণ:</b> {media.length} টি (SHA-256 যাচাইকৃত) · <b>সাক্ষী:</b> {witnessCount} জন</p>
        <p><b>সূত্র:</b> {shareUrl}</p>
        {!r.isAnonymous && r.reporterName && <p><b>যোগাযোগ:</b> রিপোর্টারের অনুমতি সাপেক্ষে</p>}
      </div>

      <h2 className="sec">{t('progress')}</h2>
      <ol className="timeline">
        {history.map((h, i) => (
          <li key={i} className={i === history.length - 1 ? 'now' : 'done'}>
            <b>{label('status', h.toStatus)}</b>
            {h.note && <span>{h.note}</span>}
            <small>{new Date(h.createdAt).toLocaleString('bn-BD')}</small>
          </li>
        ))}
      </ol>
      {showPrint && (
        <CasePrintView report={r} media={media} history={history} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}
