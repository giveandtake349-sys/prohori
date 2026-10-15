import { useEffect, useState } from 'react';
import { LoginPage, ProfileSetupPage, useAuthState } from './Auth';
import {
  FraudPage,
  HomePage,
  ModerationPage,
  NewReportPage,
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

function Shell() {
  const route = useHashRoute();
  const auth = useAuthState();
  const { t } = useLang();

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
        <a className="topbar-brand" href="#/">প্রহরী</a>
        <div className="nav-links">
          <a href="#/">{t('nav_report')}</a>
          <a href="#/reports/new">{t('report_h')}</a>
          <a href="#/teams">{t('nav_teams')}</a>
          <a href="#/scorecard">{t('nav_scorecard')}</a>
          <a href="#/dabi">{t('nav_dabi')}</a>
          <a href="#/missing">{t('nav_missing')}</a>
          <a href="#/trends">{t('nav_trends')}</a>
          <a href="#/fraud">{t('nav_fraud')}</a>
          <a href="#/track">Track</a>
          {isMod && <a href="#/moderation">{t('nav_moderate')}</a>}
        </div>
        <div className="user-menu">
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
