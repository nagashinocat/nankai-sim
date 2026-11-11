// Service Worker: アプリ本体をオフラインで開けるようにする。パスはすべて自分のスコープ基準（サブパス配備でも動く）。
// - install: スコープのルートと index.html、およびそれが参照する assets/* をキャッシュ
// - ページ移動（HTML）: ネットワーク優先、失敗したらキャッシュ（更新が反映される）。HTML 以外の応答は保存しない
// - assets/*（ハッシュ付き）: キャッシュ優先
// - data/*: ネットワーク優先、失敗したらキャッシュ（HTML や ok でない応答は保存しない）
// - 別オリジン（地理院の地図タイル・住所検索）には触らない
// 下の BUILD_ID の値はビルド時に置き換わる（ビルドごとに sw.js が変わり、古いキャッシュは activate で削除）。
const BUILD_ID = '__BUILD_ID__';
const CACHE = `nankai-sim-${BUILD_ID}`;
const SCOPE = self.registration.scope; // 末尾 '/' 付きの完全なURL
const SCOPE_PATH = new URL(SCOPE).pathname;
const INDEX = SCOPE + 'index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch(SCOPE, { cache: 'reload' });
    if (!res.ok) throw new Error(`install: HTTP ${res.status}`); // 失敗したらインストールしない
    const html = await res.clone().text();
    await cache.put(SCOPE, res.clone());
    await cache.put(INDEX, res);
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href))];
    await Promise.all(assets.map((a) => cache.add(a)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('nankai-sim-') && k !== CACHE) await caches.delete(k); // 同じオリジンの他アプリのキャッシュは消さない
    await self.clients.claim();
  })());
});

async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    const type = res.headers.get('content-type') || '';
    // ページ移動（key = INDEX）は HTML のときだけアプリ本体として保存する（data/*.json を開いても本体を上書きしない）。
    // data/* は HTML（SPA フォールバック）を保存しない。
    const isHtml = type.includes('text/html');
    if (res.ok && (key !== undefined ? isHtml : !isHtml)) await cache.put(key ?? request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key ?? request);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, INDEX));
  } else if (url.pathname.startsWith(SCOPE_PATH + 'assets/')) {
    event.respondWith(cacheFirst(req));
  } else if (url.pathname.startsWith(SCOPE_PATH + 'data/')) {
    event.respondWith(networkFirst(req));
  }
});
