import { distanceM } from './mesh.ts';
import type { LatLon, Shelter } from './types.ts';

/** 徒歩速度(m/s)。計画で決めた目安値。 */
export const WALK_SPEED = { standard: 1.0, slow: 0.5 } as const;
/** 直線距離を道のりに換算する係数(目安)。 */
export const DETOUR_FACTOR = 1.3;

export type ShelterHit = { shelter: Shelter; distanceM: number; walkMin: number };

/** 災害種別に対応する避難場所を、直線距離の近い順に limit 件返す。同距離は入力順。 */
export function nearestShelters(
  origin: LatLon,
  shelters: Shelter[],
  opts: { hazard: 'earthquake' | 'tsunami'; speedMps: number; limit: number },
): ShelterHit[] {
  if (!(opts.limit > 0)) return [];
  return shelters
    .filter((s) => s[opts.hazard])
    .map((shelter) => {
      const d = distanceM(origin, shelter.pos);
      return { shelter, distanceM: d, walkMin: (d * DETOUR_FACTOR) / opts.speedMps / 60 };
    })
    .filter((h) => Number.isFinite(h.distanceM))
    .sort((a, b) => a.distanceM - b.distanceM) // Array.prototype.sort は安定
    .slice(0, opts.limit);
}

/** 揺れが収まってから避難を始めるまでの時間(分)。 */
export const EVAC_START_MIN = 5;

/** 徒歩(遅め)+避難開始までの時間 t を到達時間と比べる。到達時間なし・5分以内は判定しない(n/a)。
 *  t < 到達−5 なら ok、t <= 到達なら tight、超えれば no。 */
export function reachBeforeTsunami(walkMin: number, arrivalMin: number | null): 'ok' | 'tight' | 'no' | 'n/a' {
  if (arrivalMin === null || arrivalMin <= EVAC_START_MIN) return 'n/a';
  const t = walkMin + EVAC_START_MIN;
  if (t < arrivalMin - 5) return 'ok';
  if (t <= arrivalMin) return 'tight';
  return 'no';
}
