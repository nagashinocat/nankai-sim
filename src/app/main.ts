import './style.css';
import fragility from '../data/fragility.json';
import { useFragilityTable } from '../core/fragility.ts';
import { latLonToMesh250, meshCenter, meshesWithin } from '../core/mesh.ts';
import { meshCollapseRate } from '../core/neighborhood.ts';
import { WALK_SPEED, nearestShelters } from '../core/evacuation.ts';
import type { HazardCell, HomeInput, LatLon } from '../core/types.ts';
import { homeArrival } from './arrival.ts';
import { TSUNAMI_TILE_ZOOM, canvasPixelReader, tsunamiAround, tsunamiAt } from './tsunami-tile.ts';
import { createDataSource, type Manifest } from './data.ts';
import { searchAddress } from './geocode.ts';
import { areaViewModel, evacuationViewModel, homeViewModel, locationNote, type LocationSource } from './viewmodel.ts';
import { buildShareText } from './text.ts';
import { DISCLAIMER, DISCLAIMER_DETAIL, clear, el } from './ui/dom.ts';
import { clearLast, loadLast, saveLast, savedShelters } from './storage.ts';
import { renderLast } from './ui/last.ts';
import { renderInput } from './ui/input.ts';
import { renderResult, type ResultData } from './ui/result.ts';
import { renderAbout } from './ui/about.ts';

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
const mainView = el('div', { id: 'main-view' }, inputRoot, resultRoot);
app.append(
  el('header', {}, el('h1', {}, '南海トラフ 住まいの被害シミュレーター'),
    el('div', { class: 'disclaimer' }, el('strong', {}, DISCLAIMER), el('p', {}, DISCLAIMER_DETAIL))),
  mainView, aboutRoot,
  el('footer', {}, el('a', { href: '#about' }, 'このアプリについて（計算方法・出典・プライバシー）')),
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

function onResultShown(home: HomeInput, data: ResultData): void {
  // 新しい結果が出たら「前回の結果」は下げる。結果が出たとき（自宅が ok）だけ保存する（範囲外・データなしは保存しない）。
  // 住所・座標・「〜付近で計算しました」は保存しない。避難場所は名前と距離・徒歩の文字列だけ。
  clear(lastRoot);
  const st = localStore();
  if (!st || data.home.status !== 'ok') return;
  saveLast({
    v: 3, savedAt: new Date().toISOString(), municipality: data.municipality, input: home,
    home: data.home, area: data.area, shelters: savedShelters(data.evac),
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

async function run(pos: LatLon, home: HomeInput, where: LocationSource): Promise<void> {
  clear(resultRoot); // 読み込みに失敗したとき、前の場所の結果を残さない
  const mesh = latLonToMesh250(pos);
  const cell = await ds.hazardCell('L2', mesh);
  const meshes = meshesWithin(pos, 1000);
  const [rawCells, stock, municipality, shelters, homeTsunami] = await Promise.all([
    ds.hazardFor('L2', meshes), ds.stockFor(meshes), municipalityAround(pos, mesh), ds.sheltersNear(pos, 5000),
    tsunamiAround(pos, tileReader), // 中心が浸水域外なら約50mの8方向も見る（Ruling F3）
  ]);
    // 推測した市町名（municipality）は表示用。到達時間は自宅のマス自身の市町村だけから引く。
  const arrival = await homeArrival(ds, mesh);
  // 周辺: 各マス中心の浸水深の段階の代表値（浸水域外は0、判定できないマスは津波なし）。
  const cells: Record<string, HazardCell> = { ...rawCells };
  await Promise.all(meshes.map(async (m) => {
    const c = rawCells[m];
    if (!c) return;
    const t = await tsunamiAt(meshCenter(m), tileReader, AREA_TSUNAMI_ZOOM);
    cells[m] = { ...c, tsunamiDepth: t === 'unknown' ? null : t === 'none' ? 0 : t.mid };
  }));
  const homeVM = homeViewModel(cell, home, homeTsunami, arrival);
  const evac = evacuationViewModel(pos, shelters, arrival);
  const evacShelters = evac.map((e) =>
    nearestShelters(pos, shelters, { hazard: e.hazard, speedMps: WALK_SPEED.standard, limit: 5 }).map((h) => h.shelter),
  );
  const meshRates = meshes.map((m) => {
    // null = データなし（ハザードか建物データが無い、ハザードが無効、または建物データが不正）
    let rate: number | null = null;
    try { rate = cells[m] && stock[m] ? meshCollapseRate(cells[m], stock[m]) : null; } catch { /* 不正な建物データは「データなし」 */ }
    return { mesh: m, rate };
  });
  const data: ResultData = {
    pos, municipality, home: homeVM,
    area: areaViewModel(cells, stock, meshes),
    meshRates, evac, evacShelters,
    shareText: homeVM.status === 'ok' ? buildShareText(municipality, homeVM.collapse, homeVM.half) : null,
    locationNote: locationNote(where),
  };
  renderResult(resultRoot, data);
  onResultShown(home, data);
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
  mainView.hidden = about;
  aboutRoot.hidden = !about;
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
