import { useEffect, useState } from 'react';
import { fetchReportByTrackingId, caseShareUrl, type ReportDetail } from './api';
import { useLang } from './i18n';
import { CATEGORY_BN, STATUS_BN, TIER_BN } from './labels';
import ShareButtons from './share';

function TierBadge({ tier }: { tier: string }) {
  return <span className={`chip tier tier-${tier}`}>{TIER_BN[tier] ?? TIER_BN.none}</span>;
}

/** Public shareable case card: status banner + report detail + share buttons. */
export default function CasePage({ trackingId }: { trackingId: string }) {
  const { t, label } = useLang();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState('');

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
  const { report: r, history, media } = detail;
  const resolved = r.status === 'resolved';
  const shareUrl = caseShareUrl(trackingId);
  const shareText = `${r.title} — ${resolved ? t('case_resolved') : t('case_unresolved')}`;

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <div className={resolved ? 'case-banner resolved' : 'case-banner'}>
        {resolved ? t('case_resolved') : t('case_unresolved')}
      </div>
      <article className="card">
        <div className="card-top">
          <span className="chip cat">{label('category', r.category)}</span>
          <TierBadge tier={r.verificationTier} />
          <span className={`chip status st-${r.status}`}>{STATUS_BN[r.status] ?? r.status}</span>
        </div>
        <h3>{r.title}</h3>
        <p className="meta">{r.addressText} • {r.trackingId}</p>
        <p className="desc">{r.description}</p>
        {r.accusedName && (
          <p className="accused-line">
            {t('accused_label')}: <b>{r.accusedName}</b>
          </p>
        )}
        {r.verificationTier === 'none' && r.corroborationCount < 10 && (
          <p className="tier-progress">{t('tier_progress').replace('{n}', String(10 - r.corroborationCount))}</p>
        )}
        <p className="corro">
          {r.corroborationCount} {t('confirmed_by')} • {media.length} {t('evidence_attached')}
        </p>
      </article>

      <h2 className="sec">{t('share_case')}</h2>
      <div className="card">
        <ShareButtons url={shareUrl} text={shareText} />
        <p className="meta">শেয়ার করলে Facebook/WhatsApp/Telegram-এ কেসের শিরোনাম ও অবস্থা দেখা যাবে।</p>
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
    </div>
  );
}
