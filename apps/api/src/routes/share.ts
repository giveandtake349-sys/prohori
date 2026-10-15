import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { publicReportColumns } from '../lib/public.js';
import { reports } from 'db';

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
    const title = `প্রহরী: ${row.title}`;
    const description = `${catBn} • ${row.addressText} • ${statusLine}`;
    const shareUrl = `${req.protocol}://${req.get('host')}/share/case/${encodeURIComponent(trackingId)}`;
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
<meta name="twitter:card" content="summary" />
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
