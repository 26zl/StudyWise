/* global self */

const NOTIFICATIONS_URL = "/dashboard?view=varslinger";

function getSafeNotificationUrl(candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return NOTIFICATIONS_URL;
  }

  try {
    const parsed = new URL(candidate, self.location.origin);
    if (parsed.origin !== self.location.origin) {
      return NOTIFICATIONS_URL;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NOTIFICATIONS_URL;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return NOTIFICATIONS_URL;
  }
}

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "StudyWise",
      body: event.data.text(),
    };
  }

  const title = payload.title || "StudyWise";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192x192.png",
    badge: payload.badge || "/icons/icon-192x192.png",
    tag: payload.tag || "studywise-notification",
    data: {
      url: getSafeNotificationUrl(payload.url),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = getSafeNotificationUrl(event.notification.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
