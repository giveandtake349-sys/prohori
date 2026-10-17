import { Router, type Request, type Response, type NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { fbProcessedComments } from 'db';
import { runShieldCheck } from '../lib/shieldCheck.js';

export const fbRouter = Router();

const SHIELD_LINK = 'https://prohori-teal.vercel.app/#/shield';

/**
 * GET /api/fb/webhook — Meta webhook verification handshake.
 * Set FB_VERIFY_TOKEN env (Render). Meta sends hub.mode / hub.verify_token / hub.challenge.
 */
fbRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.FB_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    res.status(200).send(String(challenge ?? ''));
    return;
  }
  res.sendStatus(403);
});

const VERDICT_EMOJI: Record<string, string> = {
  fraud: '🔴 FRAUD',
  suspect: '🟡 সন্দেহজনক',
  blacklisted: '⛔ BLACKLISTED',
  unknown: '❓ অজানা',
  clean: '🟢 পরিষ্কার',
};

/** Short public reply: verdict + risk + proof + link. No raw user data. */
function buildReply(input: string, verdict: Awaited<ReturnType<typeof runShieldCheck>>): string {
  const badge = VERDICT_EMOJI[verdict.verdict] ?? '❓';
  const proof =
    verdict.stats.reports > 0 || verdict.stats.confirms > 0
      ? ` (${verdict.stats.reports} রিপোর্ট, ${verdict.stats.confirms} confirm)`
      : '';
  return (
    `🛡️ Prohori Shield check: ${badge} — ${verdict.riskPct}% risk${proof}.\n` +
    `“${verdict.title}”\n` +
    `নিজে যাচাই করো: ${SHIELD_LINK}`
  );
}

interface FbCommentValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  message?: string;
  parent_id?: string;
  from?: { id?: string; name?: string };
}

async function replyToComment(commentId: string, message: string): Promise<boolean> {
  const token = process.env.FB_PAGE_TOKEN;
  if (!token) {
    console.warn('[fb-bot] FB_PAGE_TOKEN not set — skipping reply to', commentId);
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(commentId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, access_token: token }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('[fb-bot] Graph API error', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[fb-bot] reply failed', e);
    return false;
  }
}

async function handleComment(value: FbCommentValue): Promise<void> {
  if (value.item !== 'comment' || value.verb !== 'add') return;
  const commentId = value.comment_id;
  const message = value.message ?? '';
  if (!commentId || !message) return;
  // Only respond to explicit tags: "@prohori" or "prohori check"
  if (!/@prohori/i.test(message) && !/prohori\s*check/i.test(message)) return;

  // Dedupe: one reply per comment, ever.
  const [seen] = await db.select().from(fbProcessedComments).where(eq(fbProcessedComments.commentId, commentId)).limit(1);
  if (seen) return;

  // The thing to check: the comment text minus the tag.
  const input = message.replace(/@prohori/ig, '').replace(/prohori\s*check/ig, '').trim().slice(0, 500);
  const toCheck = input.length >= 3 ? input : message.trim().slice(0, 500);
  const verdict = await runShieldCheck(toCheck);

  const ok = await replyToComment(commentId, buildReply(toCheck, verdict));
  if (ok) {
    await db.insert(fbProcessedComments).values({ commentId }).onConflictDoNothing();
  }
}

/**
 * POST /api/fb/webhook — Page feed webhook (comments).
 * Always 200 fast; processing is best-effort (FB retries on non-2xx, dedupe keeps it to 1 reply).
 */
fbRouter.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: FbCommentValue }> }> };
    if (body.object === 'page' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes ?? []) {
          if (change.field === 'feed' && change.value) {
            try {
              await handleComment(change.value);
            } catch (e) {
              console.error('[fb-bot] comment handler error', e);
            }
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

// Health/debug: is the bot configured? (no secrets leaked)
fbRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: Boolean(process.env.FB_PAGE_TOKEN && process.env.FB_VERIFY_TOKEN),
    verifyOnly: Boolean(process.env.FB_VERIFY_TOKEN) && !process.env.FB_PAGE_TOKEN,
  });
});
