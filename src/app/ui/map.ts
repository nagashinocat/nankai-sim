import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { meshCenter } from '../../core/mesh.ts';
import type { LatLon, Shelter } from '../../core/types.ts';
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

/** 0件のとき: ピンを動かして場所を決める地図。 */
export function createPinPicker(node: HTMLElement, onMove: (p: LatLon) => void, start?: LatLon): { map: L.Map; get(): LatLon } {
  const center = start ?? { lat: 34.73, lon: 136.51 }; // 三重県付近から開始
  disposePinPicker();
  const map = baseMap(node, center, start ? 15 : 9);
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
