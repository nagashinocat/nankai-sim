// 試作版（アーティファクト用）: 住所検索の代わりに、データを入れた5か所から選ぶ。
import type { Candidate } from '../src/app/geocode.ts';
import presets from './presets.json';
export { parseGsiResponse } from '../src/app/geocode.ts';
export type { Candidate } from '../src/app/geocode.ts';
export async function searchAddress(q: string): Promise<Candidate[]> {
  const query = q.trim().replace(/\s/g, '');
  if (!query) return [];
  const hit = presets.filter((p) => p.label.includes(query) || query.includes(p.label.replace(/^(静岡県|愛知県|岐阜県|三重県|和歌山県)/, '').slice(0, 3)));
  return hit.length > 0 ? hit : presets;
}
