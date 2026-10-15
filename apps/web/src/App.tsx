import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LoginPage, ProfileSetupPage, useAuthState } from './Auth';
import {
  FraudPage,
  HomePage,
  ModerationPage,
  NewReportPage,
  TeamDetailPage,
  TeamsPage,
  TrackPage,
  TrackSearchPage,
} from './FeaturePages';
import { ScorecardDetailPage, ScorecardListPage } from './ScorecardPage';
import DabiPage from './DabiPage';
import MissingPage from './MissingPage';
import TrendsPage from './TrendsPage';
import CasePage from './CasePage';
import { LangProvider, useLang, type Lang } from './i18n';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function LoadingPage({ text }: { text: string }) {
  return <main className="auth-shell"><p className="state">{text}</p></main>;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  );
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('prohori-theme', next); } catch { /* private mode */ }
    setTheme(next);
  };
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'লাইট থিম চালু করো' : 'ডার্ক থিম চালু করো'}
      title={theme === 'dark' ? 'লাইট থিম' : 'ডার্ক থিম'}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

function LangToggle() {
  const { lang, setLang, t } = useLang();
  const next: Lang = lang === 'bn' ? 'en' : 'bn';
  return (
    <button
      className="lang-toggle"
      onClick={() => setLang(next)}
      aria-label={lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন'}
    >
      {t('lang_toggle')}
    </button>
  );
}

/* v5: radial circle menu — one button opens all sections in a circle */
function RadialMenu({ isMod }: { isMod: boolean }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const { t } = useLang();

  const iconProps = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
  } as const;

  const items: { href: string; label: string; sos?: boolean; icon: ReactNode }[] = [
    { href: '#/', label: t('nav_report'), icon: (<svg {...iconProps}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 22V12h6v10" /></svg>) },
    { href: '#/reports/new', label: t('report_h'), icon: (<svg {...iconProps}><path d="M12 5v14M5 12h14" /></svg>) },
    { href: '#/teams', label: t('nav_teams'), icon: (<svg {...iconProps}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>) },
    { href: '#/scorecard', label: t('nav_scorecard'), icon: (<svg {...iconProps}><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>) },
    { href: '#/dabi', label: t('nav_dabi'), icon: (<svg {...iconProps}><path d="M4 21V10l8-6 8 6v11" /><path d="M12 10v11" /></svg>) },
    { href: '#/missing', label: t('nav_missing'), icon: (<svg {...iconProps}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>) },
    { href: '#/trends', label: t('nav_trends'), icon: (<svg {...iconProps}><path d="M23 6l-9.5 9.5-5-5L23 6z" /><path d="M17 6h6v6" /></svg>) },
    { href: '#/fraud', label: t('nav_fraud'), icon: (<svg {...iconProps}><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z" /><path d="M9 12l2 2 4-4" /></svg>) },
    { href: '#/track', label: 'Track', icon: (<svg {...iconProps}><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>) },
    { href: '#/teams', label: 'SOS', sos: true, icon: (<svg {...iconProps}><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z" /><path d="M12 8v4M12 16h.01" /></svg>) },
  ];
  if (isMod) {
    items.push({
      href: '#/moderation', label: t('nav_moderate'),
      icon: (<svg {...iconProps}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></svg>),
    });
  }

  const openMenu = () => {
    setOpen(true);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };
  const closeMenu = () => {
    setShown(false);
    document.body.style.overflow = '';
    window.setTimeout(() => setOpen(false), 220);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open ]);

  /* v7: blur everything behind the circle menu; overlay is portaled to body so it stays sharp */
  useEffect(() => {
    const frame = document.querySelector('.app-frame') as HTMLElement | null;
    if (!frame) return;
    if (open) {
      frame.classList.add('menu-open');
      frame.style.filter = 'blur(6px) brightness(.97)';
    } else {
      frame.classList.remove('menu-open');
      frame.style.filter = '';
    }
    return () => {
      frame.classList.remove('menu-open');
      frame.style.filter = '';
    };
  }, [open ]);

  const n = items.length;
  const R = Math.min(window.innerWidth * 0.36, 140);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.44;

  return (
    <>
      <button className="menu-btn" onClick={openMenu} aria-label="মেনু" title="মেনু">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
        </svg>
      </button>
      {open && createPortal(
        <div className="radial-overlay" role="dialog" aria-label="মেনু">
          <div className="radial-bg" onClick={closeMenu} />
          <button className="radial-center" onClick={closeMenu} aria-label="বন্ধ করো">✕</button>
          {items.map((item, i) => {
            const a = (-90 + (i * 360) / n) * (Math.PI / 180);
            const x = cx + R * Math.cos(a);
            const y = cy + R * Math.sin(a);
            return (
              <a
                key={item.href + item.label}
                href={item.href}
                onClick={closeMenu}
                className={item.sos ? 'ritem sos' : 'ritem'}
                style={{
                  left: x - 30,
                  top: y - 31,
                  opacity: shown ? 1 : 0,
                  transform: shown ? 'scale(1)' : 'scale(.4)',
                  transitionDelay: `${i * 35}ms`,
                }}
              >
                <span className="rc">{item.icon}</span>
                <small>{item.label}</small>
              </a>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function Shell() {
  const route = useHashRoute();
  const auth = useAuthState();

  if (auth.loading) return <LoadingPage text="Prohori চালু হচ্ছে…" />;
  if (auth.session && auth.profileLoading) return <LoadingPage text="আপনার account যাচাই হচ্ছে…" />;
  if (auth.session && !auth.profile) {
    return <ProfileSetupPage user={auth.session.user} onComplete={() => { void auth.refreshProfile(); }} />;
  }

  const profile = auth.profile;
  const signedIn = !!auth.session && !!profile;
  const routePathRaw = route.startsWith('#') ? route.slice(1) : route;
  const routePath = signedIn && routePathRaw === '/login' ? '/' : routePathRaw;
  const isMod = !!profile && (profile.role === 'moderator' || profile.role === 'admin');
  let page;
  if (routePath === '/login') {
    page = <LoginPage />;
  } else if (routePath === '/reports/new') {
    page = <NewReportPage signedIn={signedIn} />;
  } else if (routePath === '/teams') {
    page = <TeamsPage profile={profile} />;
  } else if (routePath.startsWith('/teams/')) {
    page = <TeamDetailPage teamId={decodeURIComponent(routePath.slice('/teams/'.length))} profile={profile} />;
  } else if (routePath === '/fraud') {
    page = <FraudPage profile={profile} />;
  } else if (routePath === '/track') {
    page = <TrackSearchPage />;
  } else if (routePath.startsWith('/track/')) {
    page = <TrackPage trackingId={decodeURIComponent(routePath.slice('/track/'.length))} />;
  } else if (routePath === '/scorecard') {
    page = <ScorecardListPage />;
  } else if (routePath.startsWith('/scorecard/')) {
    page = <ScorecardDetailPage thanaId={decodeURIComponent(routePath.slice('/scorecard/'.length))} />;
  } else if (routePath === '/dabi') {
    page = <DabiPage signedIn={signedIn} />;
  } else if (routePath === '/missing') {
    page = <MissingPage signedIn={signedIn} />;
  } else if (routePath === '/trends') {
    page = <TrendsPage />;
  } else if (routePath.startsWith('/case/')) {
    page = <CasePage trackingId={decodeURIComponent(routePath.slice('/case/'.length))} />;
  } else if (routePath === '/moderation') {
    page = isMod
      ? <ModerationPage profile={profile} />
      : <div className="page"><h1>অনুমতি নেই</h1><p className="meta">এই page শুধু moderator/admin account-এর জন্য।</p></div>;
  } else {
    page = <HomePage signedIn={signedIn} />;
  }

  return (
    <div className="app-frame">
      <nav className="topbar">
        <a className="topbar-brand" href="#/">
          <img src="/prohori-logo.webp" alt="প্রহরী" />
          প্রহরী
        </a>
        <div className="user-menu">
          <a className="sos-pill" href="#/teams">SOS</a>
          <RadialMenu isMod={isMod} />
          <ThemeToggle />
          <LangToggle />
          {profile ? (
            <>
              <span className="user-name">{profile.name}</span>
              <button className="text-btn" onClick={() => void auth.signOut()}>Sign out</button>
            </>
          ) : <a className="login-link" href="#/login">Login / Sign up</a>}
        </div>
      </nav>
      {page}
      <footer className="site-footer">Prohori MVP • জরুরি বিপদে ৯৯৯-এ কল করুন।</footer>
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Shell />
    </LangProvider>
  );
}
