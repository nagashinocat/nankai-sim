// 試作版: 外の地図タイルを読めないので、5か所の周り（約2.3km四方）の「海・川」と「津波の浸水想定」を画像にして敷く。
// 出典: 国土地理院 淡色地図・ハザードマップポータルサイト 津波浸水想定（色を読み取り、簡略化して作成）。
import * as L from 'leaflet';
import data from './basemap.json';
import type { LatLon } from '../src/core/types.ts';

const BANDS: [number, number, number][] = [[255,255,179],[247,245,169],[248,225,166],[255,216,192],[255,183,183],[255,145,145],[242,133,201],[220,122,220]];
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const cache = new Map<number, string>();

function render(i: number): string {
  const hit = cache.get(i);
  if (hit) return hit;
  const { m, w, t } = data[i];
  const wb = bytes(w), tb = bytes(t);
  const small = document.createElement('canvas');
  small.width = small.height = m;
  const g = small.getContext('2d')!;
  const water = g.createImageData(m, m);
  const raw = (x: number, y: number) => (x < 0 || y < 0 || x >= m || y >= m ? 0 : (wb[(y * m + x) >> 3] >> ((y * m + x) & 7)) & 1);
  for (let k = 0; k < m * m; k++) {
    // 地図の細かい記号のゆらぎを消す: 周り8マスのうち3マス以上が水のときだけ水にする
    const x = k % m, y = (k / m) | 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += raw(x + dx, y + dy);
    const isWater = raw(x, y) ? n >= 3 : n >= 6;
    const [r, gg, b] = isWater ? [170, 205, 240] : [246, 244, 238];
    water.data.set([r, gg, b, 255], k * 4);
  }
  g.putImageData(water, 0, 0);
  const big = document.createElement('canvas');
  big.width = big.height = m * 4;
  const G = big.getContext('2d')!;
  G.imageSmoothingEnabled = true;
  G.drawImage(small, 0, 0, m * 4, m * 4);
  const tsu = g.createImageData(m, m);
  for (let k = 0; k < m * m; k++) {
    const v = (tb[k >> 1] >> ((k & 1) * 4)) & 15;
    if (v > 0 && v <= 8) tsu.data.set([...BANDS[v - 1], 140], k * 4);
  }
  g.clearRect(0, 0, m, m);
  g.putImageData(tsu, 0, 0);
  G.imageSmoothingEnabled = false;
  G.drawImage(small, 0, 0, m * 4, m * 4);
  const url = big.toDataURL('image/png');
  cache.set(i, url);
  return url;
}

/** 地図の中心にいちばん近い試作の場所の背景を敷く（2km以内に無ければ何もしない）。 */
export function addDemoBase(map: L.Map, center: LatLon): void {
  let best = -1, bd = Infinity;
  data.forEach((d, i) => {
    const c = { lat: (d.b[0][0] + d.b[1][0]) / 2, lon: (d.b[0][1] + d.b[1][1]) / 2 };
    const dist = Math.hypot(c.lat - center.lat, (c.lon - center.lon) * Math.cos((center.lat * Math.PI) / 180));
    if (dist < bd) { bd = dist; best = i; }
  });
  if (best < 0 || bd > 0.02) return;
  L.imageOverlay(render(best), data[best].b as [[number, number], [number, number]], {
    pane: 'tilePane', attribution: '国土地理院（淡色地図・津波浸水想定を簡略化）',
  }).addTo(map);
}
