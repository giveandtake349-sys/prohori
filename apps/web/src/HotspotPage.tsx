import { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from './i18n';
import { fetchHotspots, notifyTeamsAboutHotspot, type HotspotCell } from './api';

// Leaflet is loaded via CDN in index.html (no npm dependency).
declare const L: any;

const DHAKA: [number, number] = [23.8103, 90.4125];

const CATEGORY_FILTERS = [
  { key: '', bn: 'সব', en: 'All' },
  { key: 'churi', bn: 'চুরি', en: 'Theft' },
  { key: 'dakati', bn: 'ডাকাতি', en: 'Robbery' },
  { key: 'khun', bn: 'খুন', en: 'Murder' },
  { key: 'dhorshon', bn: 'ধর্ষণ', en: 'Rape' },
  { key: 'ghum', bn: 'গুম', en: 'Missing' },
];

const TIME_FILTERS = [
  { key: '', bn: 'সব সময়', en: 'All time' },
  { key: 'night', bn: '🌙 রাত', en: '🌙 Night' },
  { key: 'day', bn: '☀️ দিন', en: '☀️ Day' },
];

const RISK_COLOR: Record<HotspotCell['risk'], string> = {
  high: '#d92632',
  medium: '#eab308',
  low: '#16a34a',
};

function BackArrow() {
  return (
    <a className="back-arrow" href="#/" aria-label="ফিরে যাও">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
      </svg>
    </a>
  );
}

export default function HotspotPage({ signedIn }: { signedIn: boolean }) {
  const { lang } = useLang();
  const bn = lang === 'bn';
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [category, setCategory] = useState('');
  const [time, setTime] = useState('');
  const [hotspots, setHotspots] = useState<HotspotCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<HotspotCell | null>(null);
  const [locating, setLocating] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');
  const queryRef = useRef({ category, time });
  queryRef.current = { category, time };

  const loadHotspots = useCallback(async (lat: number, lng: number) => {
    const q = queryRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetchHotspots({
        lat,
        lng,
        radius_km: 12,
        category: q.category || undefined,
        time: (q.time as 'night' | 'day') || undefined,
      });
      setHotspots(res.hotspots);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount the map once.
  useEffect(() => {
    if (!mapDivRef.current || typeof L === 'undefined') return;
    if (mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: false }).setView(DHAKA, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    loadHotspots(DHAKA[0], DHAKA[1]);
    let t: ReturnType<typeof setTimeout> | null = null;
    map.on('moveend', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const c = map.getCenter();
        loadHotspots(c.lat, c.lng);
      }, 600);
    });
    return () => {
      if (t) clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-query when filters change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    loadHotspots(c.lat, c.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, time]);

  // Draw circles.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof L === 'undefined') return;
    layer.clearLayers();
    for (const h of hotspots) {
      const color = RISK_COLOR[h.risk];
      const circle = L.circle([h.lat, h.lng], {
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
        radius: 250 + h.count * 60,
      });
      circle.on('click', () => setSelected(h));
      circle.addTo(layer);
    }
  }, [hotspots]);

  const goToMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapRef.current?.setView([latitude, longitude], 14);
        setLocating(false);
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  };

  const handleNotifyTeams = async () => {
    if (!selected || !signedIn) return;
    setNotifying(true);
    setNotifyMsg('');
    try {
      const res = await notifyTeamsAboutHotspot({ lat: selected.lat, lng: selected.lng, radius_km: 5 });
      setNotifyMsg(
        res.notified > 0
          ? (bn ? `${res.teams.length}টা টিমকে জানানো হয়েছে ✓` : `Notified ${res.teams.length} team(s) ✓`)
          : (bn ? 'আশেপাশে কোনো সক্রিয় টিম পাওয়া যায়নি' : 'No active teams nearby'),
      );
    } catch (e: unknown) {
      setNotifyMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setNotifying(false);
    }
  };

  const reportFeedHref =
    selected && selected.topCategoryKeys.length > 0
      ? `#/?category=${encodeURIComponent(selected.topCategoryKeys[0])}`
      : '#/';

  return (
    <div className="page hotspot-page">
      <div className="hotspot-topbar">
        <BackArrow />
        <h2 className="sec" style={{ margin: 0 }}>🗺️ {bn ? 'হটস্পট ম্যাপ' : 'Hotspot map'}</h2>
      </div>

      <div className="hotspot-mapwrap">
        <div ref={mapDivRef} className="hotspot-map" />
        {typeof L === 'undefined' && (
          <p className="state err">{bn ? 'ম্যাপ লোড হয়নি — ইন্টারনেট চেক করো' : 'Map failed to load'}</p>
        )}

        <div className="hotspot-filters">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c.key}
              className={'fchip' + (category === c.key ? ' on' : '')}
              onClick={() => setCategory(c.key)}
            >
              {bn ? c.bn : c.en}
            </button>
          ))}
        </div>
        <div className="hotspot-filters hotspot-filters-2">
          {TIME_FILTERS.map((c) => (
            <button
              key={c.key}
              className={'fchip' + (time === c.key ? ' on' : '')}
              onClick={() => setTime(c.key)}
            >
              {bn ? c.bn : c.en}
            </button>
          ))}
        </div>

        <button
          className="hotspot-myloc"
          onClick={goToMyLocation}
          aria-label={bn ? 'আমার অবস্থান' : 'My location'}
          disabled={locating}
        >
          {locating ? '…' : '📍'}
        </button>

        <div className="hotspot-legend">
          <div><span className="dot" style={{ background: '#d92632' }} />{bn ? 'বেশি অপরাধ' : 'High'}</div>
          <div><span className="dot" style={{ background: '#eab308' }} />{bn ? 'মাঝামাঝি' : 'Medium'}</div>
          <div><span className="dot" style={{ background: '#16a34a' }} />{bn ? 'কম' : 'Low'}</div>
        </div>

        {loading && <div className="hotspot-loading">{bn ? 'লোড হচ্ছে…' : 'Loading…'}</div>}
      </div>

      {!loading && !error && hotspots.length === 0 && (
        <p className="state">{bn ? 'এই এলাকায় এখনো তথ্য নেই — যাচাইকৃত রিপোর্ট এলে ম্যাপে দেখা যাবে।' : 'No data here yet — verified reports will appear on the map.'}</p>
      )}
      {error && <p className="state err">{error}</p>}

      <p className="meta" style={{ padding: '0 14px' }}>
        {bn
          ? 'গত ৩০ দিনের যাচাইকৃত রিপোর্ট • এলাকা দেখানো হয়, ব্যক্তি নয়'
          : 'Verified reports, last 30 days • areas shown, never individuals'}
      </p>

      {selected && (
        <div className="hotspot-sheet" role="dialog" aria-label={bn ? 'হটস্পট বিবরণ' : 'Hotspot detail'}>
          <div className="grab" />
          <div className="sheet-head">
            <h3>
              {selected.risk === 'high' ? '🔴' : selected.risk === 'medium' ? '🟡' : '🟢'}{' '}
              {bn ? 'হটস্পট' : 'Hotspot'}
            </h3>
            <button className="sheet-close" onClick={() => setSelected(null)} aria-label={bn ? 'বন্ধ' : 'Close'}>✕</button>
          </div>
          <p className="meta">
            {bn ? `গত ৩০ দিনে ${selected.count}টা ঘটনা` : `${selected.count} incidents in 30 days`}
            {selected.topCategories.length > 0 && ` • ${selected.topCategories.join(', ')}`}
          </p>
          <p className="meta">{bn ? 'বেশি হয়: ' : 'Peak: '}{selected.peakHours}</p>
          <div className="dangerbar">
            <span>{bn ? 'ঝুঁকি' : 'Risk'}</span>
            <div className="tr"><i style={{ width: `${selected.riskScore}%` }} /></div>
            <b>{selected.riskScore}</b>
          </div>
          <div className="sheet-row">
            <a className="btn blue" href={reportFeedHref}>{bn ? 'রিপোর্ট দেখো' : 'View reports'}</a>
            {signedIn ? (
              <button className="btn ghost" onClick={handleNotifyTeams} disabled={notifying}>
                {notifying ? '…' : bn ? 'টিমকে জানাও' : 'Alert teams'}
              </button>
            ) : (
              <a className="btn ghost" href="#/login">{bn ? 'টিমকে জানাও' : 'Alert teams'}</a>
            )}
          </div>
          {notifyMsg && <p className="state">{notifyMsg}</p>}
        </div>
      )}
    </div>
  );
}
