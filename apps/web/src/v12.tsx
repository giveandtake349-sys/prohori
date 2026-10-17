import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  followMissing,
  followReport,
  getSpotlight,
  shareReport,
  unfollowMissing,
  unfollowReport,
  voteClaim,
  caseShareUrl,
  type ClaimItem,
  type FeedReport,
  type FeedSort,
  type HistoryItem,
  type MediaItem,
  type VerificationStage,
} from './api';
import { CATEGORY_BN, LEVEL_BN, STATUS_BN } from './labels';
import ShareButtons from './share';

/** Derive the v12 stage from the legacy tier when the API omits the new field. */
export function stageOf(report: FeedReport): VerificationStage {
  if (typeof report.verificationStage === 'number') return report.verificationStage;
  if (report.verificationTier === 'official') return 3;
  if (report.verificationTier === 'community') return 2;
  return 0;
}

const STAGE_BN: Record<VerificationStage, string> = {
  0: 'যাচাই হয়নি',
  1: 'প্রাথমিকভাবে নিশ্চিত',
  2: 'জনতা যাচাইকৃত',
  3: 'প্রহরী যাচাইকৃত',
};

/** Staged verification badge. 0 gray → 1 yellow → 2 blue → 3 green. */
export function StageBadge({ stage }: { stage: VerificationStage }) {
  return <span className={`chip tier stg-${stage}`}>{STAGE_BN[stage] ?? STAGE_BN[0]}</span>;
}

/**
 * Compact verification progress: "✓ X/Y" + colored bar + milestone dots.
 * Replaces the old long "আরও N জন নিশ্চিত করলে…" text everywhere.
 */
export function StageProgress({
  count,
  threshold,
  stage,
}: {
  count: number;
  threshold?: number;
  stage: VerificationStage;
}) {
  const target = threshold && threshold > 0 ? threshold : stage === 0 ? 2 : Math.max(count, 1);
  const done = stage === 3 || count >= target;
  const pct = done ? 100 : Math.max(0, Math.min(100, (count / Math.max(target, 1)) * 100));
  const barCls = stage === 2 ? 'bar-blue' : stage === 3 ? 'bar-green' : 'bar-yellow';
  const dots: number[] = [];
  if (2 < target) dots.push((2 / target) * 100);
  if (threshold && threshold > 0 && threshold < target) dots.push((threshold / target) * 100);
  return (
    <div className="stage-progress" aria-label={`যাচাই অগ্রগতি ${count}/${target}`}>
      <span className="stage-count">✓ {count}/{target}</span>
      <span className="stage-bar">
        <i className={`stage-fill ${barCls}`} style={{ width: `${pct}%` }} />
        {dots.map((d, i) => (
          <b key={i} className="stage-dot" style={{ left: `${d}%` }} />
        ))}
      </span>
    </div>
  );
}

