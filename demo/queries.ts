import presets from './presets.json' with { type: 'json' };
import { meshCenter, meshesWithin } from '../src/core/mesh.ts';
import { tsunamiAround, tsunamiAt, TSUNAMI_TILE_ZOOM } from '../src/app/tsunami-tile.ts';
const q = new Set<string>();
const rec = async (url: string, px: number, py: number) => { q.add(`${url}#${px},${py}`); return [0,0,0,0] as [number,number,number,number]; };
for (const p of presets) {
  await tsunamiAround(p.pos, rec);
  for (const m of meshesWithin(p.pos, 1000)) await tsunamiAt(meshCenter(m), rec, TSUNAMI_TILE_ZOOM - 2);
}
const byTile: Record<string, number[][]> = {};
for (const k of q) { const [u, xy] = k.split('#'); (byTile[u] ??= []).push(xy.split(',').map(Number)); }
console.log(JSON.stringify(byTile));
