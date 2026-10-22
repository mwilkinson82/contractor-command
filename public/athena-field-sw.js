/* Athena field reminders. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Athena";
  const body = data.body || "Today's daily isn't in yet";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/brand/athena/athena-primary-512.png",
      badge: "/brand/athena/athena-primary-512.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(url));
});