/** Pill toggle: "+ Follow" ⇄ "✓ Following" (green tint when on). */
export function FollowButton({
  kind,
  id,
  initialFollowing,
  initialCount,
  signedIn,
  circle,
}: {
  kind: 'report' | 'missing';
  id: string;
  initialFollowing?: boolean;
  initialCount?: number;
  signedIn?: boolean;
  circle?: boolean;
}) {
  const [following, setFollowing] = useState(!!initialFollowing);
  const [count, setCount] = useState(initialCount ?? 0);
  const [busy, setBusy] = useState(false);

  // Keep in sync when the parent reloads fresh data.
  useEffect(() => {
    setFollowing(!!initialFollowing);
    setCount(initialCount ?? 0);
  }, [initialFollowing, initialCount, id]);

  const toggle = async () => {
    if (!signedIn) {
      window.location.hash = '#/login';
      return;
    }
    if (busy) return;
    setBusy(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setCount((c) => Math.max(0, c + (wasFollowing ? -1 : 1)));
    try {
      const res =
        kind === 'report'
          ? wasFollowing
            ? await unfollowReport(id)
            : await followReport(id)
          : wasFollowing
            ? await unfollowMissing(id)
            : await followMissing(id);
      setFollowing(res.following);
      if (typeof res.follower_count === 'number') setCount(res.follower_count);
    } catch {
      // Roll back the optimistic update on failure.
      setFollowing(wasFollowing);
      setCount((c) => Math.max(0, c + (wasFollowing ? 1 : -1)));
    } finally {
      setBusy(false);
    }
  };

  if (circle) {
    return (
      <button
        type="button"
        className="rcbtn"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={following}
      >
        <span className="rcc">{following
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>}</span>
        <small>{following ? 'ফলো ✓' : 'ফলো'}{count > 0 ? ` ${count}` : ''}</small>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`follow-pill${following ? ' on' : ''}`}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={following}
    >
      {following ? '✓ Following' : '+ Follow'}
      {count > 0 && <span className="follow-count">{count}</span>}
    </button>
  );
}

/** Deadline pill: "⏳ N দিন বাকি" or red "🟥 ব্যর্থ — N দিন" (+ escalation note). */
export function DeadlineTag({
  deadlineAt,
  overdue,
  escalationLevel,
  resolved,
}: {
  deadlineAt?: string | null;
  overdue?: boolean;
  escalationLevel?: string | null;
  resolved?: boolean;
}) {
  if (!deadlineAt || resolved) return null;
  const target = new Date(deadlineAt).getTime();
  if (Number.isNaN(target)) return null;
  const day = 86_400_000;
  const diff = target - Date.now();
  if (overdue || diff < 0) {
    const days = Math.max(1, Math.ceil(-diff / day));
    const level =
      escalationLevel && escalationLevel !== 'thana'
        ? LEVEL_BN[escalationLevel] ?? escalationLevel
        : null;
    return (
      <span className="deadline-wrap">
        <span className="chip deadline overdue">ব্যর্থ — {days} দিন</span>
        {level && <small className="esc-note">{level} পর্যায়ে এসকেলেটেড</small>}
      </span>
    );
  }
  const daysLeft = Math.max(0, Math.ceil(diff / day));
  return <span className="chip deadline">⏳ {daysLeft} দিন বাকি</span>;
}

/** Feed sort toggle: 🔥 গুরুত্বপূর্ণ (hot, default) / 🆕 নতুন (new). */
export function SortToggle({ sort, onChange }: { sort: FeedSort; onChange: (s: FeedSort) => void }) {
  return (
    <div className="sort-toggle" role="group" aria-label="ফিড সাজান">
      <button type="button" className={sort === 'hot' ? 'fchip on' : 'fchip'} onClick={() => onChange('hot')}>
        গুরুত্বপূর্ণ
      </button>
      <button type="button" className={sort === 'new' ? 'fchip on' : 'fchip'} onClick={() => onChange('new')}>
        🆕 নতুন
      </button>
    </div>
  );
}

/** Report card: up to 3 image previews in a row, "+N" overlay on the 3rd if more. */
export function ReportMediaRow({ media, trackingId }: { media?: MediaItem[]; trackingId: string }) {
  const items = (media ?? []).filter((m) => m && m.url);
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  const extra = items.length - shown.length;
  return (
    <div className="rmedia-row">
      {shown.map((m, i) => (
        <a key={i} className="rmedia" href={`#/track/${encodeURIComponent(trackingId)}`} aria-label="প্রমাণের ছবি দেখুন">
          <img
            src={m.url}
            alt="প্রমাণ"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {i === shown.length - 1 && extra > 0 && <span className="rmedia-more">+{extra}</span>}
        </a>
      ))}
    </div>
  );
}

/**
 * Confirm/dispute voting under each police-action claim row.
 * Renders nothing when the API does not expose claims (defensive).
 */
export function ClaimVotes({
  reportId,
  claims,
  signedIn,
  onChanged,
}: {
  reportId: string;
  claims?: ClaimItem[] | null;
  signedIn: boolean;
  onChanged?: () => void;
}) {
  const [local, setLocal] = useState<ClaimItem[] | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setLocal(null);
  }, [reportId, claims]);

  const list = local ?? claims ?? null;
  if (!list || list.length === 0) return null;
  const anyDisputed = list.some((c) => c.disputedClaim);

  const vote = async (claim: ClaimItem, v: 'confirm' | 'dispute') => {
    if (!signedIn) {
      window.location.hash = '#/login';
      return;
    }
    if (busy) return;
    setBusy(`${claim.id}:${v}`);
    try {
      const res = await voteClaim(reportId, claim.id, v);
      setLocal((cur) =>
        (cur ?? list).map((c) =>
          c.id === claim.id
            ? { ...c, confirms: res.confirms, disputes: res.disputes, disputedClaim: res.disputed_claim, myVote: v }
            : c,
        ),
      );
      onChanged?.();
    } catch {
      /* keep old counts on failure */
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="claim-votes">
      <div className="claim-votes-head">
        <b>পুলিশি ব্যবস্থার দাবি</b>
        {anyDisputed && <span className="chip disputed">বিতর্কিত</span>}
      </div>
      {list.map((c) => (
        <div className="claim-row" key={c.id}>
          <div className="claim-main">
            <span className="claim-kind">{c.claim === 'action_taken' ? 'ব্যবস্থা নেওয়া হয়েছে' : 'নেওয়া হয়নি'}</span>
            {c.note && <span className="claim-note">“{c.note}”</span>}
            {c.userName && <small className="claim-user">{c.userName}</small>}
            <small className="claim-counts">
              ✓ {c.confirms} সঠিক • ✗ {c.disputes} ভুল
            </small>
            {c.disputedClaim && <span className="chip disputed">বিতর্কিত</span>}
          </div>
          <div className="claim-btns">
            <button
              type="button"
              className={`mini-vote${c.myVote === 'confirm' ? ' on' : ''}`}
              disabled={!!busy}
              onClick={() => void vote(c, 'confirm')}
            >
              ✓ সঠিক
            </button>
            <button
              type="button"
              className={`mini-vote no${c.myVote === 'dispute' ? ' on' : ''}`}
              disabled={!!busy}
              onClick={() => void vote(c, 'dispute')}
            >
              ✗ ভুল
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Home "🔥 আজকের আলোচিত" spotlight rail (from /api/reports/spotlight). */
export function SpotlightRail() {
  const [reports, setReports] = useState<FeedReport[]>([]);

  useEffect(() => {
    getSpotlight()
      .then((d) => setReports(d.reports ?? []))
      .catch(() => setReports([]));
  }, []);

  if (reports.length === 0) return null;

  return (
    <section className="spotlight" aria-label="আজকের আলোচিত">
      <h2 className="sec">আজকের আলোচিত</h2>
      <div className="spot-rail">
        {reports.map((r) => {
          const img = r.media?.find((m) => m && m.url)?.url;
          return (
            <article className="spot-card" key={r.id}>
              {img && (
                <img
                  className="spot-img"
                  src={img}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <div className="spot-body">
                <DeadlineTag
                  deadlineAt={r.deadlineAt}
                  overdue={r.overdue}
                  escalationLevel={r.escalationLevel}
                  resolved={r.status === 'resolved'}
                />
                <h3>{r.title}</h3>
                <div className="spot-foot">
                  <a className="track-link" href={`#/track/${encodeURIComponent(r.trackingId)}`}>
                    বিস্তারিত →
                  </a>
                  <ShareButtons
                    url={caseShareUrl(r.trackingId)}
                    text={r.title}
                    size="sm"
                    onShared={() => {
                      void shareReport(r.id).catch(() => undefined);
                    }}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Print-friendly case file (modal) → window.print(). */
export function CasePrintView({
  report,
  media,
  history,
  onClose,
}: {
  report: FeedReport;
  media: MediaItem[];
  history: HistoryItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.classList.add('printing-case');
    return () => document.body.classList.remove('printing-case');
  }, []);

  return createPortal(
    <div className="print-overlay" role="dialog" aria-label="কেস ফাইল প্রিন্ট">
      <div className="print-sheet">
        <div className="print-actions">
          <button type="button" className="primary-btn" onClick={() => window.print()}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 14h12v8H6z"/></svg> প্রিন্ট করো
          </button>
          <button type="button" className="small-btn" onClick={onClose}>
            বন্ধ করো
          </button>
        </div>
        <div className="print-doc">
          <h1>{report.title}</h1>
          <p className="print-meta">
            ট্র্যাকিং: {report.trackingId} • {CATEGORY_BN[report.category] ?? report.category} •{' '}
            {STATUS_BN[report.status] ?? report.status}
          </p>
          <p className="print-meta">ঠিকানা: {report.addressText}</p>
          <p className="print-meta">যাচাই: {STAGE_BN[stageOf(report)]}</p>
          <p>{report.description}</p>
          <h2>টাইমলাইন</h2>
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                <b>{STATUS_BN[h.toStatus] ?? h.toStatus}</b>
                {h.note ? ` — ${h.note}` : ''}{' '}
                <small>({new Date(h.createdAt).toLocaleString('bn-BD')})</small>
              </li>
            ))}
          </ul>
          {media.length > 0 && (
            <>
              <h2>প্রমাণ ({media.length})</h2>
              <div className="print-imgs">
                {media.map((m, i) => (
                  <img key={i} src={m.url} alt={`প্রমাণ ${i + 1}`} />
                ))}
              </div>
            </>
          )}
          <h2>পুলিশি ব্যবস্থার দাবি</h2>
          <p>
            {report.actionTakenCount} জন বলছে ব্যবস্থা নেওয়া হয়েছে • {report.noActionCount} জন বলছে নেওয়া
            হয়নি
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
