import { useEffect, useState } from 'react';
import { fetchReportByTrackingId, caseShareUrl, type ReportDetail } from './api';
import { useLang } from './i18n';
import { CATEGORY_BN, STATUS_BN, TIER_BN } from './labels';
import ShareButtons from './share';

function TierBadge({ tier }: { tier: string }) {
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
      <div className="dhero">
        <TierBadge tier={r.verificationTier} />
        <h2>{r.title}</h2>
        <p className="rmeta">{r.trackingId} • {r.addressText}</p>
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
        {r.verificationTier === 'none' && r.corroborationCount < 10 && (
          <p className="tier-progress">{t('tier_progress').replace('{n}', String(10 - r.corroborationCount))}</p>
        )}
        <p className="corro">
          {r.corroborationCount} {t('confirmed_by')} • {media.length} {t('evidence_attached')}
        </p>
        {media.length > 0 && (
          <div className="evrow">
            {media.map((m, i) => (
              <a key={i} className="ev" href={m.url} target="_blank" rel="noreferrer" title={`SHA-256: ${m.sha256}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" /></svg>
                <img src={m.url} alt="প্রমাণ" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <span className="hash">{m.sha256.slice(0, 4)}…✓</span>
              </a>
            ))}
          </div>
        )}
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
