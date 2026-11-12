// 試作版: 津波タイルは外から読めないので、5か所の計算に使う画素だけを先に取っておいた値で返す。
import pixels from './tsunami-pixels.json';
export * from '../src/app/tsunami-tile.ts';
import type { PixelReader } from '../src/app/tsunami-tile.ts';
const BASE = 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/';
const table = pixels as Record<string, Record<string, [number, number, number, number]>>;
export function canvasPixelReader(): PixelReader {
  return async (url, px, py) => table[url.replace(BASE, '')]?.[`${px},${py}`] ?? [0, 0, 0, 0];
}
