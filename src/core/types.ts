export type LatLon = { lat: number; lon: number };

export type Structure = 'wood' | 'steel' | 'rc';
export type Era = 'pre1981' | 'y1981_2000' | 'post2000';
export type Rates = { collapse: number; half: number };

/** 1 マス分のハザード。pl は表示専用（計算には使わない）。液状化は settlementCm で評価する。 */
export type HazardCell = {
  intensity: number | null;
  pl: number | null;
  settlementCm: number | null;
  tsunamiDepth: number | null;
  tsunamiArrivalMin: number | null;
};

/** [最小, 最大] */
export type Range = [number, number];

export type HomeInput = {
  structure: Structure | 'unknown';
  era: Era | 'unknown';
  retrofitted: boolean;
};

export type StockKey = `${Structure}:${Era}`;
/** メッシュ内の建物棟数と構造×年代の構成比。shares の合計は 1。 */
export type BuildingStock = { total: number; shares: Partial<Record<StockKey, number>> };
