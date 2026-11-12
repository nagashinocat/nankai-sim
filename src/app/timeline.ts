/**
 * 「▶ 地震から津波までを再生」の筋書き（DOM なし・計算は変えない）。
 * 画面に出している値（自宅の結果・自宅の津波・避難場所リストの徒歩時間）だけから、場面と時刻（分）を組み立てる。
 */
import { EVAC_START_MIN, reachBeforeTsunami } from '../core/evacuation.ts';
import { arrivalHeightText, type EvacVM, type TsunamiVM } from './viewmodel.ts';
import { maxIntensity, splitIntensity, tsunamiPictureVM } from './visuals.ts';
import type { Scenario, ScenarioHome } from './scenario.ts';

export type SceneKind = 'shake' | 'gap' | 'evac' | 'arrival' | 'water' | 'end';

export type Scene = {
  kind: SceneKind;
  /** 場面の名前（場面の一覧に出す） */
  title: string;
  caption: string;
  /** phases の何番目か */
  phase: number;
  /** その段階の時計での開始（分）。時計の無い段階（gap・water・end）は null */
  atMin: number | null;
};

export type Walk = { startMin: number; endMin: number; walkMin: number; shelter: string; hazard: 'earthquake' | 'tsunami' };

export type TimedPhase = {
  type: 'timed';
  /** 時計の前の言葉（「地震発生から」など） */
  clockLabel: string;
  endMin: number;
  /** 揺れの震度（「震度6強」）。わからなければ null */
  intensity: string | null;
  /** 揺れの長さ（分） */
  shakeEndMin: number;
  walk: Walk | null;
  /** 避難先（徒歩の時間が読めないときも出す）。避難場所が無いときは null */
  shelter: { name: string; hazard: 'earthquake' | 'tsunami' } | null;
  /** 避難場所リストの判定で「間に合わないおそれ」: 人は到達時刻の位置で止める（避難場所に着いた絵にしない） */
  late: boolean;
  /** 海岸への到達（分）。到達時間がわからない・5分以内（数え下ろさない）ときと、津波の場面の無い段階は null */
  arrivalMin: number | null;
};
export type HoldPhase = { type: 'hold'; kind: 'gap' | 'water'; seconds: number };
export type EndPhase = { type: 'end' };
export type Phase = TimedPhase | HoldPhase | EndPhase;

export type EndCard = {
  /** 「避難場所に着く：約X分（揺れが収まってから歩いた場合）」。避難場所が無いときは null */
  walk: { min: number; text: string } | null;
  /** 「海岸に津波：最短約Y分」。到達時間で数え下ろさないときは null */
  arrival: { min: number; text: string } | null;
  /** 到達時間がわからない・とても早いとき（band / nearby） */
  arrivalUnknown: string | null;
  /** 避難場所リストの判定（reachBeforeTsunami）が no のとき（赤） */
  late: string | null;
  /** 同じ判定が tight のとき（黄） */
  tight: string | null;
  /** 判定できない（unknown）のとき */
  unknown: string | null;
  /** 避難場所はあるが徒歩の時間が読めないとき */
  walkUnknown: string | null;
  /** 想定の浸水域外（none）のとき */
  outside: string | null;
  noShelter: string | null;
  strong: string;
  note: string;
};

export type Timeline = {
  phases: Phase[];
  scenes: Scene[];
  /** 時計の速さ（再生1秒あたりの想定の秒数） */
  speed: number;
  /** 津波の種類（絵を描くため） */
  tsunami: TsunamiVM;
  end: EndCard;
};

export type TimelineInput = {
  scenario: Scenario;
  home: ScenarioHome;
  /** 自宅の場所の津波（homeTsunamiVM。arrivalMin を持つ） */
  tsunami: TsunamiVM;
  evac: EvacVM[];
};

export const SHAKE_MIN = 3;
/** 再生の長さの上限の目安（秒）。時計の速さはこれに収まるように決める */
export const TIMED_BUDGET_SEC = 72;
export const MIN_SPEED = 15;
export const GAP_SECONDS = 5;
export const WATER_SECONDS = 6;

export const PLAYER_TEXT = {
  open: '▶ 地震から津波までを再生',
  shakeTitle: '揺れ',
  shake: '強い揺れが長く続きます（南海トラフでは数分）。まず身を守る',
  firstShakeTitle: '先発の地震の揺れ',
  secondShakeTitle: '後発の地震の揺れ',
  gapTitle: '後発の地震まで',
  gap: '後発の地震：数時間後〜数年後かもしれません（わからない）',
  evacTitle: '避難',
  evac: '揺れが収まったらすぐ高い所へ',
  urgent: '到達時間がわからない／とても早い：揺れが収まったらすぐ',
  arrivalTitle: '津波が海岸に',
  waterTitle: '浸水',
  endTitle: 'まとめ',
  outside: '想定の浸水域外ですが、想定を超える津波もあり得ます',
  late: '間に合わないおそれ：近くの高い建物（津波避難ビル）や高台へ',
  earlyAdvice: '津波がとても早く着くおそれ：遠くの避難場所より、近くの高い建物（津波避難ビル）や高台へ',
  tight: 'ぎりぎり：迷わずすぐ。より近い高い場所も考えて',
  unknown: 'この場所の津波の想定を判定できませんでした。海の近くでは強い揺れを感じたらすぐ高い所へ',
  walkUnknown: '徒歩の時間がわかりません',
  diagram: '模式図（位置や距離は実際と異なります）',
  firstEvacTitle: '先発の地震のあと',
  firstEvac: '先発の地震でも津波が来ることがあります。揺れが収まったらすぐ高い所へ（この再現では津波を後発の地震でまとめて示しています）',
  strong: '到達時間を待たずに、すぐ高い所へ',
  note: 'これは想定をもとにした目安の再現です',
  noShelter: '近くに該当する避難場所のデータがありません',
  nearbyLabel: '近く（自宅の地点は浸水域外）',
} as const;

