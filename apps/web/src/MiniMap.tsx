import { useEffect, useRef } from 'react';

// Leaflet is loaded via CDN in index.html (no npm dependency).
declare const L: any;

/** Small read-only map with a pin — for the moderator review cards. */
export default function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current || typeof L === 'undefined') return;
    const map = L.map(divRef.current, { zoomControl: false }).setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    const icon = L.divIcon({
      className: 'prohori-pin',
      html: '<div class="prohori-pin-dot"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([lat, lng], { icon, interactive: false }).addTo(map);
    return () => {
      map.remove();
    };
  }, [lat, lng]);

  return <div ref={divRef} className="mini-map" />;
}
