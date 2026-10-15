import { useEffect, useState } from 'react';
import { fetchScorecards, fetchThanaScorecard, type Scorecard, type ScorecardDetail } from './api';
import { useLang } from './i18n';

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'এইমাত্র';
  if (minutes < 60) return `${minutes} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ঘণ্টা আগে`;
  return `${Math.floor(hours / 24)} দিন আগে`;
}

function ScoreBar({ score }: { score: number | null }) {
  const { t } = useLang();
  if (score === null) return <span className="score-na">{t('score_no_data')}</span>;
  const cls = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'bad';
  return (
    <span className="score-wrap">
      <span className="score-bar">
        <i className={cls} style={{ width: `${Math.min(100, score)}%` }} />
      </span>
      <b className={`score-num ${cls}`}>{score}</b>
    </span>
  );
}

export function ScorecardListPage() {
  const { t } = useLang();
  const [cards, setCards] = useState<Scorecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchScorecards()
      .then((d) => setCards(d.scorecards))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <h2 className="sec">{t('scorecard_h')}</h2>
      <p className="meta">{t('scorecard_sub')}</p>
      {loading && <p className="state">{t('loading')}</p>}
      {error && <p className="state err">{error}</p>}
      {!loading && !error && cards.length === 0 && <p className="state">{t('scorecard_empty')}</p>}
      <div className="feed">
        {cards.map((c, i) => (
          <a className="card score-row" key={c.thana_id} href={`#/scorecard/${c.thana_id}`}>
            <span className={`rank${i === 0 ? ' top' : ''}`}>#{i + 1}</span>
            <span className="score-main">
              <b>{c.thana_name}</b>
              <small>
                {c.district_name} • {c.verified_reports} {t('scorecard_verified_reports')} • {t('scorecard_resolved')} {c.resolved_count}
              </small>
            </span>
            <ScoreBar score={c.score} />
          </a>
        ))}
      </div>
      <p className="meta">{t('scorecard_formula')}</p>
    </div>
  );
}

export function ScorecardDetailPage({ thanaId }: { thanaId: string }) {
  const { t } = useLang();
  const [d, setD] = useState<ScorecardDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchThanaScorecard(thanaId)
      .then(setD)
      .catch(() => setError(t('scorecard_not_found')));
  }, [thanaId, t]);

  if (error) return <div className="page"><p className="state err">{error}</p><a className="back" href="#/scorecard">← {t('scorecard_h')}</a></div>;
  if (!d) return <div className="page"><p className="state">{t('loading')}</p></div>;

  return (
    <div className="page">
      <a className="back" href="#/scorecard">← {t('scorecard_h')}</a>
      <div className="card">
        <h3>{d.thana_name}</h3>
        <p className="meta">{d.district_name}</p>
        <div className="score-big">
          <ScoreBar score={d.score} />
        </div>
        <div className="stat-grid">
          <div><b>{d.total_reports}</b><small>{t('scorecard_total')}</small></div>
          <div><b>{d.resolution_rate_pct ?? '—'}%</b><small>{t('scorecard_resolution')}</small></div>
          <div><b>{d.action_taken_sum}</b><small>{t('scorecard_action_taken')}</small></div>
          <div><b>{d.no_action_sum}</b><small>{t('scorecard_no_action')}</small></div>
          <div><b>{d.avg_verify_to_resolve_hours ?? '—'}</b><small>{t('scorecard_avg_hours')}</small></div>
        </div>
      </div>
      <h2 className="sec">{t('scorecard_recent')}</h2>
      <div className="feed">
        {d.recent_reports.map((r) => (
          <a className="card" key={r.tracking_id} href={`#/track/${encodeURIComponent(r.tracking_id)}`}>
            <h3>{r.title}</h3>
            <p className="meta">{r.tracking_id} • {timeAgo(r.created_at)}</p>
          </a>
        ))}
        {d.recent_reports.length === 0 && <p className="state">{t('scorecard_no_reports')}</p>}
      </div>
    </div>
  );
}
