import { useEffect, useState } from 'react';
import {
  applyAmbassador,
  completeOnboarding,
  createIdea,
  fetchAmbassadors,
  fetchAmbassadorApplications,
  fetchCaseTeams,
  fetchGrowthStats,
  fetchIdeas,
  fetchInviteStats,
  fetchLocationStatus,
  fetchMyAmbassadorStatus,
  fetchMyInviteCode,
  fetchMyLocationRequests,
  fetchStories,
  fetchTeams,
  joinCaseTeam,
  requestCaseLocation,
  reviewAmbassadorApplication,
  reviewLocationRequest,
  redeemInviteCode,
  resolveInviteCode,
  searchInstitutions,
  voteIdea,
  type AmbassadorApplication,
  type CaseStory,
  type CaseTeam,
  type GrowthStats,
  type Idea,
  type Institution,
  type LocationRequest,
  type Team,
} from './api';

// ---------------------------------------------------------------------------
// Line icons (SVG, stroke style — matches app nav)
// ---------------------------------------------------------------------------
const ip = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

export function GIcon({ d, size = 18 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg {...ip} width={size} height={size} style={{ flex: 'none', verticalAlign: '-3px' }}>
      {d}
    </svg>
  );
}

export const ICONS = {
  home: (<><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 22V12h6v10" /></>),
  users: (<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>),
  bulb: (<><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0012 2z" /></>),
  cap: (<><path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><path d="M22 10v6" /></>),
  share: (<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>),
  pin: (<><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  phone: (<><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.13.96.36 1.9.7 2.8a2 2 0 01-.45 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0122 16.9z" /></>),
  check: (<><path d="M20 6L9 17l-5-5" /></>),
  plus: (<><path d="M12 5v14M5 12h14" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>),
  shield: (<><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>),
  gift: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M12 8s-1.5-5-4.5-5S5 8 12 8zm0 0s1.5-5 4.5-5S19 8 12 8z" /></>),
  story: (<><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></>),
};

// ---------------------------------------------------------------------------
// Ambassador badge — premium medallion (v5 approved design)
// university = gold, college = sapphire, school = platinum
// ---------------------------------------------------------------------------
const BADGE_GRAD = {
  university: { a: '#fef08a', b: '#eab308', c: '#92400e', ring1: '#fef9c3', ring2: '#ca8a04', ring3: '#fde047' },
  college: { a: '#bfdbfe', b: '#2563eb', c: '#1e1b4b', ring1: '#dbeafe', ring2: '#1d4ed8', ring3: '#93c5fd' },
  school: { a: '#ffffff', b: '#94a3b8', c: '#334155', ring1: '#ffffff', ring2: '#64748b', ring3: '#f1f5f9' },
} as const;

export function AmbassadorBadge({ level, size = 44 }: { level: string; size?: number }) {
  const g = BADGE_GRAD[(level as keyof typeof BADGE_GRAD)] ?? BADGE_GRAD.university;
  const uid = `b${level}${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ flex: 'none' }} aria-label={`${level} ambassador`}>
      <defs>
        <radialGradient id={`${uid}g`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={g.a} /><stop offset=".55" stopColor={g.b} /><stop offset="1" stopColor={g.c} />
        </radialGradient>
        <linearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={g.ring1} /><stop offset=".5" stopColor={g.ring2} /><stop offset="1" stopColor={g.ring3} />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill="#0b0e14" />
      <circle cx="60" cy="60" r="56" fill="none" stroke={`url(#${uid}r)`} strokeWidth="4" />
      <circle cx="60" cy="60" r="47" fill={`url(#${uid}g)`} />
      <circle cx="60" cy="60" r="47" fill="black" opacity=".28" />
      <g>
        <path d="M60 38 L90 51 L60 64 L30 51 Z" fill="#0b0e14" />
        <path d="M42 57 L42 72 Q60 80 78 72 L78 57 L60 64 Z" fill="#0b0e14" />
        <line x1="90" y1="51" x2="90" y2="70" stroke="#0b0e14" strokeWidth="3" strokeLinecap="round" />
        <circle cx="90" cy="73" r="4" fill="#0b0e14" />
      </g>
      <text x="60" y="88" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#0b0e14" letterSpacing="1">অগ্রদূত</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 1. Onboarding tour — 3 screens, shown once per user
// ---------------------------------------------------------------------------
const TOUR_STEPS = [
  { icon: ICONS.shield, title: 'অপরাধ দেখলে রিপোর্ট করো', text: 'ছবিসহ রিপোর্ট করো — তোমার পরিচয় গোপন থাকতে পারে।' },
  { icon: ICONS.users, title: 'এলাকার রিপোর্ট যাচাই করো', text: 'যা দেখেছো তা নিশ্চিত করো — জনতার যাচাইয়েই শক্তি।' },
  { icon: ICONS.cap, title: 'টিমে যোগ দাও — একা নও', text: 'তোমার এলাকার ভলান্টিয়ার টিম সবসময় পাশে আছে।' },
];

export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === TOUR_STEPS.length - 1;
  const finish = async () => {
    try { await completeOnboarding(); } catch { /* offline-safe */ }
    try { localStorage.setItem('prohori_onboarded', '1'); } catch { /* noop */ }
    onDone();
  };
  return (
    <div className="onboard-overlay">
      <div className="card onboard-card">
        <div style={{ fontSize: 52, textAlign: 'center', color: 'var(--yellow)' }}>
          <GIcon d={TOUR_STEPS[step].icon} size={52} />
        </div>
        <h3 style={{ textAlign: 'center' }}>{TOUR_STEPS[step].title}</h3>
        <p className="meta" style={{ textAlign: 'center' }}>{TOUR_STEPS[step].text}</p>
        <div className="onboard-dots">
          {TOUR_STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>
        <div className="button-row">
          {!last && <button className="btn dark" onClick={() => setStep(step + 1)}>পরেরটা →</button>}
          {last && <button className="btn yellow" onClick={finish}>শুরু করো →</button>}
          <button className="text-btn" onClick={finish}>বাদ দাও</button>
        </div>
      </div>
    </div>
  );
}

export function shouldShowOnboarding(): boolean {
  try { return localStorage.getItem('prohori_onboarded') !== '1'; } catch { return true; }
}

// ---------------------------------------------------------------------------
// 4. Public counter — live stats strip (zero fake data)
// ---------------------------------------------------------------------------
const bnDigits = (n: number) => n.toLocaleString('bn-BD');

export function PublicCounter() {
  const [stats, setStats] = useState<GrowthStats | null>(null);
  useEffect(() => { fetchGrowthStats().then(setStats).catch(() => {}); }, []);
  if (!stats) return null;
  return (
    <div className="stat-strip">
      <div className="stat-cell"><b>{bnDigits(stats.users)}</b><small>প্রহরী</small></div>
      <div className="stat-cell"><b>{bnDigits(stats.reports)}</b><small>রিপোর্ট</small></div>
      <div className="stat-cell"><b>{bnDigits(stats.resolved)}</b><small>সমাধান</small></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Invite page — referral link + badge
// ---------------------------------------------------------------------------
export function InvitePage() {
  const [code, setCode] = useState('');
  const [invited, setInvited] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetchMyInviteCode().then((r) => setCode(r.code)).catch(() => {});
    fetchInviteStats().then((r) => setInvited(r.invited)).catch(() => {});
  }, []);
  const link = code ? `${window.location.origin}${window.location.pathname}#/i/${code}` : '';
  const share = async () => {
    const text = `প্রহরীতে join করো — জনতার চোখ! ${link}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* noop */ } }
  };
  return (
    <div className="page">
      <h1><GIcon d={ICONS.gift} /> বন্ধুকে আনো</h1>
      <p className="meta">তোমার link দিয়ে যে join করবে, তোমরা দুজনেই <b>প্রহরী badge</b> পাবে।</p>
      <div className="card invite-card">
        <p className="meta">তোমার invite link</p>
        <div className="invite-link">{link || 'লোড হচ্ছে…'}</div>
        <div className="button-row">
          <button className="btn yellow" onClick={share} disabled={!code}>
            <GIcon d={ICONS.share} /> Invite পাঠাও
          </button>
        </div>
        {copied && <p className="meta ok">কপি হয়েছে!</p>}
      </div>
      <div className="card">
        <h3>তোমার স্কোর</h3>
        <p style={{ fontSize: 28, fontWeight: 800 }}>{bnDigits(invited)} <small style={{ fontSize: 13, fontWeight: 400 }}>জন এনেছো</small></p>
      </div>
    </div>
  );
}

/** Invite landing — /#/i/CODE : shows inviter, prompts signup, redeems after profile. */
export function InviteLanding({ code }: { code: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    resolveInviteCode(code).then((r) => setName(r.inviterName)).catch(() => setError('ভুল invite কোড'));
  }, [code]);
  return (
    <div className="page">
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 44, color: 'var(--yellow)' }}><GIcon d={ICONS.gift} size={44} /></div>
        {error ? <p className="state err">{error}</p> : (
          <>
            <h2>{name ? `${name} তোমাকে invite করেছে!` : 'লোড হচ্ছে…'}</h2>
            <p className="meta">প্রহরীতে join করো — তোমরা দুজনেই প্রহরী badge পাবে।</p>
            <div className="button-row" style={{ justifyContent: 'center' }}>
              <a className="btn yellow" href="#/login">Join করো →</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. "ফিচার চাও?" — feature ideas + voting
// ---------------------------------------------------------------------------
export function IdeasPage({ signedIn }: { signedIn: boolean }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    fetchIdeas().then((r) => setIdeas(r.ideas)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { void reload(); }, []);
  const submit = async () => {
    if (title.trim().length < 4) return;
    try { await createIdea(title.trim()); setTitle(''); reload(); } catch { /* noop */ }
  };
  const vote = async (id: string) => {
    if (!signedIn) { window.location.hash = '#/login'; return; }
    try { await voteIdea(id); reload(); } catch { /* noop */ }
  };
  return (
    <div className="page">
      <h1><GIcon d={ICONS.bulb} /> ফিচার চাও?</h1>
      <p className="meta">কোন ফিচার চাও লিখো — সবাই ভোট দিবে। বেশি ভোট পেলে আমরা বানাবো।</p>
      {signedIn && (
        <div className="card">
          <div className="field-row">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="যেমন: রাতে SOS-এ flashlight blink চাই" maxLength={200} />
            <button className="btn yellow" onClick={submit}>পাঠাও</button>
          </div>
        </div>
      )}
      {loading && <p className="state">লোড হচ্ছে…</p>}
      {!loading && ideas.length === 0 && <p className="state">এখনো কোনো আইডিয়া নেই — প্রথম তুমি দাও!</p>}
      {ideas.map((idea) => (
        <div key={idea.id} className="card idea-row">
          <button className="vote-box" onClick={() => vote(idea.id)} aria-label="ভোট দাও">
            <b>{bnDigits(idea.voteCount)}</b><small>ভোট</small>
          </button>
          <div>
            <p style={{ fontWeight: 700 }}>{idea.title}</p>
            <p className="meta">{idea.author ? `${idea.author} · ` : ''}{idea.status === 'done' ? 'বানানো হয়েছে ✓' : idea.status === 'planned' ? 'পরিকল্পনায় আছে' : ''}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Campus ambassador
// ---------------------------------------------------------------------------
export function CampusPage({ signedIn }: { signedIn: boolean }) {
  const [ambs, setAmbs] = useState<Array<{ name: string; institutionName: string; level: string }>>([]);
  const [myStatus, setMyStatus] = useState<{ status: string | null; level: string | null }>({ status: null, level: null });
  useEffect(() => {
    fetchAmbassadors().then((r) => setAmbs(r.ambassadors)).catch(() => {});
    if (signedIn) fetchMyAmbassadorStatus().then(setMyStatus).catch(() => {});
  }, [signedIn]);
  return (
    <div className="page">
      <h1><GIcon d={ICONS.cap} /> Campus অগ্রদূত</h1>
      <p className="meta">তোমার ক্যাম্পাসের <b>অগ্রদূত</b> হও — badge পাও, campus team lead করো।</p>
      {signedIn && myStatus.status === 'pending' && (
        <div className="card"><p><GIcon d={ICONS.clock} /> তোমার application review-এ আছে। Approve হলে জানাবো!</p></div>
      )}
      {signedIn && myStatus.level && myStatus.status === 'approved' && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <AmbassadorBadge level={myStatus.level} />
          <div><h3 style={{ margin: 0 }}>তুমি অগ্রদূত!</h3><p className="meta">Campus team খুলে বন্ধুদের নিয়ে কাজ শুরু করো।</p></div>
        </div>
      )}
      {(!signedIn || !myStatus.status || myStatus.status === 'rejected') && (
        <div className="button-row">
          <a className="btn yellow" href="#/campus/apply"><GIcon d={ICONS.cap} /> অগ্রদূত হতে চাই</a>
        </div>
      )}
      <h2 className="sec">আমাদের অগ্রদূতরা</h2>
      {ambs.length === 0 && <p className="state">এখনো কোনো অগ্রদূত নেই — প্রথম তুমি হও!</p>}
      {ambs.map((a, i) => (
        <div key={i} className="card amb-row">
          <AmbassadorBadge level={a.level} size={40} />
          <div><b>{a.name}</b><p className="meta">{a.institutionName}</p></div>
        </div>
      ))}
    </div>
  );
}

export function AmbassadorApplyPage({ signedIn, userName, userPhone }: { signedIn: boolean; userName: string; userPhone: string }) {
  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState(userPhone);
  const [level, setLevel] = useState<'university' | 'college' | 'school'>('university');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Institution[]>([]);
  const [picked, setPicked] = useState<Institution | null>(null);
  const [customName, setCustomName] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = window.setTimeout(() => {
      searchInstitutions(query.trim(), level).then((r) => setResults(r.institutions)).catch(() => {});
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, level]);

  if (!signedIn) {
    window.location.hash = '#/login';
    return <div className="page"><p className="state">Login page-এ নিয়ে যাওয়া হচ্ছে…</p></div>;
  }

  const submit = async () => {
    setError('');
    const institutionName = picked ? picked.name : customName.trim();
    if (!name.trim() || !phone.trim() || !institutionName) { setError('নাম, ফোন আর institution দাও'); return; }
    try {
      await applyAmbassador({
        name: name.trim(), phone: phone.trim(),
        institutionId: picked?.id, institutionName, level, reason: reason.trim() || undefined,
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'জমা দেওয়া যায়নি');
    }
  };

  if (done) {
    return (
      <div className="page"><div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 44, color: 'var(--yellow)' }}><GIcon d={ICONS.clock} size={44} /></div>
        <h2>Application গেছে!</h2>
        <p className="meta">Admin approve করলে তুমি অগ্রদূত badge পাবে।</p>
        <a className="btn dark" href="#/campus">← Campus page</a>
      </div></div>
    );
  }

  return (
    <div className="page">
      <h1><GIcon d={ICONS.cap} /> অগ্রদূত application</h1>
      <div className="card">
        <div className="field"><label>নাম</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>ফোন</label><input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label>Level</label>
          <div className="seg">
            {(['university', 'college', 'school'] as const).map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => { setLevel(l); setPicked(null); setQuery(''); }}>
                {l === 'university' ? 'University' : l === 'college' ? 'College' : 'School'}
              </button>
            ))}
          </div>
        </div>
        <div className="field"><label><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg> Institution খুঁজো</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="যেমন: Dhaka University" />
          {results.length > 0 && (
            <div className="search-results">
              {results.map((r) => (
                <div key={r.id} className={picked?.id === r.id ? 'sel' : ''} onClick={() => setPicked(r)}>
                  {picked?.id === r.id ? '✓ ' : ''}{r.name} <span className="meta">· {r.district}</span>
                </div>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <input style={{ marginTop: 8 }} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="নাম লিখো (list-এ না থাকলে)" />
          )}
        </div>
        {picked && <p className="meta ok">✓ {picked.name}</p>}
        <div className="field"><label>কেন অগ্রদূত হতে চাও? (optional)</label>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        {error && <p className="state err">{error}</p>}
        <button className="btn yellow" onClick={submit}>Submit</button>
      </div>
    </div>
  );
}

/** Admin: ambassador applications review */
export function AmbassadorReviewPage() {
  const [apps, setApps] = useState<AmbassadorApplication[]>([]);
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const reload = () => fetchAmbassadorApplications(scope).then((r) => setApps(r.applications)).catch(() => {});
  useEffect(() => { void reload(); }, [scope]);
  const review = async (id: string, decision: 'approved' | 'rejected') => {
    try { await reviewAmbassadorApplication(id, decision); reload(); } catch { /* noop */ }
  };
  return (
    <div className="page">
      <h1><GIcon d={ICONS.cap} /> অগ্রঅগ্রদূত applications</h1>
      <div className="seg">
        <button className={scope === 'pending' ? 'on' : ''} onClick={() => setScope('pending')}>Pending</button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>সব</button>
      </div>
      {apps.length === 0 && <p className="state">কোনো application নেই।</p>}
      {apps.map((a) => (
        <div key={a.id} className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AmbassadorBadge level={a.level} size={40} />
            <div><b>{a.name}</b> <span className="meta">{a.phone}</span>
              <p className="meta">{a.institutionName} · {a.level} · {a.status}</p></div>
          </div>
          {a.reason && <p style={{ marginTop: 8 }}>"{a.reason}"</p>}
          {a.status === 'pending' && (
            <div className="button-row">
              <button className="btn yellow" onClick={() => review(a.id, 'approved')}>Approve</button>
              <button className="btn dark" onClick={() => review(a.id, 'rejected')}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Case → team loop: join box for report detail pages
// ---------------------------------------------------------------------------
export function CaseTeamBox({ reportId, signedIn }: { reportId: string; signedIn: boolean }) {
  const [teams, setTeams] = useState<CaseTeam[]>([]);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [picked, setPicked] = useState('');
  const [locStatus, setLocStatus] = useState<Record<string, string | null>>({});
  const [msg, setMsg] = useState('');
  const reload = () => fetchCaseTeams(reportId).then((r) => setTeams(r.teams)).catch(() => {});
  useEffect(() => {
    reload();
    if (signedIn) fetchTeams().then((r) => setMyTeams(r.teams)).catch(() => {});
  }, [reportId, signedIn]);
  useEffect(() => {
    teams.forEach((t) => {
      fetchLocationStatus(reportId, t.teamId).then((r) => setLocStatus((s) => ({ ...s, [t.teamId]: r.status }))).catch(() => {});
    });
  }, [teams, reportId]);

  const join = async () => {
    if (!picked) return;
    setMsg('');
    try { await joinCaseTeam(reportId, picked); setMsg('টিম কেসে join করেছে!'); setPicked(''); reload(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Join করা যায়নি'); }
  };
  const reqLoc = async (teamId: string) => {
    try {
      const r = await requestCaseLocation(reportId, teamId);
      setLocStatus((s) => ({ ...s, [teamId]: r.status ?? 'pending' }));
      setMsg('Location request পাঠানো হয়েছে — reporter approve করলে pin দেখবে।');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Request যায়নি'); }
  };

  return (
    <div className="card">
      <h3><GIcon d={ICONS.shield} /> এই কেসে টিম ({teams.length})</h3>
      {teams.length === 0 && <p className="meta">এখনো কোনো টিম join করেনি।</p>}
      {teams.map((t) => (
        <div key={t.teamId} className="team-line">
          <div><b>{t.name}</b> <span className="meta">· {t.memberCount} জন</span></div>
          {locStatus[t.teamId] === 'approved'
            ? <span className="meta ok"><GIcon d={ICONS.pin} /> location পেয়েছে</span>
            : locStatus[t.teamId] === 'pending'
              ? <span className="meta">location request pending…</span>
              : <button className="btn dark" onClick={() => reqLoc(t.teamId)}><GIcon d={ICONS.pin} /> Location চাই</button>}
        </div>
      ))}
      {signedIn && myTeams.length > 0 && (
        <div className="field-row" style={{ marginTop: 10 }}>
          <select value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">টিম select করো…</option>
            {myTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="btn yellow" onClick={join} disabled={!picked}>Join করো</button>
        </div>
      )}
      {signedIn && <p className="meta">কেস নিতে টিমে কমপক্ষে ৩ জন member লাগবে।</p>}
      {msg && <p className="meta">{msg}</p>}
    </div>
  );
}

/** Reporter's pending location requests */
export function LocationRequestsBox() {
  const [reqs, setReqs] = useState<LocationRequest[]>([]);
  const reload = () => fetchMyLocationRequests().then((r) => setReqs(r.requests)).catch(() => {});
  useEffect(() => { void reload(); }, []);
  if (reqs.length === 0) return null;
  const review = async (id: string, d: 'approved' | 'rejected') => {
    try { await reviewLocationRequest(id, d); reload(); } catch { /* noop */ }
  };
  return (
    <div className="card">
      <h3><GIcon d={ICONS.pin} /> Location requests ({reqs.length})</h3>
      {reqs.map((r) => (
        <div key={r.id} className="team-line">
          <div><b>{r.teamName}</b><p className="meta">{r.reportTitle}</p></div>
          <div className="button-row">
            <button className="btn yellow" onClick={() => review(r.id, 'approved')}>দাও</button>
            <button className="btn dark" onClick={() => review(r.id, 'rejected')}>না</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stories rail — solved-case auto stories (viral loop)
// ---------------------------------------------------------------------------
export function StoriesRail() {
  const [stories, setStories] = useState<CaseStory[]>([]);
  useEffect(() => { fetchStories().then((r) => setStories(r.stories)).catch(() => {}); }, []);
  if (stories.length === 0) return null;
  const shareStory = async (s: CaseStory) => {
    const text = `${s.title}\n${s.body}\n${window.location.origin}${window.location.pathname}#/`;
    if (navigator.share) { try { await navigator.share({ text }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard.writeText(text); } catch { /* noop */ } }
  };
  return (
    <div>
      <h2 className="sec"><GIcon d={ICONS.story} /> সাফল্যের গল্প</h2>
      <div className="stories-rail">
        {stories.slice(0, 6).map((s) => (
          <div key={s.id} className="card story-card">
            <h4>{s.title}</h4>
            <p className="meta" style={{ whiteSpace: 'pre-line' }}>{s.body}</p>
            <button className="btn dark" onClick={() => shareStory(s)}><GIcon d={ICONS.share} /> Share</button>
          </div>
        ))}
      </div>
    </div>
  );
}
