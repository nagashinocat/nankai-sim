import './style.css';
import fragility from '../data/fragility.json';
import { useFragilityTable } from '../core/fragility.ts';
import { latLonToMesh250, meshCenter, meshesWithin } from '../core/mesh.ts';
import { WALK_SPEED, nearestShelters } from '../core/evacuation.ts';
import type { HomeInput, LatLon } from '../core/types.ts';
import { homeArrival } from './arrival.ts';
import { TSUNAMI_TILE_ZOOM, canvasPixelReader, tsunamiAround, tsunamiAt } from './tsunami-tile.ts';
import { createDataSource, type Manifest } from './data.ts';
import { searchAddress } from './geocode.ts';
import { computeScenario, createLatestOnly, createScenarioRunner, type Scenario, type ScenarioContext, type ScenarioResult } from './scenario.ts';
import { evacuationViewModel, homeTsunamiVM, type EvacVM, locationNote, type LocationSource } from './viewmodel.ts';
import { DISCLAIMER, DISCLAIMER_DETAIL, clear, el } from './ui/dom.ts';
import { clearLast, loadLast, saveLast, savedShelters } from './storage.ts';
import { renderIntro } from './ui/intro.ts';
import { renderLast } from './ui/last.ts';
import { renderInput } from './ui/input.ts';
import { renderResult } from './ui/result.ts';
import { renderAbout } from './ui/about.ts';
import { renderPractice } from './ui/practice.ts';
import { FAMILY_ENTRY, flushFamily, renderFamily, type FamilyShelters } from './ui/family.ts';
import { isUrgentTsunami, type PracticeHome } from './practice/scenes.ts';
import { KIDS_TEXT, loadKids, saveKids } from './kids.ts';
import { modeToggle, renderFamilyKids } from './ui/kids.ts';
import type { ResultHandle } from './ui/result.ts';
import { HAZARD_ATTRIBUTION } from './text.ts';
import { KIDS_NEAR } from './kids.ts';
import { NEAR_TEXT } from './near.ts';
import { renderNear, type NearHandle } from './ui/near.ts';
import { headingIcon } from './ui/visuals.ts';
import { fetchShelterIndex, panelAutoEligible, renderOfflinePanel, type OfflinePanelDeps } from './ui/offline-panel.ts';
import { savedIndex } from './offline.ts';
import { saveDataOn, scheduleAutoSave } from './autosave.ts';
import { MOVE_TEXT, type MoveState, isMoved, movedNote, resetLabel, samePlace } from './movepin.ts';

useFragilityTable(fragility as never);

const fetcher = (url: string) => fetch(url);
const ds = createDataSource(fetcher, `${import.meta.env.BASE_URL}data`);
/** 避難場所のデータを端末に保存する欄（#near・結果画面のおとなの表示だけ。おうちの人の操作） */
const dataBaseUrl = (): string => new URL(`${import.meta.env.BASE_URL}data`, location.href).href;
/** 避難場所のデータの自動保存は、本番ビルドで Service Worker が使えるときだけ（電波なしで使うには SW が要る） */
const AUTO_SAVE = import.meta.env.PROD && 'serviceWorker' in navigator;
const offlineDeps = (): OfflinePanelDeps => ({
  base: dataBaseUrl(),
  store: localStore(),
  caches: typeof caches !== 'undefined' ? caches : null,
  fetch: (url, init) => fetch(url, init),
  online: () => navigator.onLine,
  auto: AUTO_SAVE,
  saveData: () => saveDataOn(),
  locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
});
const offlinePanel = (): HTMLElement | null => renderOfflinePanel(offlineDeps());
const tileReader = canvasPixelReader();
/** 周辺1kmの各マス中心の津波は、タイル数を抑えるため2段階粗いズーム（約1.2km四方のタイル）で読む。 */
const AREA_TSUNAMI_ZOOM = TSUNAMI_TILE_ZOOM - 2;

