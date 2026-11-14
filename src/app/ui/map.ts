import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { meshCenter } from '../../core/mesh.ts';
import type { LatLon, Shelter } from '../../core/types.ts';
import { TSUNAMI_BANDS } from '../../core/tsunami.ts';
import { TSUNAMI_TILE_URL } from '../tsunami-tile.ts';
import { TSUNAMI_ATTRIBUTION, TSUNAMI_CREDIT_SHORT } from '../text.ts';
import { ESCAPE_LABEL, ESCAPE_LABEL_KIDS, cellClass, cellFill, type EscapeTarget, type RiskMode, type TsunamiClass } from '../riskmap.ts';
import { el } from './dom.ts';

const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>';

function baseMap(node: HTMLElement, center: LatLon, zoom: number): L.Map {
  const map = L.map(node, { center: [center.lat, center.lon], zoom, scrollWheelZoom: false });
  L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);
  return map;
}

/** Leaflet は文字列を HTML として解釈するため、ツールチップは必ずテキストノード経由で渡す。 */
const tip = (text: string): HTMLElement => {
  const n = document.createElement('span');
  n.textContent = text;
  return n;
};

let pickerMap: L.Map | null = null;
export function disposePinPicker(): void {
  pickerMap?.remove();
  pickerMap = null;
}

/** tsunami = マス中心の浸水深（m。0 は浸水域外、null・未設定は判定できない）。 */
export type MeshRate = { mesh: string; rate: number | null; tsunami?: number | null };

/** 地図の置き場所ごとに1つ（作り直すときは前の地図を片付ける）。 */
const riskMaps = new Map<string, L.Map>();
let defsSeq = 0;

export type RiskMapOptions = {
  /** 'result'（おとな）か 'kids'。同じ置き場所の前の地図は片付ける */
  slot: string;
  home: LatLon;
  meshes: MeshRate[];
  /** 津波の避難場所（近い順。番号はこの順） */
  tsunamiShelters: Shelter[];
  /** 地震の避難場所（近い順。番号はこの順） */
  quakeShelters: Shelter[];
  /** 逃げる方向の先（null は矢印なし） */
  escape: EscapeTarget | null;
  mode: RiskMode;
  kids?: boolean;
};

export type RiskMapHandle = {
  map: L.Map;
  /** 地震の避難場所の index 番目を目立たせる（経路の選択） */
  highlightShelter(index: number): void;
  /** マスの色だけ差し替える（地図はそのまま） */
  setMeshRates(meshes: MeshRate[]): void;
  setMode(mode: RiskMode): void;
  /** 地図の大きさが変わった（表示した）あとに呼ぶ。逃げる先が見えるように合わせる */
  refresh(): void;
  remove(): void;
};

const GREEN = '#1B6E3C';
const DLAT = 1 / 960, DLON = 1 / 640;

function patternDefs(id: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('class', 'rm-defs');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('width', '0');
  s.setAttribute('height', '0');
  s.innerHTML =
    `<defs><pattern id="${id}-wave" width="14" height="9" patternUnits="userSpaceOnUse">` +
    '<path d="M0 6.5 Q3.5 2 7 6.5 T14 6.5" fill="none" stroke="#0C447C" stroke-width="1.5" opacity="0.6"></path></pattern>' +
    `<pattern id="${id}-unknown" width="8" height="8" patternUnits="userSpaceOnUse">` +
    '<path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" stroke="#4A4A4A" stroke-width="1.3" opacity="0.6"></path></pattern></defs>';
  return s;
}

/** 津波の避難場所の印（緑の丸・白い縁・山と上向きの矢印・番号）。数字だけを入れる（名前は別のラベルに textContent で）。 */
function tsunamiIconHtml(no: number, size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">` +
    `<circle cx="20" cy="20" r="18" fill="${GREEN}" stroke="#FFFFFF" stroke-width="3"></circle>` +
    '<path d="M7.5 29 L16.5 15.5 L20.5 21 L24 16.5 L32.5 29 Z" fill="#FFFFFF"></path>' +
    '<path d="M24 13 L24 5.5 M20.6 8.8 L24 5.5 L27.4 8.8" stroke="#FFFFFF" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
    `</svg><span class="rm-badge">${no}</span>`;
}

