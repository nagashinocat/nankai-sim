import type { Era, Rates, Structure } from './types.ts';

/** [x, 全壊率, 全壊+半壊率]。x は 計測震度 / 地盤沈下量(cm) / 浸水深(m)。 */
export type Point = [number, number, number];
export type Curve = Point[];

/** 曲線族（揺れ・液状化・津波）の 1 構造グループ。classes のキーは出典の区分名をそのまま使う。 */
export type FragilityGroup = {
  classes: Record<string, Curve>;
  /** 本アプリの 3 年代 → 出典クラス名。省略時は全クラスが全年代に対応（津波など）。 */
  eraMap?: Record<Era, string[]>;
};

export type FragilityFamily<G extends string> = {
  source: string;
  page: string;
  /** 転記方法。'図読み取り' は公式グラフからの読み取り。 */
  method: string;
  groups: Partial<Record<G, FragilityGroup>>;
};

export type FragilityTable = {
  source: string;
  /** 例: 年代区分の境界が 2000 / 2001-02 でずれる点、保守的な包絡であること。 */
  notes?: string;
  shake: FragilityFamily<'wood' | 'steel' | 'rc'>;
  liquefaction: FragilityFamily<'wood' | 'nonwood'>;
  tsunami: FragilityFamily<'wood' | 'nonwood'>;
};

export class FragilityDataMissingError extends Error {
  constructor(message = '被害関数の表が未登録です。useFragilityTable() で登録してください。') {
    super(message);
    this.name = 'FragilityDataMissingError';
  }
}

const ERAS: Era[] = ['pre1981', 'y1981_2000', 'post2000'];

export function validateFragilityTable(t: FragilityTable): string[] {
  const errs: string[] = [];
  const families = { shake: t.shake, liquefaction: t.liquefaction, tsunami: t.tsunami };
  for (const [fname, fam] of Object.entries(families)) {
    if (!fam || !fam.groups) { errs.push(`${fname}: 定義がありません`); continue; }
    if (!fam.source || !fam.page || !fam.method) errs.push(`${fname}: source/page/method が必要です`);
    for (const [gname, g] of Object.entries(fam.groups)) {
      const where = `${fname}.${gname}`;
      if (!g) continue;
      const names = Object.keys(g.classes);
      if (names.length === 0) errs.push(`${where}: クラスがありません`);
      for (const [cname, curve] of Object.entries(g.classes)) {
        const w = `${where}.${cname}`;
        if (curve.length < 2) errs.push(`${w}: 点が 2 つ未満です`);
        curve.forEach(([x, c, tot], i) => {
          if (![x, c, tot].every(Number.isFinite)) errs.push(`${w}[${i}]: 数値ではありません`);
          if (i > 0 && x < curve[i - 1]![0]) errs.push(`${w}[${i}]: x が単調非減少ではありません`);
          if (!(c >= 0 && c <= tot && tot <= 1)) errs.push(`${w}[${i}]: 0 <= 全壊率 <= 全壊+半壊率 <= 1 を満たしません`);
        });
      }
      if (g.eraMap) {
        for (const e of ERAS) {
          const ks = g.eraMap[e];
          if (!ks || ks.length === 0) errs.push(`${where}.eraMap.${e}: クラスがありません`);
          else for (const k of ks) if (!(k in g.classes)) errs.push(`${where}.eraMap.${e}: 存在しないクラス ${k}`);
        }
      }
    }
  }
  for (const [fname, keys] of [['shake', ['wood', 'steel', 'rc']], ['liquefaction', ['wood', 'nonwood']], ['tsunami', ['wood', 'nonwood']]] as const) {
    for (const k of keys) if (!(families[fname].groups as Record<string, unknown>)[k]) errs.push(`${fname}.${k}: グループがありません`);
  }
  return errs;
}

let current: FragilityTable | null = null;

/** 検証に通った表を登録する。失敗時は例外を投げ、直前の登録は変更しない。 */
export function useFragilityTable(table: FragilityTable): void {
  const errs = validateFragilityTable(table);
  if (errs.length > 0) throw new Error(`被害関数の表が不正です:\n${errs.join('\n')}`);
  current = table;
}

/** テスト用。登録を解除する。 */
export function clearFragilityTable(): void {
  current = null;
}

function table(): FragilityTable {
  if (!current) throw new FragilityDataMissingError();
  return current;
}

/** 端は固定、間は線形補間。戻り値は [全壊率, 全壊+半壊率]。 */
function interpolate(curve: Curve, x: number): [number, number] {
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (x <= first[0]) return [first[1], first[2]];
  if (x >= last[0]) return [last[1], last[2]];
  let i = 1;
  while (curve[i]![0] < x) i++;
  const a = curve[i - 1]!;
  const b = curve[i]!;
  const dx = b[0] - a[0];
  if (dx === 0) return [b[1], b[2]];
  const f = (x - a[0]) / dx;
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 対応クラスの全壊率・全壊+半壊率それぞれの最大値（保守的な包絡）。half = 全壊+半壊 − 全壊。 */
function envelope(g: FragilityGroup, e: Era | null, x: number): Rates {
  const names = e && g.eraMap ? g.eraMap[e] : Object.keys(g.classes);
  let collapse = 0;
  let total = 0;
  for (const n of names) {
    const [c, t] = interpolate(g.classes[n]!, x);
    if (c > collapse) collapse = c;
    if (t > total) total = t;
  }
  return { collapse, half: Math.max(0, total - collapse) };
}

function group<G extends string>(fam: FragilityFamily<G>, key: G, label: string): FragilityGroup {
  const g = fam.groups[key];
  if (!g) throw new FragilityDataMissingError(`${label}.${key} の被害関数が未登録です。`);
  return g;
}

const nonwood = (s: Structure): 'wood' | 'nonwood' => (s === 'wood' ? 'wood' : 'nonwood');

/** 揺れ。intensity は計測震度。 */
export function shakeRates(intensity: number, s: Structure, e: Era): Rates {
  const t = table();
  return envelope(group(t.shake, s, 'shake'), e, intensity);
}

/** 液状化。settlementCm は液状化による地盤沈下量(cm)。steel/rc は非木造の曲線を使う。 */
export function liquefactionRates(settlementCm: number, s: Structure, e: Era): Rates {
  const t = table();
  return envelope(group(t.liquefaction, nonwood(s), 'liquefaction'), e, settlementCm);
}

/** 津波。depthM は浸水深(m)。人口集中地区／それ以外の最大値。steel/rc は非木造の曲線を使う。 */
export function tsunamiRates(depthM: number, s: Structure): Rates {
  const t = table();
  return envelope(group(t.tsunami, nonwood(s), 'tsunami'), null, depthM);
}
