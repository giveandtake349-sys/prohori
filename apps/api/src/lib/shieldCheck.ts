/**
 * BlackHole shared verdict engine — extracted from routes/shield.ts (V20).
 * Used by: /api/shield/check, /api/v1/check (Bank Trust API), /api/fb/webhook (FB Tag Bot).
 */
import { createHash } from 'node:crypto';
import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db.js';
import { scamPatterns, scamEntities, type ScamEntity } from 'db';

export type InputType = 'number' | 'shop' | 'app' | 'offer' | 'text';

export type VerdictKind = 'fraud' | 'suspect' | 'blacklisted' | 'unknown' | 'clean';

export interface VerdictResult {
  verdict: VerdictKind;
  type: InputType;
  title: string;
  reasons: string[];
  stats: { reports: number; confirms: number };
  entity: ScamEntity | null;
  riskPct: number;
}

/** Auto-detect what the user pasted. */
export function detectType(raw: string): { type: InputType; normalized: string } {
  const input = raw.trim();
  const lower = input.toLowerCase();
  const digits = input.replace(/\D/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return { type: 'number', normalized: digits };
  if (lower.includes('t.me') || lower.includes('telegram')) return { type: 'offer', normalized: input.slice(0, 500) };
  if (lower.includes('fb.com') || lower.includes('facebook.com')) return { type: 'shop', normalized: input.slice(0, 300) };
  if (lower.includes('play.google')) return { type: 'app', normalized: input.slice(0, 200) };
  return { type: 'text', normalized: input.slice(0, 500) };
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const SAVED_AVG: Record<string, number> = { offer: 45000, app: 30000, number: 9000, shop: 13700, text: 15000 };

/** Score free text against active scam playbooks. */
async function scoreText(text: string): Promise<{ pattern: string; riskPct: number; matched: string[] } | null> {
  const patterns = await db.select().from(scamPatterns).where(eq(scamPatterns.active, true));
  const lower = text.toLowerCase();
  let best: { pattern: string; riskPct: number; matched: string[] } | null = null;
  for (const p of patterns) {
    const keywords = (p.keywords ?? []) as string[];
    if (!keywords.length) continue;
    const signals = (p.signals ?? {}) as Record<string, number>;
    const matched = keywords.filter((k) => lower.includes(k.toLowerCase()));
    if (!matched.length) continue;
    const totalWeight = keywords.reduce((s, k) => s + (signals[k.toLowerCase()] ?? 10), 0);
    const hitWeight = matched.reduce((s, k) => s + (signals[k.toLowerCase()] ?? 10), 0);
    const riskPct = Math.min(99, Math.round((hitWeight / totalWeight) * 100));
    if (!best || riskPct > best.riskPct) best = { pattern: p.name, riskPct, matched };
  }
  return best;
}

export async function buildVerdict(type: InputType, normalized: string): Promise<VerdictResult> {
  // 1) Entity lookup for number/shop/app
  if (type === 'number' || type === 'shop' || type === 'app') {
    const like = `%${normalized.slice(0, 60)}%`;
    const rows = await db
      .select()
      .from(scamEntities)
      .where(and(eq(scamEntities.type, type), or(eq(scamEntities.value, normalized), ilike(scamEntities.value, like))))
      .limit(1);
    const entity = rows[0] ?? null;
    if (entity) {
      const stats = { reports: entity.reportCount ?? 0, confirms: entity.confirmCount ?? 0 };
      if (entity.status === 'fraud')
        return { verdict: 'fraud', type, title: entity.label ?? 'Fraud', reasons: [`${stats.reports} টা verified রিপোর্ট`, entity.label ?? ''], stats, entity, riskPct: 95 };
      if (entity.status === 'blacklisted')
        return { verdict: 'blacklisted', type, title: entity.label ?? 'Blacklisted', reasons: ['কর্তৃপক্ষের blacklist এ আছে'], stats, entity, riskPct: 99 };
      if (entity.status === 'suspect')
        return { verdict: 'suspect', type, title: entity.label ?? 'সন্দেহজনক', reasons: [`${stats.reports} টা রিপোর্ট — যাচাই চলছে`], stats, entity, riskPct: 55 };
      if (entity.status === 'verified_clean')
        return { verdict: 'clean', type, title: entity.label ?? 'যাচাইকৃত', reasons: ['কোনো fraud রিপোর্ট নাই'], stats, entity, riskPct: 5 };
    }
    return {
      verdict: 'unknown',
      type,
      title: 'এখনো রিপোর্ট হয়নি',
      reasons: ['এই database এ কোনো রিপোর্ট নাই — "নিরাপদ" বলা যাচ্ছে না, সতর্ক থাকো'],
      stats: { reports: 0, confirms: 0 },
      entity,
      riskPct: 10,
    };
  }
  // 2) Text/offer: pattern scoring
  const scored = await scoreText(normalized);
  if (scored) {
    const { riskPct, matched, pattern } = scored;
    if (riskPct >= 60)
      return {
        verdict: 'fraud',
        type,
        title: 'Scam pattern match',
        reasons: [`"${pattern}" playbook এর সাথে মিলেছে`, `মিলেছে: ${matched.join(', ')}`],
        stats: { reports: 0, confirms: 0 },
        entity: null,
        riskPct,
      };
    if (riskPct >= 30)
      return {
        verdict: 'suspect',
        type,
        title: 'সন্দেহজনক লক্ষণ',
        reasons: [`আংশিক মিল: ${matched.join(', ')}`, 'টাকা পাঠানোর আগে আরো যাচাই করো'],
        stats: { reports: 0, confirms: 0 },
        entity: null,
        riskPct,
      };
  }
  return {
    verdict: 'unknown',
    type,
    title: 'চেনা pattern মিলেনি',
    reasons: ['known scam playbook এর সাথে মিলে নাই — তবু সতর্ক থাকো'],
    stats: { reports: 0, confirms: 0 },
    entity: null,
    riskPct: 10,
  };
}

/**
 * One-call verdict: detect type + score + return the full verdict.
 * Does NOT log to scam_checks (callers decide — numbers are hashed, never raw).
 */
export async function runShieldCheck(input: string): Promise<VerdictResult> {
  const { type, normalized } = detectType(input);
  return buildVerdict(type, normalized);
}
