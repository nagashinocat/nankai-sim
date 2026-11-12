import type { BuildingStock, HazardCell, LatLon, Shelter } from '../core/types.ts';
import { distanceM, latLonToMesh250, mesh2Of } from '../core/mesh.ts';

export type Fetcher = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type Manifest = {
  datasets: { id: string; source: string; url?: string; notes?: string; [k: string]: unknown }[];
};

/** 市町村の津波到達時間。min は海岸に着く最短の分（「－」は null）、cm はその高さ（その県で公表されている最も低い高さ。三重・愛知 30、静岡 50）。 */
export type Arrival = { min: number | null; cm: number };

function isArrival(v: unknown): v is Arrival {
  if (!v || typeof v !== 'object') return false;
  const { min, cm } = v as Record<string, unknown>;
  return typeof cm === 'number' && Number.isFinite(cm) && cm > 0 && (min === null || (typeof min === 'number' && Number.isFinite(min) && min >= 0));
}

export interface DataSource {
  /**
   * 対応範囲は 250m メッシュ単位（Ruling F1・F4: メッシュの四角が4県の境界と面積>0で重なる）。
   * 2次メッシュが {case}/index.json に無い、またはファイルにそのメッシュの行が無い（隣県など）なら 'outside'。
   * 行はあるが想定値が無い（震度が null）なら null（データなし）。
   * index.json にあるのにファイルが読めない（404・HTML・壊れた JSON）、または index.json が読めないときは例外（再試行できる）。
   */
  hazardCell(caseId: 'L2', mesh: string): Promise<HazardCell | null | 'outside'>;
  /** この 250m メッシュが対応範囲にあるか（hazardCell が 'outside' でないか）。読めなければ例外。 */
  covers(caseId: 'L2', mesh: string): Promise<boolean>;
  stockFor(meshes: string[]): Promise<Record<string, BuildingStock>>;
  /** 対応範囲外のメッシュと想定値の無いメッシュは含めない。範囲内のファイルが読めなければ例外。 */
  hazardFor(caseId: 'L2', meshes: string[]): Promise<Record<string, HazardCell>>;
  municipalityOf(mesh: string): Promise<string | null>;
  /** 中心の2次メッシュと隣接8つの避難場所ファイルを読み、半径内のものを返す（404 は空） */
  sheltersNear(pos: LatLon, radiusM: number): Promise<Shelter[]>;
  manifest(): Promise<Manifest>;
  /** 市町村（municipalityOf が返す名前）の津波到達時間 {min, cm}。表に無い・形が違う・ファイル無しは null（「－」は min が null）。 */
  tsunamiArrival(muni: string): Promise<Arrival | null>;
}

/** 5次メッシュコードを含む2次メッシュの中心座標 */
function meshCenter2(code: string): LatLon {
  const q = Number(code[4]), v = Number(code[5]);
  const lat0 = Number(code.slice(0, 2)) / 1.5 + q / 12;
  const lon0 = 100 + Number(code.slice(2, 4)) + v / 8;
  return { lat: lat0 + 1 / 24, lon: lon0 + 1 / 16 };
}

type HazardRow = (number | null)[];

/** ファイル中のメッシュの行（自分のキーで、配列のときだけ）。 */
function rowOf(file: Record<string, HazardRow>, mesh: string): HazardRow | null {
  const row = Object.hasOwn(file, mesh) ? file[mesh] : undefined;
  return Array.isArray(row) ? row : null;
}

function toCell(row: HazardRow): HazardCell {
  const [intensity, pl, settlementCm, tsunamiDepth, tsunamiArrivalMin] = row;
  return {
    intensity: intensity ?? null,
    pl: pl ?? null,
    settlementCm: settlementCm ?? null,
    tsunamiDepth: tsunamiDepth ?? null,
    tsunamiArrivalMin: tsunamiArrivalMin ?? null,
  };
}

