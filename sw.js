/* Service worker · Fiscalização de Obras
 * Ao publicar uma versão nova do app, troque o número abaixo para os celulares atualizarem. */
const VERSAO = 'v21';
const APP = 'fisc-app-' + VERSAO;
const IMGS = 'fisc-imgs';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'config.js', 'prmap.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('fisc-app-') && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // envios ao servidor: sempre pela rede
  const u = new URL(req.url);
  if (u.hostname.endsWith('script.google.com') || u.hostname.endsWith('script.googleusercontent.com')) return;
  // plantas e fotos do Drive: guarda no celular para abrir sem sinal
  if (u.hostname === 'drive.google.com' || u.hostname.endsWith('googleusercontent.com')) {
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r } catch (err) { return hit || Response.error() }
    }));
    return;
  }
  // arquivos do app: sempre tenta a versão mais nova; sem sinal, usa a guardada
  e.respondWith(caches.open(APP).then(async c => {
    try {
      const r = await fetch(req, { cache: 'no-cache' });
      if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
      return r;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: u.origin === location.origin });
      return hit || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
    }
  }));
});
