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

export default function App() {
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
  } else if (routePath === '/moderation') {
    page = profile && (profile.role === 'moderator' || profile.role === 'admin')
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
          <a href="#/">রিপোর্ট</a>
          <a href="#/reports/new">রিপোর্ট দিন</a>
          <a href="#/teams">পাশে আছি</a>
          <a href="#/fraud">Fraud নম্বর</a>
          <a href="#/track">Track</a>
          {profile && (profile.role === 'moderator' || profile.role === 'admin') && <a href="#/moderation">Review queue</a>}
        </div>
        <div className="user-menu">
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