/** 「約12分」→ 12。読めなければ null。 */
export function parseWalkMin(s: string): number | null {
  const m = /約(\d+)分/.exec(s);
  return m ? Number(m[1]) : null;
}

/** 到達の場面の文言。高さが 30cm より高いときだけ「— これより低い津波は…」を足す。 */
export function arrivalCaption(min: number, cm: number | null): string {
  const h = cm !== null && Number.isFinite(cm) ? `（${arrivalHeightText(cm)}）` : '';
  const dash = cm !== null && cm > 30 ? '— これより低い津波はもっと早く着くことがあります' : '';
  return `最短約${Math.round(min)}分で海岸に津波${h}${dash}`;
}

function waterCaption(t: TsunamiVM): string {
  const pic = tsunamiPictureVM(t);
  if (t.kind === 'nearby') return `${PLAYER_TEXT.nearbyLabel}の浸水（想定 ${t.depth}${pic ? `・${pic.phrase}` : ''}）`;
  if (t.kind === 'band') return `自宅のあたりの浸水（想定 ${t.depth}${pic ? `・${pic.phrase}` : ''}）`;
  return '';
}

/** 震度の行から、1回目・2回目の震度（時間差は2つ。ほかは強いほう1つ）。 */
function intensities(home: ScenarioHome, lag: boolean): [string | null, string | null] {
  if (home.status !== 'ok') return [null, null];
  if (lag) {
    const s = splitIntensity(home.intensityLabel).filter((x) => x.intensity).map((x) => x.text);
    return [s[0] ?? null, s[1] ?? s[0] ?? null];
  }
  const m = maxIntensity(home.intensityLabel);
  return [m, m];
}