const app = document.getElementById('app')!;
const inputRoot = el('div', { id: 'input' });
const resultRoot = el('div', { id: 'result', 'aria-live': 'polite' });
const aboutRoot = el('div', { id: 'about', hidden: true });
const practiceRoot = el('div', { id: 'practice', hidden: true });
const familyRoot = el('div', { id: 'family', hidden: true });
const nearRoot = el('div', { id: 'near', hidden: true });
const kidsInputNote = el('p', { class: 'kid-input-note', id: 'kids-input-note', hidden: true }, KIDS_TEXT.inputNote);
/** 入力画面の上の大きなボタン「📍 いまいる場所から近い避難場所」 */
const nearEntry = el('a', { href: '#near', class: 'btn-link near-entry', id: 'near-entry' });
/** 1ページ目のサイト説明と「住所の扱い」 */
const introRoot = el('div', { id: 'intro' });
const mainView = el('div', { id: 'main-view' }, introRoot, nearEntry, kidsInputNote, inputRoot, resultRoot);

// ---- こども / おとな（表示だけ。計算・保存・共有の文面は同じ）------------------------
let kids = loadKids(localStore());
let resultHandle: ResultHandle | null = null;
const toggle = modeToggle(kids, (on) => setKids(on));
const titleNode = el('h1', {});
const headerNote = el('div', { class: 'disclaimer', id: 'header-disclaimer' });
function drawHeader(): void {
  document.body.classList.toggle('kids', kids);
  toggle.set(kids);
  titleNode.textContent = kids ? KIDS_TEXT.title : '南海トラフ 住まいの被害シミュレーター';
  headerNote.replaceChildren(...(kids ? [el('strong', {}, KIDS_TEXT.disclaimer)] : [el('strong', {}, DISCLAIMER), el('p', {}, DISCLAIMER_DETAIL)]));
  kidsInputNote.hidden = !kids;
  drawIntro();
  nearEntry.replaceChildren(headingIcon('📍'), kids ? KIDS_NEAR.entry : NEAR_TEXT.entry);
}
function setKids(on: boolean): void {
  if (on === kids) return;
  kids = on;
  saveKids(localStore(), on);
  drawHeader();
  // 切り替えで結果の全体を読み上げなおさない（描きなおす間だけ aria-live を止める）
  resultRoot.setAttribute('aria-live', 'off');
  resultHandle?.setKids(on);
  setTimeout(() => resultRoot.setAttribute('aria-live', 'polite'), 500);
  if (location.hash === '#family') void showRoute();
  nearHandle?.setKids(on);
  drawOffline();
}
drawHeader();

// ---- 電波なしの帯 ----
const offlineBar = el('div', { class: 'offline-bar', id: 'offline-bar', role: 'status', hidden: true });
function drawOffline(): void {
  const off = !navigator.onLine;
  offlineBar.hidden = !off;
  offlineBar.replaceChildren(...(off ? [kids ? KIDS_NEAR.offline : '電波がありません。近い避難場所（保存済みなら）・前回の結果・家族の決まりは見られます'] : []));
}
window.addEventListener('online', drawOffline);
window.addEventListener('offline', drawOffline);

app.append(
  offlineBar,
  el('header', {}, el('div', { class: 'header-top' }, titleNode, toggle.node), headerNote),
  mainView, aboutRoot, practiceRoot, familyRoot, nearRoot,
  el('footer', {},
    el('p', {}, el('a', { href: '#near', id: 'near-footer-link' }, `📍 ${NEAR_TEXT.entry}`)),
    el('p', { class: 'hint', id: 'hazard-attribution' }, HAZARD_ATTRIBUTION),
    el('p', {}, el('a', { href: '#about' }, 'このアプリについて（計算方法・出典・プライバシー）')),
    el('p', {}, el('a', { href: '#family', id: 'family-footer-link' }, FAMILY_ENTRY))),
);

// ---- 前回の結果（端末内 localStorage のみ。住所・座標は保存しない）-----------------
const lastRoot = el('div', { id: 'last' });
mainView.insertBefore(lastRoot, resultRoot);