export function createRiskMap(node: HTMLElement, o: RiskMapOptions): RiskMapHandle {
  riskMaps.get(o.slot)?.remove();
  node.querySelectorAll(':scope > .rm-defs').forEach((n) => n.remove());
  const kids = !!o.kids;
  const map = baseMap(node, o.home, 15);
  riskMaps.set(o.slot, map);
  const defsId = `rm${++defsSeq}`;
  node.append(patternDefs(defsId));
  // マスの色は津波タイルから読んだ値も使うので、どのモードでも出典を出す
  map.attributionControl.addAttribution(TSUNAMI_CREDIT_SHORT);

  // ペインの重なり（下から）: マス 380 → 津波タイル 390 → 1km の円（overlay 400）→ 矢印 620
  // → 避難場所 650（マス・津波タイル・矢印に隠れない）→ 自宅の印とラベル 655（いつも見える）→ 説明（ツールチップ）660
  map.createPane('mesh').style.zIndex = '380';
  map.createPane('tsunami').style.zIndex = '390';
  map.createPane('escape').style.zIndex = '620';
  map.createPane('shelters').style.zIndex = '650';
  map.createPane('home').style.zIndex = '655';
  // 説明（ツールチップ）は印より上に
  map.getPane('tooltipPane')!.style.zIndex = '660';

  // 津波浸水想定（地理院のタイル）は「津波」モードのときだけ重ねる。無い所（404）は透明のまま。
  const tsunamiTiles = L.tileLayer(TSUNAMI_TILE_URL, {
    pane: 'tsunami', opacity: 0.5, maxNativeZoom: 17, maxZoom: 18, attribution: TSUNAMI_CREDIT_SHORT,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  });

  let mode: RiskMode = kids ? 'both' : o.mode;
  let meshes = o.meshes;
  const cells = L.layerGroup().addTo(map);
  const drawCells = (): void => {
    cells.clearLayers();
    for (const { mesh, rate, tsunami } of meshes) {
      const c = meshCenter(mesh);
      const b: L.LatLngBoundsExpression = [[c.lat - DLAT, c.lon - DLON], [c.lat + DLAT, c.lon + DLON]];
      const cls = cellClass(rate, tsunami ?? null);
      const f = cellFill(cls, mode);
      const base = L.rectangle(b, {
        pane: 'mesh', color: '#FFFFFF', weight: 1, opacity: 0.9, fillColor: f.fill,
        // 「津波」では地理院の浸水深のタイル（8色）を重ねるので、マスは薄く（模様で見分ける）
        fillOpacity: mode === 'tsunami' && !kids ? 0.3 : 0.62, interactive: !kids,
        className: `rm-cell rm-${cls.collapse} rm-t-${cls.tsunami}`,
      });
      if (!kids) base.bindTooltip(tip(cellTip(rate, cls.tsunami, mode)));
      base.addTo(cells);
      // 推計値（%、小数1桁）を要素に残す（画面の確認用。座標は入れない）
      base.getElement()?.setAttribute('data-rate', rate === null || !Number.isFinite(rate) ? '' : (rate * 100).toFixed(1));
      // 色だけに頼らない: 津波は波の模様、判定できないマスは斜線
      if (f.hatch) L.rectangle(b, { pane: 'mesh', stroke: false, fillColor: `url(#${defsId}-wave)`, fillOpacity: 1, interactive: false, className: 'rm-wave' }).addTo(cells);
      if (f.unknownHatch) L.rectangle(b, { pane: 'mesh', stroke: false, fillColor: `url(#${defsId}-unknown)`, fillOpacity: 1, interactive: false, className: 'rm-unknown' }).addTo(cells);
    }
  };

  // 自宅（1km の円・印・ラベル）
  L.circle([o.home.lat, o.home.lon], { radius: 1000, color: '#5A6377', weight: 2, fill: false, dashArray: '6 6', interactive: false }).addTo(map);
  const homeDot = L.circleMarker([o.home.lat, o.home.lon], { pane: 'home', radius: kids ? 13 : 10, color: '#FFFFFF', weight: 3, fillColor: '#1F2A44', fillOpacity: 1, className: 'rm-home-dot' });
  if (!kids) homeDot.bindTooltip(tip('自宅（入力した場所）'));
  homeDot.addTo(map);
  const homeLabel = L.marker([o.home.lat, o.home.lon], {
    pane: 'home', interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'rm-anchor', html: el('span', { class: kids ? 'rm-home-label rm-home-kids' : 'rm-home-label' }, kids ? 'おうち' : '自宅'), iconSize: [0, 0], iconAnchor: [-14, -12] }),
  }).addTo(map);
  const homeR = kids ? 15 : 12;

  // 近い津波の避難場所への矢印（太い緑の矢印＋矢じり＋ラベル）。矢印は自宅の印と避難場所の印にかからないように、両端を少し短くする
  const escapeLayer = L.layerGroup();
  const drawEscape = (): void => {
    escapeLayer.clearLayers();
    const t = o.escape;
    if (!t) return;
    const a = map.latLngToLayerPoint([o.home.lat, o.home.lon]);
    const bp = map.latLngToLayerPoint([t.shelter.pos.lat, t.shelter.pos.lon]);
    const len = a.distanceTo(bp);
    if (!(len >= 1)) return; // 同じ地点（向きが決まらない）
    const ux = (bp.x - a.x) / len, uy = (bp.y - a.y) / len;
    const P = (d: number, side = 0) => map.layerPointToLatLng(L.point(a.x + ux * d - uy * side, a.y + uy * d + ux * side));
    // 始まりは自宅の印のふちから。先は避難場所の印の手前。近くて短いときも、軸 24px＋矢じりは必ず描く
    // （先が避難場所の印の下に入ることがある。印のペインが上）
    const head = kids ? 20 : 16, w = kids ? 14 : 11, startGap = homeR + 2, endGap = tsSize() / 2 + 3;
    const tipD = Math.max(len - endGap, startGap + 24 + head), baseD = tipD - head;
    const line = [P(startGap), P(baseD + 2)];
    L.polyline(line, { pane: 'escape', color: '#FFFFFF', weight: kids ? 15 : 12, opacity: 0.9, lineCap: 'round', interactive: false }).addTo(escapeLayer);
    L.polyline(line, { pane: 'escape', color: GREEN, weight: kids ? 10 : 7, opacity: 1, lineCap: 'round', interactive: false, className: 'rm-arrow' }).addTo(escapeLayer);
    L.polygon([P(tipD), P(baseD, w), P(baseD, -w)], { pane: 'escape', color: '#FFFFFF', weight: 2, fillColor: GREEN, fillOpacity: 1, interactive: false, className: 'rm-arrow-head' }).addTo(escapeLayer);
    // 画面で短い（70px 未満）ときは、矢印のラベルは出さない（地図の下の文で説明している）
    if (len < 70) return;
    const mid = P((startGap + baseD) / 2);
    L.marker(mid, {
      pane: 'escape', interactive: false, keyboard: false, zIndexOffset: 100000,
      icon: L.divIcon({ className: 'rm-anchor', html: el('span', { class: 'rm-escape-label' }, kids ? ESCAPE_LABEL_KIDS : ESCAPE_LABEL), iconSize: [0, 0] }),
    }).addTo(escapeLayer);
  };

  // 避難場所の印（専用ペイン。津波＝緑の丸、地震＝小さめの青緑の印）。大きさはズームで変える（縮小すると印どうしが重なるので小さく）
  const shelterLayer = L.layerGroup().addTo(map);
  const tsunamiIds = new Set(o.tsunamiShelters.map((s) => s.id));
  const quakePins: (L.Marker | null)[] = [];
  const tsunamiPins = new Map<string, L.Marker>();
  const resizers: (() => void)[] = [];
  const zoomNow = () => map.getZoom();
  function tsSize(): number { const z = zoomNow(); return (z <= 15 ? 28 : z === 16 ? 34 : 40) + (kids ? 8 : 0); }
  const qSize = (): number => { const z = zoomNow(); return z <= 15 ? 18 : z === 16 ? 22 : 26; };
  const targetId = o.escape?.shelter.id ?? null;
  o.tsunamiShelters.forEach((s, i) => {
    const q = o.quakeShelters.findIndex((x) => x.id === s.id);
    const name = kids ? `にげる ばしょ ${i + 1}` : `津波の避難場所 ${i + 1}${q >= 0 ? `（地震の避難場所 ${q + 1} と同じ）` : ''}：${s.name}`;
    const target = s.id === targetId;
    const make = () => {
      const t = tsSize();
      return L.divIcon({
        className: `rm-shelter rm-shelter-tsunami${kids ? ' rm-kids' : ''}${t < 34 ? ' rm-sm' : ''}${target ? ' rm-target' : ''}`, html: tsunamiIconHtml(i + 1, t),
        iconSize: [t, t], iconAnchor: [t / 2, t / 2],
      });
    };
    // 逃げる先の印は、ほかの印より上に（白い縁を太く・少し大きく）
    const m = L.marker([s.pos.lat, s.pos.lon], { pane: 'shelters', icon: make(), title: name, alt: name, keyboard: !kids, riseOnHover: true, zIndexOffset: target ? 50000 : 0 });
    if (!kids) m.bindTooltip(tip(name), { direction: 'top', offset: [0, -14] });
    m.addTo(shelterLayer);
    tsunamiPins.set(s.id, m);
    resizers.push(() => m.setIcon(make()));
  });
  o.quakeShelters.forEach((s, i) => {
    // 津波の避難場所と同じ場所は、津波の印だけ（印が重ならないように）
    if (tsunamiIds.has(s.id)) { quakePins.push(null); return; }
    const name = kids ? `じしんの ときの ばしょ ${i + 1}` : `地震の避難場所 ${i + 1}：${s.name}`;
    const make = () => {
      const t = qSize();
      return L.divIcon({ className: `rm-shelter rm-shelter-quake${t < 22 ? ' rm-sm' : ''}`, html: `<span>${i + 1}</span>`, iconSize: [t, t], iconAnchor: [t / 2, t / 2] });
    };
    const m = L.marker([s.pos.lat, s.pos.lon], { pane: 'shelters', icon: make(), title: name, alt: name, keyboard: !kids });
    if (!kids) m.bindTooltip(tip(name), { direction: 'top', offset: [0, -10] });
    m.addTo(shelterLayer);
    quakePins.push(m);
    resizers.push(() => m.setIcon(make()));
  });

  // 名前のラベルは逃げる先だけ（こどもは「にげる ばしょ」）。ほかの印・自宅の印とラベルに重なるなら、下→上→右→左の順に試し、
  // どこも重なるなら出さない（凡例と地図の下の文で名前が分かる）
  const LABEL_POS = ['below', 'above', 'right', 'left'] as const;
  type LabelPos = (typeof LABEL_POS)[number] | 'hidden';
  const target = o.escape ? o.tsunamiShelters.find((s) => s.id === targetId) ?? null : null;
  const labelIcon = (pos: LabelPos) => {
    const g = tsSize() / 2 + 3;
    const anchor: [number, number] = pos === 'below' ? [0, -g] : pos === 'above' ? [0, g] : pos === 'right' ? [-g, 0] : pos === 'left' ? [g, 0] : [0, 0];
    return L.divIcon({
      className: 'rm-anchor',
      html: el('span', { class: `rm-shelter-label rm-pos-${pos}${kids ? ' rm-label-kids' : ''}` }, kids ? 'にげる ばしょ' : target!.name),
      iconSize: [0, 0], iconAnchor: anchor,
    });
  };
  const labelMarker = target
    ? L.marker([target.pos.lat, target.pos.lon], { pane: 'shelters', icon: labelIcon('below'), interactive: false, keyboard: false, zIndexOffset: 100000 }).addTo(shelterLayer)
    : null;
  const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const placeLabel = (): void => {
    if (!labelMarker || !target) return;
    const others: DOMRect[] = [];
    tsunamiPins.forEach((m, id) => { if (id !== target.id) { const r = m.getElement()?.getBoundingClientRect(); if (r) others.push(r); } });
    quakePins.forEach((m) => { const r = m?.getElement()?.getBoundingClientRect(); if (r) others.push(r); });
    const hl = homeLabel.getElement()?.firstElementChild?.getBoundingClientRect();
    if (hl) others.push(hl);
    const box = node.getBoundingClientRect();
    const hc = map.latLngToContainerPoint([o.home.lat, o.home.lon]);
    others.push(new DOMRect(box.left + hc.x - homeR, box.top + hc.y - homeR, homeR * 2, homeR * 2));
    for (const pos of LABEL_POS) {
      labelMarker.setIcon(labelIcon(pos));
      const r = labelMarker.getElement()?.firstElementChild?.getBoundingClientRect();
      if (!r || r.width === 0) return; // 地図が見えていない（大きさ 0）。表示したあと refresh で決める
      if (!others.some((o2) => o2.width > 0 && overlaps(r, o2))) return;
    }
    labelMarker.setIcon(labelIcon('hidden'));
  };
  const relayout = (): void => { resizers.forEach((f) => f()); placeLabel(); };

  const applyMode = (): void => {
    drawCells();
    if (mode === 'tsunami' && !kids) tsunamiTiles.addTo(map); else tsunamiTiles.remove();
    if (mode !== 'shake' && o.escape) { escapeLayer.addTo(map); drawEscape(); } else escapeLayer.remove();
  };
  applyMode();
  relayout();
  map.on('zoomend', () => { relayout(); if (map.hasLayer(escapeLayer)) drawEscape(); });

  let fitted = false;
  const refresh = (): void => {
    map.invalidateSize();
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;
    // 最初の1回だけ: 周辺1kmと逃げる先がどちらも入る縮尺に合わせる
    if (!fitted && o.escape) {
      fitted = true;
      const t = L.latLng(o.escape.shelter.pos.lat, o.escape.shelter.pos.lon);
      // 下は避難場所の名前のラベルと出典の分を空ける
      // 周辺1km（円）全体が見えることを優先し、逃げる先が円の外なら広げる（2026-11-14 本番確認: 近いと拡大しすぎてマスが2〜3個しか見えなかった）
      const b = L.latLng(o.home.lat, o.home.lon).toBounds(2000).extend(t);
      map.fitBounds(b, { paddingTopLeft: [8, 8], paddingBottomRight: [8, 28], maxZoom: 16, animate: false });
    }
    relayout();
    if (map.hasLayer(escapeLayer)) drawEscape();
  };
  refresh();

  return {
    map,
    highlightShelter(index) {
      quakePins.forEach((p, i) => p?.getElement()?.classList.toggle('selected', i === index));
      const s = o.quakeShelters[index];
      tsunamiPins.forEach((p, id) => p.getElement()?.classList.toggle('selected', !!s && id === s.id));
    },
    setMeshRates(list) { meshes = list; drawCells(); },
    setMode(m) { if (kids || m === mode) return; mode = m; applyMode(); },
    refresh,
    remove() { if (riskMaps.get(o.slot) === map) riskMaps.delete(o.slot); map.remove(); },
  };
}

