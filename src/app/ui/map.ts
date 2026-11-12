import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { meshCenter } from '../../core/mesh.ts';
import type { LatLon, Shelter } from '../../core/types.ts';
import { TSUNAMI_BANDS } from '../../core/tsunami.ts';
import { TSUNAMI_TILE_URL } from '../tsunami-tile.ts';
import { TSUNAMI_ATTRIBUTION, TSUNAMI_CREDIT_SHORT } from '../text.ts';
import { el } from './dom.ts';

const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>';

function baseMap(node: HTMLElement, center: LatLon, zoom: number): L.Map {
  const map = L.map(node, { center: [center.lat, center.lon], zoom, scrollWheelZoom: false });
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
  return map;
}

/** 全壊率の色分け。色だけに頼らず凡例・ツールチップに数値を併記する。 */
export const LEGEND = [
  { min: 0.2, color: '#8c1d18', label: '20%以上' },
  { min: 0.1, color: '#d4572b', label: '10〜20%' },
  { min: 0.05, color: '#f0a040', label: '5〜10%' },
  { min: 0.01, color: '#f5da7a', label: '1〜5%' },
  { min: 0, color: '#d9ead3', label: '1%未満' },
] as const;
/** Leaflet は文字列を HTML として解釈するため、ツールチップは必ずテキストノード経由で渡す。 */
const tip = (text: string): HTMLElement => {
  const n = document.createElement('span');
  n.textContent = text;
  return n;
};

let resultMap: L.Map | null = null;
let pickerMap: L.Map | null = null;
export function disposePinPicker(): void {
  pickerMap?.remove();
  pickerMap = null;
}

const NO_DATA_COLOR = '#c9c9c9';

const colorFor = (rate: number | null) =>
  rate === null ? NO_DATA_COLOR : (LEGEND.find((l) => rate >= l.min) ?? LEGEND[LEGEND.length - 1]).color;

export type MeshRate = { mesh: string; rate: number | null };

export type ResultMapHandle = { map: L.Map; highlightShelter(index: number): void };

