import admin from 'firebase-admin';
import { inArray, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { deviceTokens } from 'db';

// ---------------------------------------------------------------------------
// Push notifications via Firebase Cloud Messaging.
//
// Setup (see README): create a Firebase project, generate a service-account
// JSON key, and set it as the FIREBASE_SERVICE_ACCOUNT_JSON env var
// (the whole JSON as a single-line string) on Render.
//
// SAFETY: every function here is defensive. If the env var is missing,
// invalid, or a send fails, we log a warning and continue — a push failure
// must NEVER crash or block an API request (especially SOS).
// ---------------------------------------------------------------------------

let fcmApp: admin.app.App | null = null;
let initAttempted = false;

function getApp(): admin.app.App | null {
  if (fcmApp) return fcmApp;
  if (initAttempted) return null;
  initAttempted = true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[notify] FIREBASE_SERVICE_ACCOUNT_JSON not set — push disabled');
    return null;
  }
  try {
    const cred = JSON.parse(raw) as admin.ServiceAccount;
    fcmApp = admin.initializeApp({ credential: admin.credential.cert(cred) });
    console.log('[notify] FCM initialized');
    return fcmApp;
  } catch (e) {
    console.warn('[notify] invalid FIREBASE_SERVICE_ACCOUNT_JSON — push disabled:', (e as Error).message);
    return null;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  /** Optional data payload delivered to the app (all values must be strings). */
  data?: Record<string, string>;
}

export interface PushResult {
  requested: number;
  tokens: number;
  sent: number;
  failed: number;
}

/**
 * Send a push notification to a list of user ids. Looks up their registered
 * device tokens and fans out via FCM multicast. Invalid/expired tokens are
 * pruned best-effort. NEVER throws — returns counts instead.
 */
export async function sendToUserIds(userIds: string[], payload: PushPayload): Promise<PushResult> {
  const empty: PushResult = { requested: userIds.length, tokens: 0, sent: 0, failed: 0 };
  try {
    const app = getApp();
    if (!app) {
      if (userIds.length > 0) {
        console.warn(`[notify] FCM not configured — skipping push to ${userIds.length} user(s): ${payload.title}`);
      }
      return empty;
    }
    const uniq = [...new Set(userIds)];
    if (uniq.length === 0) return empty;
    const rows = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(inArray(deviceTokens.userId, uniq));
    const tokens = [...new Set(rows.map((r) => r.token))];
    if (tokens.length === 0) {
      console.warn(`[notify] no device tokens for ${uniq.length} user(s) — skipping`);
      return { ...empty, requested: uniq.length };
    }
    const res = await admin.messaging(app).sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });
    // Prune dead tokens best-effort (invalid or unregistered).
    const dead: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = (r.error as { code?: string } | undefined)?.code ?? '';
        if (code.includes('invalid-registration-token') || code.includes('registration-token-not-registered')) {
          dead.push(tokens[i]);
        }
      }
    });
    if (dead.length > 0) {
      try {
        for (const t of dead) {
          await db.delete(deviceTokens).where(eq(deviceTokens.token, t));
        }
        console.log(`[notify] pruned ${dead.length} dead token(s)`);
      } catch (e) {
        console.warn('[notify] token prune failed:', (e as Error).message);
      }
    }
    console.log(`[notify] sent ${res.successCount}/${tokens.length} (${payload.title})`);
    return { requested: uniq.length, tokens: tokens.length, sent: res.successCount, failed: res.failureCount };
  } catch (e) {
    console.warn('[notify] send failed:', (e as Error).message);
    return empty;
  }
}
