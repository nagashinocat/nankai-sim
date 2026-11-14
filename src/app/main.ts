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
import { computeScenario, createScenarioRunner, type Scenario, type ScenarioContext, type ScenarioResult } from './scenario.ts';
import { evacuationViewModel, homeTsunamiVM, type EvacVM, locationNote, type LocationSource } from './viewmodel.ts';
import { DISCLAIMER, DISCLAIMER_DETAIL, clear, el } from './ui/dom.ts';
import { clearLast, loadLast, saveLast, savedShelters } from './storage.ts';
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

useFragilityTable(fragility as never);

const fetcher = (url: string) => fetch(url);
const ds = createDataSource(fetcher, `${import.meta.env.BASE_URL}data`);
const tileReader = canvasPixelReader();
/** 周辺1kmの各マス中心の津波は、タイル数を抑えるため2段階粗いズーム（約1.2km四方のタイル）で読む。 */
const AREA_TSUNAMI_ZOOM = TSUNAMI_TILE_ZOOM - 2;

const app = document.getElementById('app')!;
const inputRoot = el('div', { id: 'input' });
const resultRoot = el('div', { id: 'result', 'aria-live': 'polite' });
const aboutRoot = el('div', { id: 'about', hidden: true });
const practiceRoot = el('div', { id: 'practice', hidden: true });
const familyRoot = el('div', { id: 'family', hidden: true });
const kidsInputNote = el('p', { class: 'kid-input-note', id: 'kids-input-note', hidden: true }, KIDS_TEXT.inputNote);
const mainView = el('div', { id: 'main-view' }, kidsInputNote, inputRoot, resultRoot);

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
}
drawHeader();

app.append(
  el('header', {}, el('div', { class: 'header-top' }, titleNode, toggle.node), headerNote),
  mainView, aboutRoot, practiceRoot, familyRoot,
  el('footer', {},
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

function showLast(): void {
  const st = localStore();
  try {
    const saved = st ? loadLast(st) : null;
    if (!st || !saved) { clear(lastRoot); return; }
    renderLast(lastRoot, saved, { online: navigator.onLine, onDelete: () => { clearLast(st); clear(lastRoot); } });
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

async function run(pos: LatLon, home: HomeInput, where: LocationSource): Promise<void> {
  runner.invalidate(); // 前の場所のタブの計算が、あとから新しい結果に混ざらないように
  practiceHome = null;
  resultHandle = null;
  familyShelters = null;
  clear(resultRoot); // 読み込みに失敗したとき、前の場所の結果を残さない
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
  // タブの結果は場所ごとに覚えておく（読み込めなかったものは覚えず、「もう一度読み込む」で再試行）
  const cache = new Map<Scenario, ScenarioResult>([['L2', l2]]);
  runner.invalidate();
  const show = async (scenario: Scenario): Promise<void> => {
    const hit = cache.get(scenario);
    if (hit) { runner.invalidate(); handle.showResult(hit); return; }
    handle.showLoading(scenario);
    let r: ScenarioResult | null;
    try {
      r = await runner.request(ctx, scenario);
    } catch {
      r = { scenario, home: { status: 'error' }, area: { status: 'unavailable' }, meshRates: ctx.meshes.map((m) => ({ mesh: m, rate: null })) };
    }
    if (!r) return; // 後から選ばれたタブ・別の場所の要求に追い越された
    if (r.home.status !== 'error') cache.set(scenario, r);
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
  let handle: ReturnType<typeof renderResult>;
  try {
  handle = renderResult(resultRoot, {
    pos, municipality, result: l2, evac, evacShelters, locationNote: locationNote(where), tsunami: homeTsunamiVM(homeTsunami, arrival), kids,
  }, {
    onSelect: (s) => void show(s),
    onRetry: (s) => void show(s),
    onShown: (r) => onResultShown(home, municipality, evac, r),
    onAdult: () => setKids(false),
  });
  resultHandle = handle;
  } catch (e) { practiceHome = null; familyShelters = null; throw e; }
  void handle;
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

async function showRoute(): Promise<void> {
  const about = location.hash === '#about';
  const practice = location.hash === '#practice';
  const family = location.hash === '#family';
  if (!family) { flushFamily(); document.body.classList.remove('family-printing'); }
  mainView.hidden = about || practice || family;
  aboutRoot.hidden = !about;
  practiceRoot.hidden = !practice;
  familyRoot.hidden = !family;
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
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', showRoute);
showLast();

// Service Worker は本番ビルドのみ（開発サーバーでキャッシュが邪魔をしないように）。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* 登録できなくても動く */ }); });
}
void showRoute();