export function createResultMap(
  node: HTMLElement,
  home: LatLon,
  meshes: MeshRate[],
  shelters: Shelter[],
): ResultMapHandle {
  resultMap?.remove();
  const map = baseMap(node, home, 15);
  resultMap = map;
  // 津波浸水想定（地理院のタイル）。無い所（404）は透明のままにする。
  // 全壊率の四角（overlayPane=400）より上に重ね、凡例の色と見た目を合わせる。
  map.createPane('tsunami').style.zIndex = '450';
  L.tileLayer(TSUNAMI_TILE_URL, {
    pane: 'tsunami', opacity: 0.5, maxNativeZoom: 17, maxZoom: 18, attribution: TSUNAMI_CREDIT_SHORT,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  }).addTo(map);
  for (const { mesh, rate } of meshes) {
    const c = meshCenter(mesh);
    const dLat = 1 / 960, dLon = 1 / 640;
    L.rectangle(
      [
        [c.lat - dLat, c.lon - dLon],
        [c.lat + dLat, c.lon + dLon],
      ],
      { stroke: false, fillColor: colorFor(rate), fillOpacity: 0.55, interactive: true },
    )
      .bindTooltip(tip(rate === null ? 'データなし' : `全壊率の推計 ${(rate * 100).toFixed(1)}%`))
      .addTo(map);
  }
  L.circle([home.lat, home.lon], { radius: 1000, color: '#1f4e79', weight: 2, fill: false, dashArray: '6 6' }).addTo(map);
  L.circleMarker([home.lat, home.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#1f4e79', fillOpacity: 1 })
    .bindTooltip(tip('自宅（入力した場所）'))
    .addTo(map);
  const pins = shelters.map((s, i) =>
    L.marker([s.pos.lat, s.pos.lon], {
      icon: L.divIcon({ className: 'shelter-pin', html: String(i + 1), iconSize: [28, 28] }),
      title: s.name,
    })
      .bindTooltip(tip(`${i + 1}. ${s.name}`))
      .addTo(map),
  );
  return {
    map,
    highlightShelter(index) {
      pins.forEach((p, i) => p.getElement()?.classList.toggle('selected', i === index));
    },
  };
}

export function legendElement(): HTMLElement {
  return el(
    'ul',
    { class: 'legend', 'aria-label': '凡例（250mマスの全壊率の推計）' },
    ...LEGEND.map((l) =>
      el('li', {}, el('span', { class: 'swatch', style: `background:${l.color}` }), `全壊率 ${l.label}`),
    ),
    el('li', {}, el('span', { class: 'swatch', style: `background:${NO_DATA_COLOR}` }), 'データなし'),
  );
}

/** 対応する5県（静岡・愛知・岐阜・三重・和歌山）の外接矩形 [[南, 西], [北, 東]]（和歌山県 友ヶ島 134.998°E〜静岡県 熱海、串本町 潮岬〜岐阜県 北端）。 */
const COVER_BOUNDS: [[number, number], [number, number]] = [[33.43, 134.99], [36.47, 139.18]];

/** 矩形が幅 w・高さ h（px）に収まる最大の整数ズーム（Web メルカトル、256px タイル）。大きさが 0 なら null。 */
function zoomToFit(b: [[number, number], [number, number]], w: number, h: number): number | null {
  if (!(w > 0 && h > 0)) return null;
  const merc = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const dx = ((b[1][1] - b[0][1]) / 360) * 256;
  const dy = Math.abs(merc(b[0][0]) - merc(b[1][0])) * 256;
  return Math.max(4, Math.min(10, Math.floor(Math.log2(Math.min(w / dx, h / dy)))));
}

/** 0件のとき: ピンを動かして場所を決める地図。 */
export function createPinPicker(node: HTMLElement, onMove: (p: LatLon) => void, start?: LatLon): { map: L.Map; get(): LatLon } {
  // 静岡・愛知・岐阜・三重・和歌山の5県の外接矩形の中ほどから、5県が全部見える縮尺で開始
  const center = start ?? { lat: (COVER_BOUNDS[0][0] + COVER_BOUNDS[1][0]) / 2, lon: (COVER_BOUNDS[0][1] + COVER_BOUNDS[1][1]) / 2 };
  disposePinPicker();
  // 5県が収まる縮尺（スマートフォンの幅・高さ300pxでは 6）。大きさが分からなければ 7
  const map = baseMap(node, center, start ? 15 : zoomToFit(COVER_BOUNDS, node.clientWidth, node.clientHeight) ?? 7);
  pickerMap = map;
  const marker = L.marker([center.lat, center.lon], {
    draggable: true,
    icon: L.divIcon({ className: 'home-pin', html: '自宅', iconSize: [44, 44] }),
    keyboard: true,
    title: '自宅の位置（ドラッグで動かせます）',
  }).addTo(map);
  const read = (): LatLon => ({ lat: marker.getLatLng().lat, lon: marker.getLatLng().lng });
  marker.on('dragend', () => onMove(read()));
  // 地図をタップしてもピンを移動できる（ドラッグしづらい端末向け）
  map.on('click', (e: L.LeafletMouseEvent) => {
    marker.setLatLng(e.latlng);
    onMove(read());
  });
  return { map, get: read };
}

/** 津波浸水深の凡例（8色）。色だけに頼らず段階名を併記する。 */
export function tsunamiLegendElement(): HTMLElement {
  return el(
    'ul',
    { class: 'legend tsunami-legend', 'aria-label': '凡例（津波の浸水深の想定。地図に薄く重ねています）' },
    ...TSUNAMI_BANDS.map((b) =>
      el('li', {}, el('span', { class: 'swatch', style: `background:rgb(${b.rgb.join(',')})` }), `津波 ${b.label}`),
    ),
  );
}

/** 出典の全文は地図の上に重ねず、地図・凡例の下に出す。 */
export function tsunamiCaption(): HTMLElement {
  return el('p', { class: 'hint tsunami-attribution' }, TSUNAMI_ATTRIBUTION);
}
