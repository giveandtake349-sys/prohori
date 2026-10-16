/**
 * Web push (FCM) client. Graceful: if any VITE_FIREBASE_* env var is missing,
 * push is silently disabled and every function below is a no-op.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';

let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let initAttempted = false;

/** Firebase config from env (public web keys — safe to expose). */
export function firebaseWebConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string | undefined;
  if (!apiKey || !authDomain || !projectId || !messagingSenderId || !appId) return null;
  return { apiKey, authDomain, projectId, messagingSenderId, appId };
}

/** True when push can work in this browser (config present + supported). */
export async function pushAvailable(): Promise<boolean> {
  if (initAttempted) return messaging !== null;
  initAttempted = true;
  try {
    const config = firebaseWebConfig();
    if (!config) return false;
    if (!(await isSupported())) return false;
    app = initializeApp(config);
    messaging = getMessaging(app);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask for notification permission, fetch the FCM registration token and
 * hand it to the caller for server registration. Returns null when push
 * is unavailable or the user declines.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    if (!(await pushAvailable()) || !messaging) return null;
    if (Notification.permission === 'denied') return null;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
    if (!vapidKey) return null;
    // The service worker must be registered for getToken() on web; the
    // Firebase web config travels in the registration URL query string.
    const config = firebaseWebConfig();
    const params = new URLSearchParams({
      apiKey: config?.apiKey ?? '',
      authDomain: config?.authDomain ?? '',
      projectId: config?.projectId ?? '',
      messagingSenderId: config?.messagingSenderId ?? '',
      appId: config?.appId ?? '',
    });
    const registration = await navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?${params.toString()}`,
    );
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch {
    return null;
  }
}

/** Current notification permission state (safe to call anytime). */
export function pushPermission(): NotificationPermission | 'unsupported' {
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}