function cellTip(rate: number | null, t: TsunamiClass, mode: RiskMode): string {
  const r = rate === null || !Number.isFinite(rate) ? '全壊率の推計 データなし' : `全壊率の推計 ${(rate * 100).toFixed(1)}%`;
  const ts = t === 'yes' ? '津波の浸水想定あり' : t === 'no' ? '津波の浸水想定なし' : '津波は判定できません';
  return mode === 'shake' ? r : mode === 'tsunami' ? ts : `${r}・${ts}`;
}

/** 凡例の小さな見本（色＋模様）。defsId の模様を使う代わりに、見本ごとに模様を持つ（地図が無くても出る）。 */
export function swatchSvg(fill: string, hatch: boolean, unknownHatch: boolean, w = 28, h = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.setAttribute('viewBox', `0 0 ${w} ${h}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'rm-swatch');
  const rect = (attrs: Record<string, string>) => {
    const r = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ x: '0', y: '0', width: String(w), height: String(h), rx: '4', ...attrs })) r.setAttribute(k, v);
    s.append(r);
  };
  rect({ fill, stroke: '#B9B4A8', 'stroke-width': '1' });
  if (hatch) {
    for (let y = 6; y < h; y += 7) {
      const p = document.createElementNS(ns, 'path');
      let d = `M0 ${y}`;
      for (let x = 0; x < w; x += 7) d += ` Q${x + 1.75} ${y - 3.5} ${x + 3.5} ${y} T${x + 7} ${y}`;
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#0C447C');
      p.setAttribute('stroke-width', '1.2');
      p.setAttribute('opacity', '0.6');
      s.append(p);
    }
  }
  if (unknownHatch) {
    const p = document.createElementNS(ns, 'path');
    let d = '';
    for (let x = -h; x < w; x += 6) d += `M${x} ${h} L${x + h} 0 `;
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#4A4A4A');
    p.setAttribute('stroke-width', '1.2');
    p.setAttribute('opacity', '0.6');
    s.append(p);
  }
  return s;
}

/** 凡例の避難場所の見本（地図の印と同じ形）。 */
export function shelterSwatch(kind: 'tsunami' | 'quake', kids = false): HTMLElement {
  if (kind === 'tsunami') {
    const n = el('span', { class: `rm-shelter rm-shelter-tsunami rm-swatch-marker${kids ? ' rm-kids' : ''}`, 'aria-hidden': 'true' });
    n.innerHTML = tsunamiIconHtml(1, kids ? 40 : 32).replace(/<span class="rm-badge">1<\/span>$/, '');
    return n;
  }
  const n = el('span', { class: 'rm-shelter rm-shelter-quake rm-swatch-marker', 'aria-hidden': 'true' }, el('span', {}, '1'));
  return n;
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