export function createDataSource(fetcher: Fetcher, base = '/data'): DataSource {
  const cache = new Map<string, Promise<unknown>>();

  /** URL ごとに1回だけ取得する。404 は null。失敗（404以外）はキャッシュせず例外。 */
  function load<T>(url: string): Promise<T | null> {
    let p = cache.get(url);
    if (!p) {
      p = fetcher(url).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        // 静的ホストは無いファイルを index.html（200）で返すことがある（裁定 W6）。HTML や JSON でない応答は「無い」扱い。
        if (/text\/html/i.test(res.headers?.get('content-type') ?? '')) return null;
        try { return await res.json(); } catch { return null; }
      });
      cache.set(url, p);
      p.catch(() => cache.delete(url));
    }
    return p as Promise<T | null>;
  }

  /** 必ずあるはずのファイル。無い（404・HTML・壊れた JSON）ときは例外にし、覚えない（再試行で取り直す）。 */
  function loadRequired<T>(url: string): Promise<T> {
    return load<T>(url).then((v) => {
      if (v === null || typeof v !== 'object') {
        cache.delete(url);
        throw new Error('想定データを読み込めませんでした');
      }
      return v;
    });
  }

  const coverage = new Map<string, Promise<Set<string>>>();
  /** {case}/index.json（パイプラインが書く対応範囲の2次メッシュ一覧）。読めなければ例外。 */
  function coverageOf(caseId: string): Promise<Set<string>> {
    let p = coverage.get(caseId);
    if (!p) {
      const url = `${base}/hazard/${caseId}/index.json`;
      p = loadRequired<unknown>(url).then((list) => {
        if (!Array.isArray(list) || !list.every((c) => typeof c === 'string')) {
          cache.delete(url);
          throw new Error('想定データの対応範囲を読み込めませんでした');
        }
        return new Set(list as string[]);
      });
      coverage.set(caseId, p);
      p.catch(() => coverage.delete(caseId));
    }
    return p;
  }

  const hazardFile = (caseId: string, mesh: string) =>
    loadRequired<Record<string, HazardRow>>(`${base}/hazard/${caseId}/${mesh2Of(mesh)}.json`);
  const stockFile = (mesh: string) => load<Record<string, BuildingStock>>(`${base}/stock/${mesh2Of(mesh)}.json`);

  async function hazardCell(caseId: string, mesh: string): Promise<HazardCell | null | 'outside'> {
    if (!(await coverageOf(caseId)).has(mesh2Of(mesh))) return 'outside';
    const row = rowOf(await hazardFile(caseId, mesh), mesh);
    if (!row) return 'outside'; // 同じ2次メッシュでも4県外（隣県）のメッシュには行が無い（Ruling F1）
    const cell = toCell(row);
    return cell.intensity === null ? null : cell;
  }

  let reverse: Promise<Map<string, string>> | undefined;
  const municipalities = () => {
    reverse ??= load<Record<string, string[]>>(`${base}/stock/municipality_meshes.json`).then((table) => {
      const m = new Map<string, string>();
      for (const [name, meshes] of Object.entries(table ?? {})) for (const mesh of meshes) m.set(mesh, name);
      return m;
    });
    reverse.catch(() => (reverse = undefined));
    return reverse;
  };

  return {
    async covers(caseId, mesh) {
      return (await hazardCell(caseId, mesh)) !== 'outside';
    },
    hazardCell,
    async hazardFor(caseId, meshes) {
      const covered = await coverageOf(caseId);
      const out: Record<string, HazardCell> = {};
      await Promise.all(
        meshes.map(async (mesh) => {
          if (!covered.has(mesh2Of(mesh))) return;
          const row = rowOf(await hazardFile(caseId, mesh), mesh);
          const cell = row ? toCell(row) : null;
          if (cell && cell.intensity !== null) out[mesh] = cell;
        }),
      );
      return out;
    },
    async stockFor(meshes) {
      const out: Record<string, BuildingStock> = {};
      await Promise.all(
        meshes.map(async (mesh) => {
          const s = (await stockFile(mesh))?.[mesh];
          if (s) out[mesh] = s;
        }),
      );
      return out;
    },
    async municipalityOf(mesh) {
      return (await municipalities()).get(mesh) ?? null;
    },
    async sheltersNear(pos, radiusM) {
      // 2次メッシュ = 緯度5分(1/12°) × 経度7.5分(1/8°)。中心座標から±1段ずつずらして隣接8つを得る。
      const center = meshCenter2(latLonToMesh250(pos));
      const codes = new Set<string>();
      for (const dLat of [-1, 0, 1])
        for (const dLon of [-1, 0, 1])
          codes.add(mesh2Of(latLonToMesh250({ lat: center.lat + dLat / 12, lon: center.lon + dLon / 8 })));
      const files = await Promise.all([...codes].map((c) => load<Shelter[]>(`${base}/shelters/${c}.json`)));
      return files.flatMap((f) => f ?? []).filter((s) => distanceM(pos, s.pos) <= radiusM);
    },
    async tsunamiArrival(muni) {
      const table = await load<Record<string, unknown>>(`${base}/tsunami_arrival.json`);
      if (!table || typeof table !== 'object' || !Object.hasOwn(table, muni)) return null;
      const v = table[muni];
      return isArrival(v) ? { min: v.min, cm: v.cm } : null;
    },
    async manifest() {
      const m = await load<Manifest>(`${base}/manifest.json`);
      if (!m) throw new Error(`${base}/manifest.json not found`);
      return m;
    },
  };
}
