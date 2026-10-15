import { useEffect, useState } from 'react';
import { fetchTrends, type Trends } from './api';
import { useLang } from './i18n';
import { CATEGORY_KEYS } from './labels';

const PALETTE: Record<string, string> = {
  khun: '#d92632',
  ghum: '#7b5cff',
  churi: '#e8930c',
  dakati: '#b3541e',
  dhorshon: '#c026d3',
  eveteasing: '#1f6feb',
  madok: '#0e9f8a',
  durniti: '#64748b',
  other: '#9aa7b5',
};

function WeeklyChart({ trends }: { trends: Trends }) {
  const { label } = useLang();
  const W = 640, H = 270, PL = 34, PB = 34, PT = 14;
  const weeks = trends.by_week;
  const maxTotal = Math.max(1, ...weeks.map((w) => w.total));
  const slot = (W - PL - 10) / weeks.length;
  const bw = slot * 0.62;
  const y0 = H - PB;
  const scale = (H - PB - PT) / maxTotal;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="সাপ্তাহিক অপরাধ">
      {[0.25, 0.5, 0.75, 1].map((f) => {
        const y = y0 - maxTotal * f * scale;
        return (
          <g key={f}>
            <line x1={PL} y1={y} x2={W - 6} y2={y} stroke="#e3e8ee" />
            <text x={PL - 5} y={y + 4} fontSize="10" textAnchor="end" fill="#9aa7b5">
              {Math.round(maxTotal * f)}
            </text>
          </g>
        );
      })}
      {weeks.map((w, i) => {
        const x = PL + i * slot + (slot - bw) / 2;
        let acc = 0;
        return (
          <g key={w.week_start}>
            {CATEGORY_KEYS.filter((c) => (w.counts[c] ?? 0) > 0).map((c) => {
              const v = w.counts[c] ?? 0;
              const h = v * scale;
              const y = y0 - (acc + v) * scale;
              acc += v;
              return <rect key={c} x={x} y={y} width={bw} height={Math.max(h, 0.5)} fill={PALETTE[c] ?? '#9aa7b5'} rx="2" />;
            })}
            {w.total > 0 && (
              <text x={x + bw / 2} y={y0 - w.total * scale - 5} fontSize="10" textAnchor="middle" fill="#33404f" fontWeight="700">
                {w.total}
              </text>
            )}
            {i % 2 === 0 && (
              <text x={x + bw / 2} y={H - 12} fontSize="9.5" textAnchor="middle" fill="#9aa7b5">
                {w.week_start.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      <g>
        {CATEGORY_KEYS.filter((c) => weeks.some((w) => (w.counts[c] ?? 0) > 0)).map((c, i) => (
          <g key={c} transform={`translate(${PL + i * 108}, 2)`}>
            <rect width="10" height="10" rx="2" fill={PALETTE[c]} />
            <text x="14" y="9.5" fontSize="10.5" fill="#33404f">{label('category', c)}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function DistrictChart({ trends }: { trends: Trends }) {
  const rows = trends.by_district;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const W = 640, RH = 30, PL = 130;
  const H = rows.length * RH + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="জেলা অনুযায়ী">
      {rows.map((r, i) => {
        const w = ((W - PL - 44) * r.count) / max;
        return (
          <g key={r.district_id ?? 'unknown'} transform={`translate(0, ${i * RH + 4})`}>
            <text x={PL - 8} y={17} fontSize="11.5" textAnchor="end" fill="#33404f">
              {(r.district_name ?? 'অজানা').slice(0, 18)}
            </text>
            <rect x={PL} y={4} width={Math.max(w, 2)} height={16} rx={8} fill="#1f6feb" />
            <text x={PL + w + 7} y={17} fontSize="11.5" fill="#33404f" fontWeight="700">{r.count}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function TrendsPage() {
  const { t } = useLang();
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTrends()
      .then(setTrends)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, []);

  return (
    <div className="page">
      <a className="back" href="#/">{t('back_home')}</a>
      <h2 className="sec">{t('trends_h')}</h2>
      <p className="meta">যাচাইকৃত রিপোর্ট • গত ১২ সপ্তাহ</p>
      {error && <p className="state err">{error}</p>}
      {!trends && !error && <p className="state">{t('loading')}</p>}
      {trends && (
        <>
          <div className="stat-grid">
            <div>
              <b>{trends.verification_rate_pct ?? '—'}%</b>
              <small>যাচাইয়ের হার</small>
            </div>
            <div>
              <b>{trends.resolution_rate_pct ?? '—'}%</b>
              <small>সমাধানের হার</small>
            </div>
          </div>
          <h3 className="sec">সাপ্তাহিক অপরাধ (ধরন অনুযায়ী)</h3>
          <div className="card chart-card"><WeeklyChart trends={trends} /></div>
          <h3 className="sec">জেলা টপ ১০</h3>
          <div className="card chart-card">
            {trends.by_district.length === 0
              ? <p className="state">তথ্য নেই।</p>
              : <DistrictChart trends={trends} />}
          </div>
        </>
      )}
    </div>
  );
}