function localStore(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function drawIntro(): void {
  const st = localStore();
  let hasLast = false;
  try { hasLast = !!(st && loadLast(st)); } catch { hasLast = false; }
  renderIntro(introRoot, { compact: hasLast, kids });
}

function showLast(): void {
  drawIntro();
  const st = localStore();
  try {
    const saved = st ? loadLast(st) : null;
    if (!st || !saved) { clear(lastRoot); return; }
    renderLast(lastRoot, saved, { online: navigator.onLine, onDelete: () => { clearLast(st); clear(lastRoot); drawIntro(); } });
  } catch {
    // 保存値が壊れていてもアプリは起動する。壊れた値は捨てる。
    if (st) clearLast(st);
    clear(lastRoot);
  }
}

function onResultShown(home: HomeInput, municipality: string | null, evac: EvacVM[], r: ScenarioResult): void {
  // 新しい結果が出たら「前回の結果」は下げる。結果が出たとき（自宅が ok）だけ保存する（範囲外・データなし・読み込み失敗は保存しない）。
  // 選んでいるタブの結果を保存する（タブを替えるたびに、表示中のタブの結果に置き換わる）。
  // 住所・座標・「〜付近で計算しました」は保存しない。避難場所は名前と距離・徒歩の文字列だけ。
  clear(lastRoot);
  const st = localStore();
  if (!st || r.home.status !== 'ok') return;
  saveLast({
    v: 4, scenario: r.scenario, savedAt: new Date().toISOString(), municipality, input: home,
    home: r.home, area: r.area, shelters: savedShelters(evac),
  }, st);
}
// --------------------------------------------------------------------------

/** 市町名。自宅のマスに建物データが無い（山林など）ときは、半径500m内のマスで最も多い市町名。 */
async function municipalityAround(pos: LatLon, mesh: string): Promise<string | null> {
  const own = await ds.municipalityOf(mesh);
  if (own) return own;
  const counts = new Map<string, number>();
  for (const m of meshesWithin(pos, 500)) {
    const n = await ds.municipalityOf(m);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // 同数（多数が決まらない）ときは誤った市町名を出さず、名前なしにする。
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0][1] === ranked[1][1])) return null;
  return ranked[0][0];
}

const runner = createScenarioRunner(ds);
/** 画面に出している結果の津波の状況（練習モードの一言用）。住所・座標は持たない。結果が無ければ null。 */
let practiceHome: PracticeHome | null = null;
/** 家族の決まりで選べる近くの避難場所（名前と徒歩の目安だけ。座標・住所は持たない）。結果が無ければ null。 */
let familyShelters: FamilyShelters | null = null;

/** 1か所ぶんの計算に使う値（画面に出す前。副作用なし）。 */
type Prepared = Awaited<ReturnType<typeof prepare>>;

async function prepare(pos: LatLon, home: HomeInput) {
  const mesh = latLonToMesh250(pos);
  await ds.hazardCell('L2', mesh); // 先に読み込みの失敗を出す（computeScenario が同じ値を使う）
  const meshes = meshesWithin(pos, 1000);
  const [stock, municipality, shelters, homeTsunami] = await Promise.all([
    ds.stockFor(meshes), municipalityAround(pos, mesh), ds.sheltersNear(pos, 5000),
    tsunamiAround(pos, tileReader), // 中心が浸水域外なら約50mの8方向も見る（Ruling F3）
  ]);
  // 推測した市町名（municipality）は表示用。到達時間は自宅のマス自身の市町村だけから引く。
  const arrival = await homeArrival(ds, mesh);
  // 周辺: 各マス中心の浸水深の段階の代表値（浸水域外は0、判定できないマスは津波なし）。シナリオ間で同じ値を使い回す。
  const depths = new Map<string, Promise<number | null>>();
  const ctx: ScenarioContext = {
    mesh, meshes, input: home, homeTsunami, arrival, stock,
    areaTsunamiDepth: (m) => {
      let p = depths.get(m);
      if (!p) {
        p = tsunamiAt(meshCenter(m), tileReader, AREA_TSUNAMI_ZOOM).then((t) => (t === 'unknown' ? null : t === 'none' ? 0 : t.mid));
        depths.set(m, p);
      }
      return p;
    },
  };
  const l2 = await computeScenario(ds, ctx, 'L2');
  const evac = evacuationViewModel(pos, shelters, arrival);
  const evacShelters = evac.map((e) =>
    nearestShelters(pos, shelters, { hazard: e.hazard, speedMps: WALK_SPEED.standard, limit: 5 }).map((h) => h.shelter),
  );
  return { pos, home, municipality, homeTsunami, arrival, ctx, l2, evac, evacShelters };
}

