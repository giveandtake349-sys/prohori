import { Router, type Request, type Response, type NextFunction } from 'express';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { publicReportColumns, verificationStageOf } from '../lib/public.js';
import { reports, reportMedia, missingPersons } from 'db';

export const shareRouter = Router();

const CATEGORY_BN: Record<string, string> = {
  khun: 'খুন',
  ghum: 'গুম / নিখোঁজ',
  churi: 'চুরি',
  dakati: 'ডাকাতি',
  dhorshon: 'ধর্ষণ',
  eveteasing: 'ইভটিজিং',
  madok: 'মাদক',
  durniti: 'দুর্নীতি',
  other: 'অন্যান্য',
};

/** Minimal HTML escaper for OG meta content. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Share cards (1200×630 PNG, rendered with sharp from an SVG template).
//
// Bengali text in the SVG uses the "Noto Sans Bengali" font family. It is
// present on this dev VM (fc-list :lang=bn) — on Render it renders correctly
// only if the runtime has a Bengali font installed. The card is still
// functional without it: every key signal (category, stage, overdue pill,
// brand) is also drawn as a colored shape/badge, so the layout never breaks.
// ---------------------------------------------------------------------------

const CARD_W = 1200;
const CARD_H = 630;
const BN_FONT = `'Noto Sans Bengali','Noto Sans',sans-serif`;

const STAGE_LABEL_BN = ['নতুন রিপোর্ট', 'প্রাথমিক যাচাই', 'জনতা যাচাইকৃত', 'প্রহরী যাচাইকৃত'] as const;

/** Fetch a remote image (bounded size/type); null on any failure. */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/')) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > 8 * 1024 * 1024) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Greedy word-wrap for SVG <text> (SVG has no auto-wrapping). */
function wrapText(s: string, maxChars: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

function pill(x: number, y: number, label: string, bg: string, fontSize = 30): string {
  const w = Math.max(70, label.length * (fontSize * 0.62) + 48);
  return `<g>
    <rect x="${x}" y="${y}" width="${w}" height="${fontSize + 28}" rx="${(fontSize + 28) / 2}" fill="${bg}"/>
    <text x="${x + w / 2}" y="${y + fontSize + 16}" text-anchor="middle" font-family="${BN_FONT}" font-size="${fontSize}" font-weight="700" fill="#ffffff">${esc(label)}</text>
  </g>`;
}

type CaseRow = typeof reports.$inferSelect;

export async function renderCaseCard(row: CaseRow, mediaUrl: string | null): Promise<Buffer> {
  const photo = mediaUrl ? await fetchImageBuffer(mediaUrl) : null;
  const stage = verificationStageOf({
    status: row.status,
    communityVerified: row.communityVerified,
    corroborationCount: row.corroborationCount,
    category: row.category,
  });
  const stageLabel = STAGE_LABEL_BN[stage];
  const daysOverdue =
    row.overdue && row.communityVerifiedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(row.communityVerifiedAt).getTime()) / 86400000))
      : null;

  const titleLines = wrapText(row.title, 30).slice(0, 3);
  const meta = `${CATEGORY_BN[row.category] ?? row.category} • ${row.addressText} • ${row.corroborationCount} জন নিশ্চিত করেছে`;
  let y = 300;
  let body = `<defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#04080e" stop-opacity="0.15"/>
        <stop offset="0.55" stop-color="#04080e" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#04080e" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#shade)"/>`;
  // Top row: category chip + stage badge.
  body += pill(48, 44, CATEGORY_BN[row.category] ?? row.category, '#1f6feb', 28);
  const stageX = 48 + Math.max(70, (CATEGORY_BN[row.category] ?? row.category).length * 17.4 + 48) + 20;
  body += pill(stageX, 44, stageLabel, stage === 3 ? '#1e9e5a' : stage === 2 ? '#b7791f' : '#5b6b7c', 28);
  if (daysOverdue !== null) {
    y = 140;
    body += pill(48, y, `${daysOverdue} দিন — পুলিশ ব্যবস্থা নেয়নি`, '#d92632', 34);
    y += 96;
  }
  // Headline.
  for (const line of titleLines) {
    body += `<text x="48" y="${y + 52}" font-family="${BN_FONT}" font-size="56" font-weight="800" fill="#ffffff">${esc(line)}</text>`;
    y += 68;
  }
  y += 8;
  body += `<text x="48" y="${y + 30}" font-family="${BN_FONT}" font-size="28" fill="#c7d2de">${esc(meta.slice(0, 90))}</text>`;
  // Brand footer.
  body += `<text x="${CARD_W - 48}" y="${CARD_H - 40}" text-anchor="end" font-family="${BN_FONT}" font-size="30" font-weight="700" fill="#8fa3b8">প্রহরী — জনতার চোখ</text>`;
  body += `<circle cx="48" cy="${CARD_H - 52}" r="16" fill="#d92632"/><text x="48" y="${CARD_H - 40}" text-anchor="middle" font-family="${BN_FONT}" font-size="22" font-weight="800" fill="#ffffff">প্র</text>`;

  const svg = `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const base = photo
    ? sharp(photo).resize(CARD_W, CARD_H, { fit: 'cover' })
    : sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: '#0a0f16' } });
  return base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

/**
 * GET /share/case/:trackingId/card.png — 1200×630 share card for a report.
 * Dark brand background, first evidence photo composited when available,
 * Bangla headline, category chip, stage badge, red overdue pill and brand
 * footer. Cache-Control: public, max-age=3600.
 */
shareRouter.get('/case/:trackingId/card.png', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawParam = req.params.trackingId;
    const trackingId = Array.isArray(rawParam) ? (rawParam[0] ?? '') : (rawParam ?? '');
    if (!/^PH-\d{4}-\d{4}$/.test(trackingId)) {
      res.status(404).send('not found');
      return;
    }
    const [row] = await db.select().from(reports).where(eq(reports.trackingId, trackingId));
    if (!row) {
      res.status(404).send('not found');
      return;
    }
    const media = await db
      .select({ url: reportMedia.url })
      .from(reportMedia)
      .where(eq(reportMedia.reportId, row.id))
      .limit(1);
    const png = await renderCaseCard(row, media[0]?.url ?? null);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /share/case/:trackingId — crawler-friendly share page for a verified report.
 * Hash-routed SPAs can't serve per-URL OG tags, so this server-rendered page
 * carries the OG meta (Facebook/WhatsApp/Telegram unfurl it) and instantly
 * redirects human visitors to the real case page in the web app.
 * Only public-safe columns are used — never reporter identity.
 * WEB_APP_URL env (e.g. the Vercel URL) sets the redirect target; without it
 * the page still renders the summary with a manual link.
 */
shareRouter.get('/case/:trackingId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawParam = req.params.trackingId;
    const trackingId = Array.isArray(rawParam) ? (rawParam[0] ?? '') : (rawParam ?? '');
    if (!/^PH-\d{4}-\d{4}$/.test(trackingId)) {
      res.status(404).send('not found');
      return;
    }
    const [row] = await db
      .select(publicReportColumns)
      .from(reports)
      .where(eq(reports.trackingId, trackingId));
    if (!row) {
      res.status(404).send('not found');
      return;
    }
    const catBn = CATEGORY_BN[row.category] ?? row.category;
    const resolved = row.status === 'resolved';
    const statusLine = resolved
      ? 'এই ঘটনার সমাধান হয়েছে ✓'
      : 'এই ঘটনা এখনো অমীমাংসিত — শেয়ার করে ছড়িয়ে দিন';
    const stage = verificationStageOf({
      status: row.status,
      communityVerified: row.communityVerified,
      corroborationCount: row.corroborationCount,
      category: row.category,
    });
    const daysOverdue =
      row.overdue && row.communityVerifiedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(row.communityVerifiedAt).getTime()) / 86400000))
        : null;
    const title = `প্রহরী: ${row.title}`;
    const description =
      `${catBn} • ${STAGE_LABEL_BN[stage]}` +
      (daysOverdue !== null ? ` • 🔴 ${daysOverdue} দিন ধরে পুলিশ ব্যবস্থা নেয়নি` : '') +
      ` • ${row.addressText} • ${statusLine}`;
    const shareUrl = `${req.protocol}://${req.get('host')}/share/case/${encodeURIComponent(trackingId)}`;
    const cardUrl = `${req.protocol}://${req.get('host')}/share/case/${encodeURIComponent(trackingId)}/card.png`;
    const webBase = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
    const appUrl = webBase ? `${webBase}/#/case/${encodeURIComponent(trackingId)}` : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="প্রহরী — জনতার চোখ" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:image" content="${esc(cardUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(cardUrl)}" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
${appUrl ? `<meta http-equiv="refresh" content="0;url=${esc(appUrl)}" />` : ''}
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1a2430}.badge{display:inline-block;background:${resolved ? '#1e9e5a' : '#d92632'};color:#fff;padding:6px 14px;border-radius:99px;font-weight:700}a{color:#1f6feb;font-weight:700}</style>
</head>
<body>
<h1>প্রহরী — জনতার চোখ</h1>
<p><span class="badge">${esc(statusLine)}</span></p>
<h2>${esc(row.title)}</h2>
<p>${esc(description)}</p>
${appUrl ? `<p><a href="${esc(appUrl)}">অ্যাপে কেসটি দেখুন →</a></p><script>location.replace(${JSON.stringify(appUrl)});</script>` : '<p>প্রহরী অ্যাপে কেসটি দেখুন।</p>'}
</body>
</html>`);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Missing-person share pair: OG page + missing-poster card.png.
// Contact phone is intentionally PUBLIC (that's how a finder reaches family).
// ---------------------------------------------------------------------------

type MissingRow = typeof missingPersons.$inferSelect;

export async function renderMissingCard(row: MissingRow): Promise<Buffer> {
  const photo = row.photoUrl ? await fetchImageBuffer(row.photoUrl) : null;
  const nameLines = wrapText(row.name, 22).slice(0, 2);
  const details: string[] = [];
  if (row.age !== null && row.age !== undefined) details.push(`বয়স: ${row.age}`);
  const genderBn = row.gender === 'male' ? 'পুরুষ' : row.gender === 'female' ? 'নারী' : row.gender === 'other' ? 'অন্যান্য' : null;
  if (genderBn) details.push(genderBn);
  const lastSeen = row.lastSeenText
    ? `শেষ দেখা: ${row.lastSeenText}`
    : row.lastSeenDate
      ? `শেষ দেখা: ${new Date(row.lastSeenDate).toLocaleDateString('bn-BD')}`
      : null;

  let y = 150;
  let body = `<rect width="${CARD_W}" height="${CARD_H}" fill="#0a0f16"/>
    <rect x="0" y="0" width="${CARD_W}" height="110" fill="#d92632"/>
    <text x="48" y="72" font-family="${BN_FONT}" font-size="48" font-weight="800" fill="#ffffff">নিখোঁজ সংবাদ</text>
    <text x="${CARD_W - 48}" y="72" text-anchor="end" font-family="${BN_FONT}" font-size="30" font-weight="700" fill="#ffffff">প্রহরী — জনতার চোখ</text>`;
  const textX = photo ? 560 : 48;
  for (const line of nameLines) {
    body += `<text x="${textX}" y="${y + 60}" font-family="${BN_FONT}" font-size="64" font-weight="800" fill="#ffffff">${esc(line)}</text>`;
    y += 80;
  }
  if (details.length > 0) {
    body += `<text x="${textX}" y="${y + 40}" font-family="${BN_FONT}" font-size="34" fill="#c7d2de">${esc(details.join(' • '))}</text>`;
    y += 60;
  }
  if (lastSeen) {
    for (const line of wrapText(lastSeen, 34).slice(0, 2)) {
      body += `<text x="${textX}" y="${y + 40}" font-family="${BN_FONT}" font-size="32" fill="#c7d2de">${esc(line)}</text>`;
      y += 52;
    }
  }
  y += 24;
  body += pill(textX, y, `যোগাযোগ: ${row.contactPhone}`, '#1e9e5a', 36);

  const svg = `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  // Photo occupies the left 480px (below the red header); the SVG overlay
  // draws the header strip, all text and pills across the full canvas.
  const base = photo
    ? sharp(photo)
        .resize(480, CARD_H - 110, { fit: 'cover', position: 'top' })
        .extend({ top: 110, bottom: 0, left: 0, right: CARD_W - 480, background: '#0a0f16' })
    : sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: '#0a0f16' } });
  return base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

