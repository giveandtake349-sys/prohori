import { useEffect, useRef } from 'react';

// Leaflet is loaded via CDN in index.html (no npm dependency).
declare const L: any;

const DHAKA: [number, number] = [23.8103, 90.4125];

function makePinIcon(): any {
  return L.divIcon({
    className: 'prohori-pin',
    html: '<div class="prohori-pin-dot"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

interface Props {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}

/** Tap/click the map (or drag the pin) to set the incident location. */
export default function MapPicker({ lat, lng, onPick }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const failedRef = useRef(false);

  // Mount the map once.
  useEffect(() => {
    if (!divRef.current) return;
    if (typeof L === 'undefined') {
      failedRef.current = true;
      return;
    }
    const map = L.map(divRef.current).setView(DHAKA, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    map.on('click', (e: any) => {
      onPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin in sync with the picked coordinates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof L === 'undefined' || lat == null || lng == null) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng], { icon: makePinIcon(), draggable: true })
        .addTo(map)
        .on('dragend', (e: any) => {
          const p = e.target.getLatLng();
          onPickRef.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
        });
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 14));
  }, [lat, lng]);

  if (failedRef.current) {
    return (
      <div className="map-fallback">
        ম্যাপ লোড হয়নি — ইন্টারনেট সংযোগ চেক করে পেজ রিফ্রেশ করুন।
      </div>
    );
  }
  return <div ref={divRef} className="map-picker" role="application" aria-label="ঘটনার স্থান ম্যাপে চিহ্নিত করুন" />;
}