/**
 * 1回の「調べる」（住所・現在地・地図・ピンを動かす・もどす）ごとの世代。新しい調べが始まったら、
 * 古い計算の結果（と失敗）は捨てる（あとから画面を上書きしない）。
 */
const runs = createLatestOnly();
/** ピンを動かす前の地点（住所の位置など）と、いま計算している地点。メモリだけ（保存・URL・共有文に入れない）。 */
let moveState: MoveState | null = null;

/** 画面の前の結果を片付ける（タブの計算・練習モード・家族の決まりの値も、前の場所のものを残さない）。 */
function dropResult(): void {
  runner.invalidate(); // 前の場所のタブの計算が、あとから新しい結果に混ざらないように
  resultHandle?.dispose();
  resultHandle = null;
  practiceHome = null;
  familyShelters = null;
  resultRoot.inert = false;
  resultRoot.removeAttribute('aria-busy');
}

/** 住所・現在地・地図で選んだ所から新しく調べる。ピンを動かした状態はリセットする。 */
async function run(pos: LatLon, home: HomeInput, where: LocationSource): Promise<void> {
  moveState = null;
  dropResult();
  clear(resultRoot); // 読み込みに失敗したとき、前の場所の結果を残さない
  const p = await runs.run(() => prepare(pos, home));
  if (!p) return; // あとから始めた調べに追い越された
  moveState = { origin: pos, originWhere: where, home, current: pos };
  render(p, moveState, 'L2', 'top');
}

/** 「ここで調べ直す」「住所の位置にもどす」: 建物の入力はそのまま、地点だけ変えて全体を計算し直す。 */
async function rerun(pos: LatLon): Promise<void> {
  const ms = moveState;
  const handle = resultHandle;
  if (!ms || !handle) return;
  const scenario = handle.scenario(); // 選んでいたタブ（地図の 揺れ/津波/両方 は riskpanel が覚えている）
  // 計算中は前の結果を残したまま触れないようにする（タブ・ボタンを押しても古い場所の計算を始めない）。
  // 進行中のタブの計算は止めない（失敗して元の地点のままになったとき、そのタブが「読み込んでいます」で止まらないように）。
  // 新しい結果を出す前に dropResult で無効にするので、あとから新しい結果を上書きしない。
  handle.beginMove();
  resultRoot.inert = true;
  resultRoot.setAttribute('aria-busy', 'true');
  let p: Prepared | null;
  try {
    p = await runs.run(() => prepare(pos, ms.home));
  } catch (e) {
    // 最新の調べの失敗だけここに来る。結果は元の地点のまま
    if (resultHandle === handle) {
      resultRoot.inert = false;
      resultRoot.removeAttribute('aria-busy');
      handle.moveFailed(`${MOVE_TEXT.failed}（${(e as Error).message}）`);
    }
    return;
  }
  if (!p || moveState !== ms || resultHandle !== handle) return; // 追い越された・住所を入れ直した
  const next: MoveState = { ...ms, current: pos };
  moveState = next;
  dropResult();
  render(p, next, scenario, 'map');
}

