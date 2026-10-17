import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { fetchProfile, saveProfile, registerPushToken, type AppProfile } from './api';
import { supabase } from './supabaseClient';
import { getPushToken } from './lib/push';
import { AmbassadorBadge } from './growth';

export interface AuthState {
  session: Session | null;
  profile: AppProfile | null;
  loading: boolean;
  profileLoading: boolean;
  refreshProfile: () => Promise<AppProfile | null>;
  signOut: () => Promise<void>;
}

const PROFILE_CACHE_KEY = 'prohori-profile-cache';

function loadCachedProfile(): AppProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && typeof (parsed as AppProfile).id === 'string'
      ? (parsed as AppProfile)
      : null;
  } catch {
    return null;
  }
}

function saveCachedProfile(profile: AppProfile | null): void {
  try {
    if (profile) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // Storage full or blocked — the in-memory profile still works.
  }
}

export function useAuthState(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  // Stale-while-revalidate: start from the cached profile so a returning
  // user never stares at the "যাচাই হচ্ছে" gate while the API cold-starts.
  const [profile, setProfile] = useState<AppProfile | null>(() => loadCachedProfile());
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const handledTokenRef = useRef<string | null>(null);
  const pushRegisteredForRef = useRef<string | null>(null);

  // Register the FCM device token once per session (best-effort, never blocks).
  const maybeRegisterPush = (sess: Session) => {
    const key = sess.access_token;
    if (pushRegisteredForRef.current === key) return;
    pushRegisteredForRef.current = key;
    void (async () => {
      try {
        const token = await getPushToken();
        if (token) await registerPushToken(token);
      } catch {
        /* push is optional — ignore failures */
      }
    })();
  };

  // Fetch the profile from the API. On success the result is cached; on
  // failure the currently shown (cached) profile is KEPT — a slow or cold
  // backend must never wipe the session UI back to a loading gate.
  const runRefresh = async (sess: Session, silent: boolean): Promise<AppProfile | null> => {
    if (!silent) setProfileLoading(true);
    try {
      const response = await fetchProfile();
      setProfile(response.profile);
      saveCachedProfile(response.profile);
      if (response.profile) maybeRegisterPush(sess);
      return response.profile;
    } catch {
      const fallback = loadCachedProfile();
      setProfile((prev) => prev ?? fallback);
      return fallback;
    } finally {
      if (!silent) setProfileLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const applySession = (nextSession: Session | null) => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (!nextSession) {
        handledTokenRef.current = null;
        pushRegisteredForRef.current = null;
        setProfile(null);
        setProfileLoading(false);
        saveCachedProfile(null);
        return;
      }
      // onAuthStateChange fires INITIAL_SESSION and getSession() resolves
      // right after — handle each access token only once.
      if (nextSession.access_token === handledTokenRef.current) return;
      handledTokenRef.current = nextSession.access_token;
      if (loadCachedProfile()) {
        // Returning user: show the cached profile instantly, no gate;
        // revalidate quietly in the background.
        setProfile((prev) => prev ?? loadCachedProfile());
        setProfileLoading(false);
        void runRefresh(nextSession, true);
      } else {
        // First login (or cleared storage): the gate is honest here.
        setProfileLoading(true);
        void runRefresh(nextSession, false);
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) applySession(nextSession);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        applySession(data.session);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // runRefresh only uses setState + module-level helpers, so it is
    // stable across renders; the effect intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshProfile = async (): Promise<AppProfile | null> => {
    const sess = sessionRef.current;
    if (!sess) {
      setProfile(null);
      setProfileLoading(false);
      return null;
    }
    return runRefresh(sess, false);
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      sessionRef.current = null;
      handledTokenRef.current = null;
      setProfile(null);
      setProfileLoading(false);
      saveCachedProfile(null);
    }
  };

  return { session, profile, loading, profileLoading, refreshProfile, signOut };
}

interface LoginPageProps {
  onSuccess?: () => void;
}

export function LoginPage(_props: LoginPageProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name.trim(), phone: phone.trim() },
          },
        });
        if (authError) throw authError;
        if (data.session) {
          setNotice('Account তৈরি হয়েছে। এখন profile সম্পূর্ণ করুন।');
        } else {
          setNotice('আপনার email-এ verification link পাঠানো হয়েছে। Link-এ চাপ দিয়ে আবার এই site-এ ফিরুন।');
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (authError) throw authError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google দিয়ে sign in করা যায়নি।');
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <a className="back-arrow" href="#/" aria-label="ফিরে যাও" style={{ marginBottom: '12px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </a>
        <div className="brand-mark">প্রহরী</div>
        <p className="auth-subtitle">জনতার চোখ — অপরাধ দেখলে চুপ নয়</p>
        <h1>{mode === 'signin' ? 'আপনার account-এ ঢুকুন' : 'Prohori account খুলুন'}</h1>
        <button className="google-btn" type="button" onClick={signInWithGoogle} disabled={busy}>
          <span className="google-g">G</span> Google দিয়ে চালিয়ে যান
        </button>
        <div className="auth-divider"><span>অথবা email দিয়ে</span></div>
        <form onSubmit={submit} className="stack-form">
          {mode === 'signup' && (
            <>
              <label>নাম<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
              <label>মোবাইল নম্বর<input required minLength={6} maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="যেমন: 01XXXXXXXXX" /></label>
            </>
          )}
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="form-notice" role="status">{notice}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? 'অপেক্ষা করুন…' : mode === 'signin' ? 'Email দিয়ে login' : 'Account তৈরি করুন'}
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'signin' ? 'নতুন account লাগবে?' : 'আগে থেকেই account আছে?'}{' '}
          <button type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setNotice(''); }}>
            {mode === 'signin' ? 'Sign up' : 'Login'}
          </button>
        </p>
        <div className="auth-divider"><span>অথবা</span></div>
        <div className="amb-card">
          <span className="amb-cap"><AmbassadorBadge level="university" size={52} /></span>
          <h3>অগ্রদূত হিসেবে join করো</h3>
          <p>ক্যাম্পাস অগ্রদূত হও — badge পাও,<br />নিজের team lead করো</p>
          <a className="gold-btn" href="#/campus/apply">অগ্রদূত হও →</a>
        </div>
        <p className="auth-privacy">আপনার account দিয়ে report করা যাবে। Anonymous report-এ পরিচয় public-এ দেখানো হবে না।</p>
      </section>
    </main>
  );
}

interface ProfileSetupProps {
  user: User;
  onComplete: (profile: AppProfile) => void;
}

export function ProfileSetupPage({ user, onComplete }: ProfileSetupProps) {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name ?? '';
  const metadataPhone = user.user_metadata.phone ?? user.phone ?? '';
  const [name, setName] = useState(typeof metadataName === 'string' ? metadataName : '');
  const [phone, setPhone] = useState(typeof metadataPhone === 'string' ? metadataPhone : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await saveProfile(name.trim(), phone.trim());
      onComplete(response.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile save করা যায়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">প্রহরী</div>
        <h1>Profile সম্পূর্ণ করুন</h1>
        <p className="meta">{user.email ?? 'Google account'} দিয়ে sign in হয়েছে। জরুরি যোগাযোগ ও নিরাপদ team ব্যবহারের জন্য নিচের তথ্য দিন।</p>
        <form onSubmit={submit} className="stack-form">
          <label>আপনার নাম<input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label>মোবাইল নম্বর<input required minLength={6} maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" placeholder="যেমন: 01XXXXXXXXX" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'Profile সংরক্ষণ করুন'}</button>
        </form>
        <button className="text-btn" type="button" onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </section>
    </main>
  );
}