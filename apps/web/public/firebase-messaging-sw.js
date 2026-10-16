/* Firebase Cloud Messaging service worker — background push handler.
 * Plain JS (not bundled). Firebase config arrives via the registration URL's
 * query string (set in src/lib/push.ts). These are public web keys.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

(function init() {
  try {
    const q = new URL(self.location.href).searchParams;
    const config = {
      apiKey: q.get('apiKey') || '',
      authDomain: q.get('authDomain') || '',
      projectId: q.get('projectId') || '',
      messagingSenderId: q.get('messagingSenderId') || '',
      appId: q.get('appId') || '',
    };
    if (!config.apiKey || !config.projectId) return;
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const n = payload.notification || {};
      const title = n.title || 'প্রহরী';
      const body = n.body || '';
      const data = payload.data || {};
      self.registration.showNotification(title, {
        body,
        icon: '/prohori-logo.webp',
        badge: '/prohori-logo.webp',
        data,
        tag: data.sos_id ? `sos-${data.sos_id}` : undefined,
        renotify: true,
      });
    });
  } catch (e) {
    // Push stays disabled; the page works fine without it.
  }
})();

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const url = data.sos_id ? '/#/sos' : '/#/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
