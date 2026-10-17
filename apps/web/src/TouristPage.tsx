import { useEffect, useMemo, useState } from 'react';
import { useLang } from './i18n';

const API = ''; // same origin via vite proxy / relative fetch

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error('request failed');
  return r.json() as Promise<T>;
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || 'request failed');
  return data as T;
}

export interface TouristSpot {
  id: number;
  nameEn: string;
  nameBn: string;
  district: string;
  division: string;
  type: string;
  description: string | null;
}
interface FairPrice {
  id: number;
  destination: string;
  district: string;
  category: string;
  routeOrItem: string;
  fairMinBdt: number;
  fairMaxBdt: number;
}
interface ScamExample {
  id: number;
  destination: string;
  title: string;
  fairPriceBdt: number | null;
  scamPriceBdt: number | null;
}

type View = 'home' | 'journey' | 'browse' | 'check' | 'report' | 'spot';

const SCAM_TYPES = [
  { v: 'overcharge', bn: 'বেশি দাম' },
  { v: 'fake_guide', bn: 'ভুয়া গাইড' },
  { v: 'hotel', bn: 'হোটেল প্রতারণা' },
  { v: 'restaurant', bn: 'রেস্টুরেন্ট' },
  { v: 'transport', bn: 'পরিবহন' },
  { v: 'harassment', bn: 'হয়রানি' },
  { v: 'other', bn: 'অন্যান্য' },
];

function priceFmt(min: number, max: number) {
  return min === max ? `৳${min.toLocaleString('en-US')}` : `৳${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`;
}

export default function TouristPage({ signedIn }: { signedIn: boolean }) {
  const { t } = useLang();
  const [view, setView] = useState<View>('home');
  const [spots, setSpots] = useState<TouristSpot[]>([]);
  const [divisions, setDivisions] = useState<{ division: string; spots: number }[]>([]);
  const [search, setSearch] = useState('');
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [activeSpot, setActiveSpot] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ spot: TouristSpot; prices: FairPrice[]; scams: ScamExample[] } | null>(null);

  useEffect(() => {
    apiGet<{ spots: TouristSpot[] }>('/api/tourist/spots?limit=200')
      .then((d) => setSpots(d.spots))
      .catch(() => {});
    apiGet<{ divisions: { division: string; spots: number }[] }>('/api/tourist/divisions')
      .then((d) => setDivisions(d.divisions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view === 'spot' && activeSpot != null) {
      setDetail(null);
      apiGet<{ spot: TouristSpot; prices: FairPrice[]; scams: ScamExample[] }>(`/api/tourist/spots/${activeSpot}`)
        .then(setDetail)
        .catch(() => {});
    }
  }, [view, activeSpot]);

  const spotById = useMemo(() => new Map(spots.map((s) => [s.id, s])), [spots]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return spots.slice(0, 30);
    return spots.filter(
      (s) =>
        s.nameEn.toLowerCase().includes(q) ||
        s.nameBn.includes(search.trim()) ||
        s.district.toLowerCase().includes(q),
    ).slice(0, 30);
  }, [spots, search]);

  const fromSpot = fromId != null ? spotById.get(fromId) : undefined;
  const toSpot = toId != null ? spotById.get(toId) : undefined;

  return (
    <div className="page">
      <div className="page-hero">
        <h1 style={{ margin: 0 }}>🧭 {t('nav_tourist')}</h1>
      </div>
      <p className="meta">স্ক্যাম থেকে বাঁচো — যাওয়ার আগে সঠিক দাম জেনে নাও।</p>

      <div className="button-row" style={{ marginBottom: 14 }}>
        {(['home', 'browse', 'check', 'report'] as View[]).map((v) => (
          <button
            key={v}
            className={`btn ${view === v || (v === 'home' && (view === 'journey' || view === 'spot')) ? 'yellow' : ''}`}
            onClick={() => setView(v)}
          >
            {v === 'home' ? '🏠 যাত্রা' : v === 'browse' ? '📂 স্পট' : v === 'check' ? '💰 দাম চেক' : '🚨 রিপোর্ট'}
          </button>
        ))}
      </div>

      {view === 'home' && (
        <JourneySelect
          spots={filtered}
          search={search}
          setSearch={setSearch}
          fromId={fromId}
          toId={toId}
          setFromId={setFromId}
          setToId={setToId}
          spotById={spotById}
          onStart={() => setView('journey')}
        />
      )}

      {view === 'journey' && fromSpot && toSpot && (
        <JourneyView fromSpot={fromSpot} toSpot={toSpot} onOpenSpot={(id) => { setActiveSpot(id); setView('spot'); }} />
      )}
      {view === 'journey' && (!fromSpot || !toSpot) && (
        <div className="card"><p className="meta">কোথা থেকে → কোথায় select করো।</p>
          <button className="btn yellow" onClick={() => setView('home')}>← ফিরে যাও</button>
        </div>
      )}

      {view === 'browse' && (
        <BrowseView
          divisions={divisions}
          spots={spots}
          onOpenSpot={(id) => { setActiveSpot(id); setView('spot'); }}
        />
      )}

      {view === 'check' && <PriceCheck />}

      {view === 'report' && <ScamReportForm signedIn={signedIn} spots={spots} />}

      {view === 'spot' && (
        <SpotDetail
          detail={detail}
          onBack={() => setView('browse')}
        />
      )}
    </div>
  );
}

