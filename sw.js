// Service Worker: アプリ本体をオフラインで開けるようにする。パスはすべて自分のスコープ基準（サブパス配備でも動く）。
// - install: スコープのルートと index.html、およびそれが参照する assets/* をキャッシュ
// - ページ移動（HTML）: ネットワーク優先、失敗したらキャッシュ（更新が反映される）。HTML 以外の応答は保存しない
// - assets/*（ハッシュ付き）: キャッシュ優先
// - data/*: ネットワーク優先、失敗したらキャッシュ（HTML や ok でない応答は保存しない）
// - data/shelters/*: ネットワークだけ（版つきキャッシュには入れない。現在地のまわりのファイルを勝手に残さない）
//   → 取れなければ、利用者が保存した専用キャッシュ（OFFLINE_SHELTERS）。
//   専用キャッシュに index.json（保存したファイルの一覧）があり、一覧に無いファイルなら 404（そこには避難場所が無い）
// - 専用キャッシュは名前の接頭辞が違う（nankai-offline-…）ので、activate で消さない。保存の要求（x-nankai-offline-save）には触らない
// - 別オリジン（地理院の地図タイル・住所検索）には触らない
// 下の BUILD_ID の値はビルド時に置き換わる（ビルドごとに sw.js が変わり、古いキャッシュは activate で削除）。
const BUILD_ID = 'ba18a4addc';
const CACHE = `nankai-sim-${BUILD_ID}`;
const SCOPE = self.registration.scope; // 末尾 '/' 付きの完全なURL
const SCOPE_PATH = new URL(SCOPE).pathname;
const INDEX = SCOPE + 'index.html';
const OFFLINE_SHELTERS = 'nankai-offline-shelters-v1'; // src/app/offline.ts の OFFLINE_CACHE と同じ
const SHELTERS_PATH = SCOPE_PATH + 'data/shelters/';

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

/** 避難場所: ネットワークだけ（保存しない）。取れなければ、利用者が保存した専用キャッシュ。 */
async function shelterFile(request) {
  try {
    return await fetch(request);
  } catch (e) {
    if (!(await caches.has(OFFLINE_SHELTERS))) throw e; // 開くと空のキャッシュができるので、先に有無を見る
    const saved = await caches.open(OFFLINE_SHELTERS);
    const url = new URL(request.url);
    url.search = '';
    const hit = await saved.match(url.href);
    if (hit) return hit;
    const index = await saved.match(new URL(SHELTERS_PATH + 'index.json', self.location.origin).href);
    if (index) {
      const list = await index.json().catch(() => null);
      const name = url.pathname.slice(SHELTERS_PATH.length);
      if (list && Array.isArray(list.files) && !list.files.includes(name)) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.get('x-nankai-offline-save')) return; // 保存の要求はそのままネットワークへ（版つきキャッシュに二重に持たない）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, INDEX));
  } else if (url.pathname.startsWith(SCOPE_PATH + 'assets/')) {
    event.respondWith(cacheFirst(req));
  } else if (url.pathname.startsWith(SHELTERS_PATH)) {
    event.respondWith(shelterFile(req));
  } else if (url.pathname.startsWith(SCOPE_PATH + 'data/')) {
    event.respondWith(networkFirst(req));
  }
});