export function buildTimeline(input: TimelineInput): Timeline {
  const { tsunami: t } = input;
  const lag = input.scenario === 'LAG_EW' || input.scenario === 'LAG_WE';
  const water = t.kind === 'band' || t.kind === 'nearby';
  const [i1, i2] = intensities(input.home, lag);

  // 避難先: 浸水域内・近くなら津波の避難場所、ほかは地震の避難場所。徒歩は判定と同じ「ゆっくり」の分（画面の表示と同じ数）
  const list = input.evac.find((e) => e.hazard === (water ? 'tsunami' : 'earthquake'));
  const first = list?.items[0];
  const walkMin = first ? parseWalkMin(first.walkSlow) : null;
  const walk: Walk | null = first && walkMin !== null
    ? { startMin: EVAC_START_MIN, endMin: EVAC_START_MIN + walkMin, walkMin, shelter: first.name, hazard: water ? 'tsunami' : 'earthquake' }
    : null;

  const rawArrival = water && typeof t.arrivalMin === 'number' && Number.isFinite(t.arrivalMin) ? t.arrivalMin : null;
  // 到達時間がわからない・5分以内は数え下ろさない（避難場所リストの n/a と同じ）
  const countdown = water && rawArrival !== null && reachBeforeTsunami(0, rawArrival) !== 'n/a';
  const arrivalMin = countdown ? rawArrival : null;
  const cm = input.evac.find((e) => e.hazard === 'tsunami')?.arrivalCm ?? null;
  const shelter = first ? { name: first.name, hazard: (water ? 'tsunami' : 'earthquake') as 'earthquake' | 'tsunami' } : null;
  // 避難場所リストと同じ判定（ゆっくり歩く＋避難開始5分を、丸めない到達時間と比べる）
  const reach = walk && arrivalMin !== null ? reachBeforeTsunami(walk.walkMin, arrivalMin) : null;
  const late = reach === 'no';

  const phases: Phase[] = [];
  const scenes: Scene[] = [];

  if (lag) {
    phases.push({ type: 'timed', clockLabel: '先発の地震から', endMin: EVAC_START_MIN + 1, intensity: i1, shakeEndMin: SHAKE_MIN, walk: null, shelter: null, late: false, arrivalMin: null });
    scenes.push({ kind: 'shake', title: PLAYER_TEXT.firstShakeTitle, caption: PLAYER_TEXT.shake, phase: 0, atMin: 0 });
    // 先発の地震でも津波は来うる（波は時計で描かない。津波は後発の段階でまとめて示す）
    scenes.push({ kind: 'evac', title: PLAYER_TEXT.firstEvacTitle, caption: PLAYER_TEXT.firstEvac, phase: 0, atMin: EVAC_START_MIN });
    phases.push({ type: 'hold', kind: 'gap', seconds: GAP_SECONDS });
    scenes.push({ kind: 'gap', title: PLAYER_TEXT.gapTitle, caption: PLAYER_TEXT.gap, phase: phases.length - 1, atMin: null });
  }
  const main = phases.length;
  // 間に合わないおそれのときは、着く時刻まで歩かせない（到達で止める）
  const endMin = Math.max(EVAC_START_MIN + 1, walk && !late ? walk.endMin + 0.5 : 0, arrivalMin !== null ? arrivalMin + 0.5 : 0);
  phases.push({ type: 'timed', clockLabel: lag ? '後発の地震発生から' : '地震発生から', endMin, intensity: lag ? i2 : i1, shakeEndMin: SHAKE_MIN, walk, shelter, late, arrivalMin });
  scenes.push({ kind: 'shake', title: lag ? PLAYER_TEXT.secondShakeTitle : PLAYER_TEXT.shakeTitle, caption: PLAYER_TEXT.shake, phase: main, atMin: 0 });
  scenes.push({
    kind: 'evac', title: PLAYER_TEXT.evacTitle,
    caption: water && !countdown ? PLAYER_TEXT.urgent : PLAYER_TEXT.evac,
    phase: main, atMin: EVAC_START_MIN,
  });
  if (arrivalMin !== null) scenes.push({ kind: 'arrival', title: PLAYER_TEXT.arrivalTitle, caption: arrivalCaption(arrivalMin, cm), phase: main, atMin: arrivalMin });
  // 浸水は時計を止めて見せる（家のところに水が来る時刻はデータに無いため）
  if (water) {
    phases.push({ type: 'hold', kind: 'water', seconds: WATER_SECONDS });
    scenes.push({ kind: 'water', title: PLAYER_TEXT.waterTitle, caption: waterCaption(t), phase: phases.length - 1, atMin: null });
  }
  phases.push({ type: 'end' });

  const X = walk ? EVAC_START_MIN + walk.walkMin : null;
  const Y = arrivalMin !== null ? Math.round(arrivalMin) : null;
  const end: EndCard = {
    walk: X !== null ? { min: X, text: `避難場所に着く：約${X}分（揺れが収まってから歩いた場合）` } : null,
    arrival: Y !== null ? { min: Y, text: `海岸に津波：最短約${Y}分` } : null,
    arrivalUnknown: water && !countdown ? `海岸に津波：${PLAYER_TEXT.urgent}` : null,
    late: late ? PLAYER_TEXT.late : water && !countdown ? PLAYER_TEXT.earlyAdvice : null,
    tight: reach === 'tight' ? PLAYER_TEXT.tight : null,
    unknown: t.kind === 'unknown' ? PLAYER_TEXT.unknown : null,
    walkUnknown: shelter && !walk ? PLAYER_TEXT.walkUnknown : null,
    outside: t.kind === 'none' ? PLAYER_TEXT.outside : null,
    noShelter: shelter ? null : PLAYER_TEXT.noShelter,
    strong: PLAYER_TEXT.strong,
    note: PLAYER_TEXT.note,
  };
  // まとめの文（強い一言など）は下のまとめの札に出す。ここは何の札かだけ
  const endCaption = end.walk && end.arrival ? '避難場所に着く時間と、海岸に津波が着く時間のくらべ' : 'まとめ';
  scenes.push({ kind: 'end', title: PLAYER_TEXT.endTitle, caption: endCaption, phase: phases.length - 1, atMin: null });

  const simSec = phases.reduce((s, p) => s + (p.type === 'timed' ? p.endMin * 60 : 0), 0);
  const speed = Math.max(MIN_SPEED, Math.ceil(simSec / TIMED_BUDGET_SEC));
  return { phases, scenes, speed, tsunami: t, end };
}

/** 再生の長さ（秒。end の前まで）。 */
export function realDurationSec(tl: Timeline): number {
  return tl.phases.reduce((s, p) => s + (p.type === 'timed' ? (p.endMin * 60) / tl.speed : p.type === 'hold' ? p.seconds : 0), 0);
}

/** 「地震発生から 0分00秒」 */
export function clockText(label: string, min: number): string {
  const total = Math.max(0, Math.floor(min * 60 + 1e-6));
  return `${label} ${Math.floor(total / 60)}分${String(total % 60).padStart(2, '0')}秒`;
}

/** その段階の時刻 t（分）での場面（scenes の番号）。 */
export function sceneAt(tl: Timeline, phase: number, t: number): number {
  let idx = -1;
  tl.scenes.forEach((s, i) => {
    if (s.phase === phase && (s.atMin === null || s.atMin <= t + 1e-9)) idx = i;
  });
  return idx;
}
