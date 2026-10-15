import { useEffect, useState, type FormEvent } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { fetchProfile, saveProfile, type AppProfile } from './api';
import { supabase } from './supabaseClient';

export interface AuthState {
  session: Session | null;
  profile: AppProfile | null;
  loading: boolean;
  profileLoading: boolean;
  refreshProfile: () => Promise<AppProfile | null>;
  signOut: () => Promise<void>;
}

export function useAuthState(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        setProfileLoading(!!nextSession);
        setSession(nextSession);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setProfileLoading(!!data.session);
        setSession(data.session);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = async (): Promise<AppProfile | null> => {
    if (!session) {
      setProfile(null);
      return null;
    }
    setProfileLoading(true);
    try {
      const response = await fetchProfile();
      setProfile(response.profile);
      return response.profile;
    } catch {
      setProfile(null);
      return null;
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    void refreshProfile();
    // The access token changes on refresh; re-fetch the profile with the new token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
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
