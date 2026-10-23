// Retired city app. Phones that installed it fetch this worker on their next visit: it clears the old
// offline copy, removes itself and sends open tabs to the statewide map.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('safewalk-lowell-') || k.startsWith('safewalk-shell-')).map(k => caches.delete(k)));
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('/ma/?town=Lowell');
})()));
