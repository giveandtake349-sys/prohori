import { useEffect, useState } from 'react';
import { fetchReportByTrackingId, caseShareUrl, shareReport, type ReportDetail } from './api';
import { CaseTeamBox } from './growth';
import { useLang } from './i18n';
import { STATUS_BN } from './labels';
import ShareButtons from './share';
import {
  CasePrintView,
  ClaimVotes,
  DeadlineTag,
  FollowButton,
  StageBadge,
  StageProgress,
  stageOf,
} from './v12';

/** Public shareable case card: status banner + report detail + share buttons. */
export default function CasePage({ trackingId, signedIn }: { trackingId: string; signedIn: boolean }) {
  const { t, label } = useLang();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    fetchReportByTrackingId(trackingId)
      .then(setDetail)
      .catch(() => setError('রিপোর্ট পাওয়া যায়নি / Report not found'));
  }, [trackingId]);

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
  const stage = stageOf(r);
  const shareUrl = caseShareUrl(trackingId);
  const shareText = `${r.title} — ${resolved ? t('case_resolved') : t('case_unresolved')}`;
  const threshold = r.stageThreshold ?? (stage === 0 ? 2 : stage === 3 ? undefined : 10);

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <div className={resolved ? 'case-banner resolved' : 'case-banner'}>
        {resolved ? t('case_resolved') : t('case_unresolved')}
      </div>
      <div className="dhero">
        <StageBadge stage={stage} />
        <h2>{r.title}</h2>
        <p className="rmeta">{r.trackingId} • {r.addressText}</p>
        <DeadlineTag
          deadlineAt={r.deadlineAt}
          overdue={r.overdue}
          escalationLevel={r.escalationLevel}
          resolved={resolved}
        />
      </div>
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
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg> PDF
        </button>
      </div>
      <article className="card">
        <div className="card-top">
          <span className="chip cat">{label('category', r.category)}</span>
          <span className={`chip status st-${r.status}`}>{STATUS_BN[r.status] ?? r.status}</span>
        </div>
        <p className="desc">{r.description}</p>
        {r.accusedName && (
          <p className="accused-line">
            {t('accused_label')}: <b>{r.accusedName}</b>
          </p>
        )}
        <StageProgress count={r.corroborationCount} threshold={threshold} stage={stage} />
        <p className="corro">
          {r.corroborationCount} {t('confirmed_by')} • {media.length} {t('evidence_attached')}
        </p>
        <ClaimVotes reportId={r.id} claims={claims} signedIn={signedIn} />
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

      <CaseTeamBox reportId={r.id} signedIn={signedIn} />

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
