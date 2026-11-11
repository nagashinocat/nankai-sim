import type { LatLon } from '../core/types.ts';
import type { Fetcher } from './data.ts';

export type Candidate = { label: string; pos: LatLon };

const GSI_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';

/** 国土地理院 住所検索の応答 → 候補。形式が違えば []（座標は [lon, lat] の順）。 */
export function parseGsiResponse(json: unknown): Candidate[] {
  if (!Array.isArray(json)) return [];
  const out: Candidate[] = [];
  for (const item of json) {
    const coords = (item as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates;
    const title = (item as { properties?: { title?: unknown } } | null)?.properties?.title;
    if (!Array.isArray(coords) || typeof title !== 'string') continue;
    const [lon, lat] = coords;
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({ label: title, pos: { lat, lon } });
  }
  return out;
}

/** 住所 → 候補。空白のみは通信しない。通信失敗・HTTPエラーは例外（呼び出し側で表示する）。 */
export async function searchAddress(q: string, fetcher: Fetcher): Promise<Candidate[]> {
  const query = q.trim();
  if (!query) return [];
  const res = await fetcher(GSI_URL + encodeURIComponent(query));
  if (!res.ok) throw new Error(`住所検索 HTTP ${res.status}`);
  return parseGsiResponse(await res.json());
}