function render(p: Prepared, ms: MoveState, scenario: Scenario, focus: 'top' | 'map'): void {
  const { pos, home, municipality, homeTsunami, arrival, ctx, l2, evac, evacShelters } = p;
  // タブの結果は場所ごとに覚えておく（読み込めなかったものは覚えず、「もう一度読み込む」で再試行）
  const cache = new Map<Scenario, ScenarioResult>([['L2', l2]]);
  runner.invalidate();
  const show = async (sc: Scenario): Promise<void> => {
    const hit = cache.get(sc);
    if (hit) { runner.invalidate(); handle.showResult(hit); return; }
    handle.showLoading(sc);
    let r: ScenarioResult | null;
    try {
      r = await runner.request(ctx, sc);
    } catch {
      r = { scenario: sc, home: { status: 'error' }, area: { status: 'unavailable' }, meshRates: ctx.meshes.map((m) => ({ mesh: m, rate: null })) };
    }
    if (!r) return; // 後から選ばれたタブ・別の場所の要求に追い越された
    if (r.home.status !== 'error') cache.set(sc, r);
    handle.showResult(r);
  };
  // 練習モードの一言は、結果を画面に出す直前にだけ決める（途中で失敗したときは前の結果の値を残さない）
  const tsunamiVM = homeTsunamiVM(homeTsunami, arrival);
  practiceHome = {
    urgentTsunami: isUrgentTsunami(tsunamiVM.kind, arrival?.min ?? null),
    tsunamiUnknown: tsunamiVM.kind === 'unknown',
  };
  const walkList = (h: 'earthquake' | 'tsunami') => (evac.find((e) => e.hazard === h)?.items ?? []).slice(0, 5).map((i) => ({ name: i.name, walk: i.walkStandard }));
  familyShelters = { tsunami: walkList('tsunami'), quake: walkList('earthquake') };
  const moved = isMoved(ms);
  let handle: ReturnType<typeof renderResult>;
  try {
  handle = renderResult(resultRoot, {
    pos, municipality, result: l2, evac, evacShelters,
    locationNote: moved ? movedNote(ms.origin, ms.current, ms.originWhere) : locationNote(ms.originWhere),
    tsunami: tsunamiVM, kids, offlinePanel,
    moved: moved ? { reset: resetLabel(ms.originWhere) } : null,
    focus,
  }, {
    onSelect: (s) => void show(s),
    onRetry: (s) => void show(s),
    onShown: (r) => onResultShown(home, municipality, evac, r),
    onAdult: () => setKids(false),
    onMove: (to) => { if (!samePlace(to, ms.current)) void rerun(to); }, // 十字を動かしていなければ何もしない
    onReset: () => void rerun(ms.origin),
  });
  resultHandle = handle;
  } catch (e) { practiceHome = null; familyShelters = null; throw e; }
  if (scenario !== 'L2') void show(scenario);
}

const view = renderInput(inputRoot, {
  onSearch: (q, home) => guarded(async () => {
    const list = await searchAddress(q, fetcher);
    if (list.length === 0) { view.showPinPicker(); return; }
    if (list.length === 1) { view.clearExtras(); await run(list[0].pos, home, { kind: 'address', label: list[0].label }); return; }
    view.showCandidates(list); // 先頭を勝手に使わない
  }),
  onLocate: (home) => guarded(async () => {
    const pos = await new Promise<LatLon>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new UserError('この端末では現在地を使えません。住所を入力してください。'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (err) => reject(new UserError(err.code === err.PERMISSION_DENIED ? '現在地の利用が許可されていません。住所を入力してください。' : '現在地を取得できませんでした。住所を入力してください。')),
        { timeout: 15000 },
      );
    });
    view.clearExtras();
    await run(pos, home, { kind: 'gps' });
  }),
  onPick: (pos, home, label) => guarded(async () => {
    view.clearExtras();
    await run(pos, home, label !== undefined ? { kind: 'address', label } : { kind: 'pin' });
  }),
});

/** そのまま画面に出してよい（通信の案内を付けない）エラー。 */
class UserError extends Error {}

