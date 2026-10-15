/**
 * Tracking IDs look like PH-2026-4821. Random suffix keeps them
 * non-sequential (no leaking of report volume); the insert path retries
 * on the rare unique collision.
 */
export function generateTrackingId(): string {
  const year = new Date().getFullYear();
  const n = Math.floor(1000 + Math.random() * 9000);
  return `PH-${year}-${n}`;
}