/**
 * GET /share/missing/:id/card.png — missing-poster style card: photo, name,
 * age, last-seen, contact phone. Cache-Control: public, max-age=3600.
 */
shareRouter.get('/missing/:id/card.png', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawParam = req.params.id;
    const id = Array.isArray(rawParam) ? (rawParam[0] ?? '') : (rawParam ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(404).send('not found');
      return;
    }
    const [row] = await db.select().from(missingPersons).where(eq(missingPersons.id, id));
    if (!row) {
      res.status(404).send('not found');
      return;
    }
    const png = await renderMissingCard(row);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /share/missing/:id — crawler-friendly share page for a missing-person
 * entry. Carries OG meta (og:image → the poster card) and redirects human
 * visitors to the web app.
 */
shareRouter.get('/missing/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawParam = req.params.id;
    const id = Array.isArray(rawParam) ? (rawParam[0] ?? '') : (rawParam ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(404).send('not found');
      return;
    }
    const [row] = await db.select().from(missingPersons).where(eq(missingPersons.id, id));
    if (!row) {
      res.status(404).send('not found');
      return;
    }
    const found = row.status === 'found';
    const title = `প্রহরী: নিখোঁজ — ${row.name}`;
    const description =
      (found ? 'খুঁজে পাওয়া গেছে ✓ • ' : 'নিখোঁজ • ') +
      (row.age !== null && row.age !== undefined ? `বয়স ${row.age} • ` : '') +
      (row.lastSeenText ? `শেষ দেখা: ${row.lastSeenText} • ` : '') +
      `যোগাযোগ: ${row.contactPhone}`;
    const shareUrl = `${req.protocol}://${req.get('host')}/share/missing/${encodeURIComponent(id)}`;
    const cardUrl = `${req.protocol}://${req.get('host')}/share/missing/${encodeURIComponent(id)}/card.png`;
    const webBase = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
    const appUrl = webBase ? `${webBase}/#/missing/${encodeURIComponent(id)}` : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="প্রহরী — জনতার চোখ" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:image" content="${esc(cardUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(cardUrl)}" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
${appUrl ? `<meta http-equiv="refresh" content="0;url=${esc(appUrl)}" />` : ''}
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1a2430}.badge{display:inline-block;background:${found ? '#1e9e5a' : '#d92632'};color:#fff;padding:6px 14px;border-radius:99px;font-weight:700}a{color:#1f6feb;font-weight:700}</style>
</head>
<body>
<h1>প্রহরী — জনতার চোখ</h1>
<p><span class="badge">${found ? 'খুঁজে পাওয়া গেছে ✓' : 'নিখোঁজ — শেয়ার করে ছড়িয়ে দিন'}</span></p>
<h2>${esc(row.name)}</h2>
<p>${esc(description)}</p>
${appUrl ? `<p><a href="${esc(appUrl)}">অ্যাপে দেখুন →</a></p><script>location.replace(${JSON.stringify(appUrl)});</script>` : '<p>প্রহরী অ্যাপে দেখুন।</p>'}
</body>
</html>`);
  } catch (e) {
    next(e);
  }
});