async function guarded(fn: () => Promise<void>): Promise<void> {
  view.setBusy(true);
  view.message('調べています…');
  try {
    await fn();
    view.message(null);
  } catch (e) {
    if (e instanceof UserError) view.message(e.message);
    // 読み込み失敗（想定データ・通信）は結果を出さず、再試行ボタンを出す。
    else view.message(`うまく調べられませんでした（${(e as Error).message}）。通信状況を確認して、もう一度お試しください。`, () => void guarded(fn));
  } finally {
    view.setBusy(false);
  }
}

// ---- #near（いまいる場所から近い避難場所）。現在地はこの画面のメモリだけ。離れたら捨てる ----
let nearHandle: NearHandle | null = null;
function showNear(): void {
  nearHandle?.dispose();
  nearHandle = renderNear(nearRoot, {
    kids,
    geolocation: navigator.geolocation,
    sheltersNear: (pos, r) => ds.sheltersNear(pos, r),
    tsunami: (pos) => tsunamiAround(pos, tileReader),
    online: () => navigator.onLine,
    onAdult: () => setKids(false),
    onExit: () => { location.hash = ''; },
    savePanel: offlinePanel,
    covers: (pos) => ds.covers('L2', latLonToMesh250(pos)),
    isSaved: async () => typeof caches !== 'undefined' && (await savedIndex(caches, dataBaseUrl())) !== null,
    autoSave: () => panelAutoEligible(offlineDeps()),
  });
}

async function showRoute(): Promise<void> {
  const privacy = location.hash === '#privacy';
  const about = location.hash === '#about' || privacy;
  const practice = location.hash === '#practice';
  const family = location.hash === '#family';
  const near = location.hash === '#near';
  if (!family) { flushFamily(); document.body.classList.remove('family-printing'); }
  if (!near && nearHandle) { nearHandle.dispose(); nearHandle = null; }
  mainView.hidden = about || practice || family || near;
  aboutRoot.hidden = !about;
  practiceRoot.hidden = !practice;
  familyRoot.hidden = !family;
  nearRoot.hidden = !near;
  if (near) {
    if (!nearHandle) showNear();
    window.scrollTo(0, 0);
    return;
  }
  if (family) {
    if (kids) {
      flushFamily();
      renderFamilyKids(familyRoot, { store: localStore(), onAdult: () => setKids(false), onExit: () => { location.hash = ''; } });
    } else {
      renderFamily(familyRoot, { store: localStore(), shelters: familyShelters, onExit: () => { location.hash = ''; } });
    }
    window.scrollTo(0, 0);
    return;
  }
  if (practice) {
    renderPractice(practiceRoot, { home: practiceHome, onExit: () => { location.hash = ''; } });
    return;
  }
  if (about) {
    let m: Manifest | null = null;
    try { m = await ds.manifest(); } catch { /* 出典一覧なしで表示 */ }
    renderAbout(aboutRoot, m);
    const sec = privacy ? document.getElementById('privacy') : null;
    if (sec) sec.scrollIntoView(); else window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', showRoute);
showLast();
drawOffline();

// Service Worker は本番ビルドのみ（開発サーバーでキャッシュが邪魔をしないように）。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* 登録できなくても動く */ }); });
}
// 電波があれば、表示が落ち着いてから避難場所のデータを裏で保存（失敗しても画面には出さない。次に開いたとき続きから）
if (AUTO_SAVE) {
  const d = offlineDeps();
  scheduleAutoSave({
    ...d,
    saveData: () => saveDataOn(),
    fetchIndex: () => fetchShelterIndex(d),
    // 自動保存では、確認の画面が出るブラウザ（Firefox など）で勝手に聞かないよう、聞かずに済むときだけ頼む
    persist: async () => {
      try {
        const st = await navigator.permissions?.query({ name: 'persistent-storage' as PermissionName });
        if (st && st.state === 'prompt') return false;
      } catch { /* 調べられなければ頼まない */ return false; }
      return navigator.storage?.persist?.();
    },
    events: window,
  });
}
void showRoute();