function JourneySelect(props: {
  spots: TouristSpot[]; search: string; setSearch: (s: string) => void;
  fromId: number | null; toId: number | null;
  setFromId: (n: number | null) => void; setToId: (n: number | null) => void;
  spotById: Map<number, TouristSpot>; onStart: () => void;
}) {
  const { spots, search, setSearch, fromId, toId, setFromId, setToId, spotById, onStart } = props;
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const fromSpot = fromId != null ? spotById.get(fromId) : undefined;
  const toSpot = toId != null ? spotById.get(toId) : undefined;

  return (
    <div className="card">
      <h3>🗺️ নতুন যাত্রা</h3>
      <button className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicking('from')}>
        🟢 কোথা থেকে? — <b>{fromSpot ? `${fromSpot.nameBn} (${fromSpot.district})` : 'select করো'}</b>
      </button>
      <button className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicking('to')}>
        📍 কোথায় যাবে? — <b>{toSpot ? `${toSpot.nameBn} (${toSpot.district})` : 'select করো'}</b>
      </button>
      {picking && (
        <div style={{ marginBottom: 10 }}>
          <input
            className="input"
            placeholder="জায়গার নাম লিখো…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {spots.map((s) => (
              <div
                key={s.id}
                onClick={() => {
                  if (picking === 'from') setFromId(s.id); else setToId(s.id);
                  setPicking(null); setSearch('');
                }}
                style={{ padding: '9px 4px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
              >
                <b style={{ fontSize: 14 }}>{s.nameBn}</b>{' '}
                <span className="meta" style={{ margin: 0 }}>{s.district} · {s.division}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button className="btn yellow" disabled={!fromSpot || !toSpot} onClick={onStart} style={{ width: '100%' }}>
        যাত্রা শুরু করো →
      </button>
    </div>
  );
}

function JourneyView({ fromSpot, toSpot, onOpenSpot }: {
  fromSpot: TouristSpot; toSpot: TouristSpot; onOpenSpot: (id: number) => void;
}) {
  const [segData, setSegData] = useState<{ prices: FairPrice[]; scams: ScamExample[] } | null>(null);
  useEffect(() => {
    apiGet<{ prices: FairPrice[]; scams: ScamExample[] }>(
      `/api/tourist/check?from=${encodeURIComponent(fromSpot.district)}&to=${encodeURIComponent(toSpot.district)}`,
    ).then(setSegData).catch(() => {});
  }, [fromSpot, toSpot]);

  const segments = [
    { icon: '🚌', title: `${fromSpot.nameBn} — রওনা`, sub: 'বাস কাউন্টার · টার্মিনাল' },
    { icon: '🛣️', title: 'হাইওয়ে — যাত্রাবিরতি', sub: `${fromSpot.district} → ${toSpot.district} রোড` },
    { icon: '📍', title: `${toSpot.nameBn} — গন্তব্য`, sub: `${toSpot.district} · লোকাল` },
  ];

  return (
    <div>
      <div className="card" style={{ textAlign: 'center', marginBottom: 12 }}>
        <b style={{ fontSize: 16 }}>{fromSpot.nameBn} <span style={{ color: 'var(--yellow)' }}>⇨</span> {toSpot.nameBn}</b>
        <p className="meta" style={{ margin: '6px 0 0' }}>{fromSpot.district} → {toSpot.district}</p>
      </div>
      {segments.map((sg, i) => (
        <div className="card" key={i} style={{ marginBottom: 10 }}>
          <b>{sg.icon} {sg.title}</b>
          <p className="meta" style={{ margin: '4px 0 8px' }}>{sg.sub}</p>
          {i === 2 ? (
            <button className="btn" onClick={() => onOpenSpot(toSpot.id)}>📂 {toSpot.nameBn} এর সব তথ্য দেখো</button>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              {segData ? `${segData.prices.length} দাম · ${segData.scams.length} স্ক্যাম রেকর্ড` : 'লোড হচ্ছে…'}
            </p>
          )}
        </div>
      ))}
      {segData && segData.scams.length > 0 && (
        <div className="card">
          <h3>⚠️ এই রুটে জানা স্ক্যাম</h3>
          {segData.scams.map((s) => (
            <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <b style={{ fontSize: 13 }}>{s.title}</b>
              {s.fairPriceBdt != null && s.scamPriceBdt != null && (
                <p className="meta" style={{ margin: '4px 0 0' }}>
                  সঠিক: <b style={{ color: 'var(--green)' }}>{priceFmt(s.fairPriceBdt, s.fairPriceBdt)}</b>
                  {' '}· চায়: <b style={{ color: '#f87171' }}>{priceFmt(s.scamPriceBdt, s.scamPriceBdt)}</b>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrowseView({ divisions, spots, onOpenSpot }: {
  divisions: { division: string; spots: number }[];
  spots: TouristSpot[];
  onOpenSpot: (id: number) => void;
}) {
  const [div, setDiv] = useState<string | null>(null);
  const list = div ? spots.filter((s) => s.division === div) : [];
  return (
    <div>
      {!div ? (
        <div className="card">
          <h3>📂 বিভাগ অনুযায়ী স্পট</h3>
          {divisions.map((d) => (
            <div
              key={d.division}
              onClick={() => setDiv(d.division)}
              style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
            >
              <b>{d.division}</b>
              <span className="meta" style={{ margin: 0 }}>{d.spots} স্পট →</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <button className="btn" onClick={() => setDiv(null)} style={{ marginBottom: 10 }}>← সব বিভাগ</button>
          <h3>{div}</h3>
          {list.map((s) => (
            <div
              key={s.id}
              onClick={() => onOpenSpot(s.id)}
              style={{ padding: '9px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
            >
              <b style={{ fontSize: 14 }}>{s.nameBn}</b>{' '}
              <span className="meta" style={{ margin: 0 }}>{s.district}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceCheck() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<{ prices: FairPrice[]; scams: ScamExample[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const d = await apiGet<{ prices: FairPrice[]; scams: ScamExample[] }>(
        `/api/tourist/check?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setResult(d);
    } catch { setResult({ prices: [], scams: [] }); }
    setLoading(false);
  };

  return (
    <div className="card">
      <h3>💰 Pay করার আগে চেক</h3>
      <input className="input" placeholder="কোথা থেকে? (যেমন: বাস স্ট্যান্ড)" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input className="input" placeholder="কোথায়? (যেমন: লাবনী বিচ)" value={to} onChange={(e) => setTo(e.target.value)} />
      <button className="btn yellow" onClick={check} disabled={loading} style={{ width: '100%' }}>
        {loading ? 'খুঁজছি…' : 'সঠিক দাম দেখো'}
      </button>
      {result && (
        <div style={{ marginTop: 12 }}>
          {result.prices.length === 0 && <p className="meta">কোনো তথ্য পাওয়া যায়নি — রিপোর্ট করে সাহায্য করো!</p>}
          {result.prices.map((p) => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <b style={{ fontSize: 13 }}>{p.routeOrItem}</b>
              <p className="meta" style={{ margin: '4px 0 0' }}>
                সঠিক দাম: <b style={{ color: 'var(--green)' }}>{priceFmt(p.fairMinBdt, p.fairMaxBdt)}</b>
                <span> · {p.destination}</span>
              </p>
            </div>
          ))}
          {result.scams.map((s) => (
            <p key={s.id} className="meta" style={{ color: '#f87171' }}>⚠️ {s.title}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ScamReportForm({ signedIn, spots }: { signedIn: boolean; spots: TouristSpot[] }) {
  const [place, setPlace] = useState('');
  const [district, setDistrict] = useState('');
  const [type, setType] = useState('overcharge');
  const [desc, setDesc] = useState('');
  const [asked, setAsked] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    if (!signedIn) { setErr('রিপোর্ট করতে লগইন করো।'); return; }
    if (place.trim().length < 2 || desc.trim().length < 10) { setErr('জায়গা আর বর্ণনা (কমপক্ষে ১০ অক্ষর) দাও।'); return; }
    try {
      await apiPost('/api/tourist/scam-reports', {
        place_name: place.trim(),
        district: district.trim() || 'অজানা',
        scam_type: type,
        description: desc.trim(),
        asked_price_bdt: asked ? parseInt(asked, 10) : undefined,
      });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ব্যর্থ হয়েছে');
    }
  };

  if (done) {
    return (
      <div className="card" style={{ textAlign: 'center' }}>
        <h3>✅ রিপোর্ট পাঠানো হয়েছে</h3>
        <p className="meta">Moderator review করে approve করবে। ধন্যবাদ — তোমার রিপোর্ট অন্য tourist কে বাঁচাবে!</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>🚨 স্ক্যাম রিপোর্ট (১ মিনিট)</h3>
      <input className="input" placeholder="জায়গা (যেমন: কলাতলী বিচ)" value={place} onChange={(e) => setPlace(e.target.value)} />
      <input
        className="input" placeholder="জেলা (যেমন: কক্সবাজার)" value={district}
        onChange={(e) => setDistrict(e.target.value)} list="district-list"
      />
      <datalist id="district-list">
        {[...new Set(spots.map((s) => s.district))].map((d) => <option key={d} value={d} />)}
      </datalist>
      <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
        {SCAM_TYPES.map((st) => <option key={st.v} value={st.v}>{st.bn}</option>)}
      </select>
      <textarea
        className="input" placeholder="কী হয়েছিল? (কমপক্ষে ১০ অক্ষর)" rows={3}
        value={desc} onChange={(e) => setDesc(e.target.value)}
      />
      <input
        className="input" placeholder="কত টাকা চেয়েছিল? (ঐচ্ছিক)" type="number"
        value={asked} onChange={(e) => setAsked(e.target.value)}
      />
      {err && <p className="meta" style={{ color: '#f87171' }}>{err}</p>}
      <button className="btn yellow" onClick={submit} style={{ width: '100%' }}>রিপোর্ট পাঠাও</button>
    </div>
  );
}

function SpotDetail({ detail, onBack }: {
  detail: { spot: TouristSpot; prices: FairPrice[]; scams: ScamExample[] } | null;
  onBack: () => void;
}) {
  return (
    <div>
      <button className="btn" onClick={onBack} style={{ marginBottom: 10 }}>← ফিরে যাও</button>
      {!detail ? (
        <div className="card"><p className="meta">লোড হচ্ছে…</p></div>
      ) : (
        <>
          <div className="card">
            <h2 style={{ margin: '0 0 6px' }}>📍 {detail.spot.nameBn}</h2>
            <p className="meta">{detail.spot.nameEn} · {detail.spot.district}, {detail.spot.division}</p>
            {detail.spot.description && <p style={{ fontSize: 14 }}>{detail.spot.description}</p>}
          </div>
          {detail.scams.length > 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <h3>⚠️ জানা স্ক্যাম ({detail.scams.length})</h3>
              {detail.scams.map((s) => (
                <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <b style={{ fontSize: 13 }}>{s.title}</b>
                  {s.fairPriceBdt != null && s.scamPriceBdt != null && (
                    <p className="meta" style={{ margin: '4px 0 0' }}>
                      সঠিক: <b style={{ color: 'var(--green)' }}>{priceFmt(s.fairPriceBdt, s.fairPriceBdt)}</b>
                      {' '}· চায়: <b style={{ color: '#f87171' }}>{priceFmt(s.scamPriceBdt, s.scamPriceBdt)}</b>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {detail.prices.length > 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <h3>💰 সঠিক দাম</h3>
              {detail.prices.map((p) => (
                <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <b style={{ fontSize: 13 }}>{p.routeOrItem}</b>
                  <p className="meta" style={{ margin: '4px 0 0' }}>
                    <b style={{ color: 'var(--green)' }}>{priceFmt(p.fairMinBdt, p.fairMaxBdt)}</b>
                  </p>
                </div>
              ))}
            </div>
          )}
          {detail.scams.length === 0 && detail.prices.length === 0 && (
            <div className="card" style={{ marginTop: 10 }}>
              <p className="meta">এই স্পটে এখনো তথ্য নেই — প্রথম রিপোর্ট করো!</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
