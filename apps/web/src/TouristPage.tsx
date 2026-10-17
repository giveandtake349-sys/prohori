import { useEffect, useMemo, useState } from 'react';
import { useLang } from './i18n';

import { API_BASE } from './supabaseClient';

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error('request failed');
  return r.json() as Promise<T>;
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
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

  const spotById = useMemo(() => {
    const m = new Map(spots.map((s) => [s.id, s]));
    // synthetic district entries mirror JourneySelect's districtOpts ids
    const seen = new Set<string>();
    let n = 0;
    for (const sp of spots) {
      if (!seen.has(sp.district)) {
        seen.add(sp.district); n += 1;
        m.set(-n, {
          id: -n, nameEn: sp.district, nameBn: sp.district,
          district: sp.district, division: sp.division, type: 'district', description: null,
        });
      }
    }
    return m;
  }, [spots]);
  const districtOptsAll = useMemo(() => {
    const list: TouristSpot[] = [];
    const seen = new Set<string>();
    for (const sp of spots) {
      if (!seen.has(sp.district)) {
        seen.add(sp.district);
        list.push({
          id: -(list.length + 1), nameEn: sp.district, nameBn: sp.district,
          district: sp.district, division: sp.division, type: 'district', description: null,
        });
      }
    }
    return list;
  }, [spots]);
  const norm = (v: string) => v.toLowerCase().replace(/['`\u2019]/g, '').replace(/\s+/g, ' ').trim();
  const filtered = useMemo(() => {
    const q = norm(search);
    if (!q) return spots.slice(0, 30);
    return spots.filter(
      (s) =>
        norm(s.nameEn).includes(q) ||
        norm(s.nameBn).includes(q) ||
        norm(s.district).includes(q) ||
        norm(s.division).includes(q),
    ).slice(0, 30);
  }, [spots, search]);

  const fromSpot = fromId != null ? spotById.get(fromId) : undefined;
  const toSpot = toId != null ? spotById.get(toId) : undefined;

  return (
    <div className="page">
      <a className="back-arrow" href="#/" aria-label="ফিরে যাও" style={{ marginBottom: '12px' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg></a>
      <div className="page-hero">
        <h1 style={{ margin: 0 }}>{t('nav_tourist')}</h1>
      </div>
      <p className="meta">স্ক্যাম থেকে বাঁচো — যাওয়ার আগে সঠিক দাম জেনে নাও।</p>

      <TouristTabs view={view} setView={setView} />

      {view === 'home' && (
        <JourneySelect
          spots={filtered}
          districts={districtOptsAll}
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

      {view === 'check' && <PriceCheck spots={spots} districts={districtOptsAll} />}

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

const tabIconProps = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

function TouristTabs({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { v: View; label: string; icon: React.ReactNode }[] = [
    { v: 'home', label: 'যাত্রা', icon: (<svg {...tabIconProps}><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M7 19h7a3 3 0 000-6H9a3 3 0 010-6h8" /></svg>) },
    { v: 'browse', label: 'স্পট', icon: (<svg {...tabIconProps}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></svg>) },
    { v: 'check', label: 'দাম চেক', icon: (<svg {...tabIconProps}><path d="M20 12l-8 8-9-9V4h7z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>) },
    { v: 'report', label: 'রিপোর্ট', icon: (<svg {...tabIconProps}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5h.01" /></svg>) },
  ];
  const active = (v: View) => view === v || (v === 'home' && (view === 'journey' || view === 'spot'));
  return (
    <div className="ttabs">
      {tabs.map((tb) => (
        <button key={tb.v} className={`titem${active(tb.v) ? ' active' : ''}`} onClick={() => setView(tb.v)}>
          <span className="tc">{tb.icon}</span>
          <small>{tb.label}</small>
        </button>
      ))}
    </div>
  );
}

const normS = (v: string) => v.toLowerCase().replace(/['`\u2019]/g, '').replace(/\s+/g, ' ').trim();

function SuggestRow({ title, sub, highlight, onSelect }: { title: string; sub: string; highlight?: boolean; onSelect: () => void }) {
  return (
    <div
      onTouchEnd={(e) => { e.preventDefault(); onSelect(); }}
      onClick={onSelect}
      style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: highlight ? 'rgba(234,179,8,.06)' : undefined }}
    >
      <b style={{ fontSize: 14 }}>{title}</b>{' '}
      <span className="meta" style={{ margin: 0 }}>{sub}</span>
    </div>
  );
}

/** Text input with spot+district suggestions. Reliable tap on mobile (touchend). */
function SuggestInput({ spots, districts, value, onChange, onPick, placeholder, autoFocus }: {
  spots: TouristSpot[];
  districts: TouristSpot[];
  value: string;
  onChange: (v: string) => void;
  onPick: (s: TouristSpot) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = normS(value);
  const dists = districts.filter((d) => !q || normS(d.district).includes(q)).slice(0, 6);
  const matchSpots = spots.filter(
    (sp) => !q || normS(sp.nameEn).includes(q) || normS(sp.nameBn).includes(q) || normS(sp.district).includes(q),
  ).slice(0, 10);
  const show = open && (dists.length > 0 || matchSpots.length > 0);

  return (
    <div style={{ position: 'relative', marginBottom: 10 }}>
      <input
        className="input"
        style={{ marginBottom: 0 }}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {show && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, marginTop: 4, maxHeight: 230, overflowY: 'auto', boxShadow: '0 10px 28px rgba(0,0,0,.4)' }}>
          {dists.map((d) => (
            <SuggestRow key={'d' + d.id} title={d.district} sub={`\u099C\u09C7\u09B2\u09BE \u00B7 ${d.division}`} highlight onSelect={() => { onPick(d); setOpen(false); }} />
          ))}
          {matchSpots.map((sp) => (
            <SuggestRow key={'s' + sp.id} title={sp.nameBn} sub={`${sp.district} \u00B7 ${sp.division}`} onSelect={() => { onPick(sp); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function JourneySelect(props: {
  spots: TouristSpot[]; districts: TouristSpot[]; search: string; setSearch: (s: string) => void;
  fromId: number | null; toId: number | null;
  setFromId: (n: number | null) => void; setToId: (n: number | null) => void;
  spotById: Map<number, TouristSpot>; onStart: () => void;
}) {
  const { spots, districts, search, setSearch, fromId, toId, setFromId, setToId, spotById, onStart } = props;
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const fromSpot = fromId != null ? spotById.get(fromId) : undefined;
  const toSpot = toId != null ? spotById.get(toId) : undefined;
  const pickSpot = (sp: TouristSpot) => {
    if (picking === 'from') setFromId(sp.id); else setToId(sp.id);
    setPicking(null); setSearch('');
  };

  return (
    <div className="card">
      <h3>নতুন যাত্রা</h3>
      <button className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicking('from')}>
        কোথা থেকে? — <b>{fromSpot ? `${fromSpot.nameBn} (${fromSpot.district})` : 'select করো'}</b>
      </button>
      <button className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setPicking('to')}>
        কোথায় যাবে? — <b>{toSpot ? `${toSpot.nameBn} (${toSpot.district})` : 'select করো'}</b>
      </button>
      {picking && (
        <SuggestInput
          spots={spots}
          districts={districts}
          value={search}
          onChange={setSearch}
          onPick={pickSpot}
          placeholder="জায়গার নাম লিখো…"
          autoFocus
        />
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
  type Seg = { prices: FairPrice[]; scams: ScamExample[] } | null;
  const [segStart, setSegStart] = useState<Seg>(null);
  const [segRoad, setSegRoad] = useState<Seg>(null);
  const [segEnd, setSegEnd] = useState<Seg>(null);
  const [expanded, setExpanded] = useState<boolean[]>([false, false, false]);
  const fd = fromSpot.district;
  const td = toSpot.district;
  useEffect(() => {
    setSegStart(null); setSegRoad(null); setSegEnd(null);
    setExpanded([false, false, false]);
    apiGet<Seg>(`/api/tourist/check?to=${encodeURIComponent(fd)}`).then(setSegStart).catch(() => {});
    apiGet<Seg>(`/api/tourist/check?from=${encodeURIComponent(fd)}&to=${encodeURIComponent(td)}&direct=1`).then(setSegRoad).catch(() => {});
    apiGet<Seg>(`/api/tourist/check?to=${encodeURIComponent(td)}`).then(setSegEnd).catch(() => {});
  }, [fd, td]);

  const toggle = (i: number) => setExpanded((e) => e.map((v, j) => (j === i ? !v : v)));

  const segDefs = [
    { data: segStart, title: 'ধাপ ১ · রওনা', tag: fromSpot.nameBn, cls: '', sub: 'ঘাট / কাউন্টার থেকে যাত্রা শুরু' },
    { data: segRoad, title: 'ধাপ ২ · হাইওয়ে', tag: 'রুট', cls: 'mid', sub: `${fd} → ${td} রোড` },
    { data: segEnd, title: 'ধাপ ৩ · গন্তব্য', tag: toSpot.nameBn, cls: 'end', sub: 'পৌঁছে যেখানে খরচ হবে' },
  ];
  const totalPrices = (segStart?.prices.length ?? 0) + (segRoad?.prices.length ?? 0) + (segEnd?.prices.length ?? 0);
  const totalScams = segEnd?.scams.length ?? 0;

  const scamLabel = (fair: number | null, scam: number | null) => {
    if (!fair || !scam || fair <= 0 || scam <= fair) return null;
    const r = scam / fair;
    return r >= 1.5 ? `${Math.round(r)} গুণ বেশি!` : `+${Math.round((r - 1) * 100)}% বেশি`;
  };

  return (
    <div>
      <div className="tj-route">
        <div className="tj-ends">
          <div className="tj-city">{fromSpot.nameBn}<small>রওনা</small></div>
          <div className="tj-arrow">⇨</div>
          <div className="tj-city" style={{ textAlign: 'right' }}>{toSpot.nameBn}<small>গন্তব্য</small></div>
        </div>
        <div className="tj-meta">
          <span className="tj-pill"><b>3</b> ধাপ</span>
          <span className="tj-pill"><b>{totalPrices}</b> সঠিক দাম</span>
          <span className="tj-pill"><b>{totalScams}</b> স্ক্যাম এলার্ট</span>
        </div>
      </div>
      <div className="tj-tl">
        {segDefs.map((sg, i) => {
          const list = sg.data?.prices ?? [];
          const shown = expanded[i] ? list : list.slice(0, 3);
          return (
            <div className={`tj-seg ${sg.cls}`} key={i}>
              <div className="tj-seg-head"><span className="tj-seg-title">{sg.title}</span><span className="tj-seg-tag">{sg.tag}</span></div>
              <p className="tj-seg-sub">{sg.sub}</p>
              {sg.data === null ? (
                <p className="tj-seg-sub">লোড হচ্ছে…</p>
              ) : list.length === 0 ? (
                <p className="tj-seg-sub">এই ধাপের তথ্য এখনো নেই</p>
              ) : (
                <>
                  {shown.map((pr) => (
                    <div className="tj-price-row" key={pr.id}>
                      <span className="tj-nm">{pr.routeOrItem}</span>
                      <span className="tj-pr">{priceFmt(pr.fairMinBdt, pr.fairMaxBdt)}</span>
                    </div>
                  ))}
                  {list.length > 3 && (
                    <p className="tj-more" onClick={() => toggle(i)}>
                      {expanded[i] ? 'কম দেখো ↑' : `+ আরো ${list.length - 3}টি দাম দেখো →`}
                    </p>
                  )}
                </>
              )}
              {i === 2 && toSpot.id > 0 && (
                <button className="tj-btn" onClick={() => onOpenSpot(toSpot.id)}>{toSpot.nameBn} এর সব তথ্য দেখো</button>
              )}
              {i === 2 && toSpot.id <= 0 && (
                <p className="tj-seg-sub">নিচে এই জেলার স্ক্যাম আর সঠিক দাম দেখো</p>
              )}
            </div>
          );
        })}
      </div>
      {segEnd && segEnd.scams.length > 0 && (
        <div>
          <div className="tj-scam-h">স্ক্যাম এলার্ট <span className="tj-n">{segEnd.scams.length}</span></div>
          {segEnd.scams.map((s) => {
            const lbl = scamLabel(s.fairPriceBdt, s.scamPriceBdt);
            const ratio = s.fairPriceBdt && s.scamPriceBdt && s.fairPriceBdt > 0 ? s.scamPriceBdt / s.fairPriceBdt : 1;
            return (
              <div className="tj-scam" key={s.id}>
                <p className="tj-t">{s.title}</p>
                {s.fairPriceBdt != null && s.scamPriceBdt != null && (
                  <>
                    <div className="tj-cmp">
                      <div className="tj-box ok"><div className="tj-lbl">সঠিক দাম</div><div className="tj-val ok">{priceFmt(s.fairPriceBdt, s.fairPriceBdt)}</div></div>
                      <div className="tj-box bad"><div className="tj-lbl">চায়</div><div className="tj-val bad">{priceFmt(s.scamPriceBdt, s.scamPriceBdt)}</div></div>
                    </div>
                    {lbl && (
                      <>
                        <div className="tj-bar"><div className="tj-fill" style={{ width: `${Math.min(100, Math.max(14, ratio * 10))}%` }} /></div>
                        <div className="tj-bar-lbl"><span>সঠিক</span><span>{lbl}</span></div>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="tj-note">দামগুলো যাচাইকৃত ডাটাবেস থেকে · ভুল থাকলে রিপোর্ট করো</p>
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

function PriceCheck({ spots, districts }: { spots: TouristSpot[]; districts: TouristSpot[] }) {
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
      <h3>Pay করার আগে চেক</h3>
      <SuggestInput spots={spots} districts={districts} value={from} onChange={setFrom} onPick={(sp) => setFrom(sp.nameBn)} placeholder="কোথা থেকে? (টাইপ করো…)" />
      <SuggestInput spots={spots} districts={districts} value={to} onChange={setTo} onPick={(sp) => setTo(sp.nameBn)} placeholder="কোথায়? (যেমন: লাবনী বিচ)" />
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
      <h3>স্ক্যাম রিপোর্ট (১ মিনিট)</h3>
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
