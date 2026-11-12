/**
 * こどもモードの文言（DOM なし・計算は変えない）。小学1〜3年向け: ひらがなと分かち書き。
 * 漢字は ruby で読みを付ける（RubyPart の rt）。おとなの画面の文言・保存・共有の文面は変えない。
 */
import type { Scenario } from './scenario.ts';
import type { TsunamiVM } from './viewmodel.ts';
import { intensityLevel, splitIntensity, tenHouses, tsunamiMid, type IntensityLevel } from './visuals.ts';
import type { Scene, Timeline } from './timeline.ts';

/** こども / おとな の切り替え（'1' = こども、'0' = おとな）。 */
export const KIDS_KEY = 'nankai-sim:ui:kids';

export function loadKids(store: Pick<Storage, 'getItem'> | null): boolean {
  try { return store?.getItem(KIDS_KEY) === '1'; } catch { return false; }
}
export function saveKids(store: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try { store?.setItem(KIDS_KEY, on ? '1' : '0'); } catch { /* 保存できなくても切り替えは効く */ }
}

/** 文字と読み（漢字の部分だけ rt を持つ）。 */
export type RubyPart = { text: string; rt?: string };

export const KIDS_TEXT = {
  inputNote: 'おうちの ひとと いっしょに いれてね',
  title: 'なんかいトラフ じしんの そなえ',
  disclaimer: 'これは よそう（めやす）です。ほんとうに こう なる とは かぎりません。',
  intro: 'もし おおきな じしんが きたら…',
  noData: 'ここの よそうは ないよ。おうちの ひとと『おとな』で みてね',
  loading: 'よみこんで いるよ…',
  houseTitle: '2. いえは どうなる？',
  houseLead: 'おなじような いえが 10けん あったら…',
  houseTip: 'じょうぶな いえに すると、こわれる いえは へらせます。おうちの ひとと はなして みよう。',
  tsunamiTitle: '3. つなみ',
  shakeTitle: '1. ゆれの つよさ',
  doTitle: 'じしんの とき、こうする！',
  nearby: 'いえの ちかくまで みずが くる かも',
  tsunamiNone: 'ここは みずが こない よそう。でも、よそうより おおきい つなみが くる ことも あるよ。うみの ちかくで つよく ゆれたら、たかい ところへ',
  outside: 'ここは この アプリの はんいの そとだよ。おうちの ひとと『おとな』で みてね',
  error: 'よみこめなかったよ。もう いちど ためしてね',
  retry: 'もう いちど よみこむ',
  earlier: 'もっと はやく くる ことも あるよ',
  tsunamiUnknown: 'みずが くるか わからない。うみの ちかくなら、たかい ところへ',
  bandHint: 'うすい あお＝ここまで くるかも',
  player: 'うごきで みて みよう',
  family: 'かぞくの きまりを みる',
  mapLink: 'おとなの がめんで ちずを みる',
  closing: ['しって いれば、まもれる。', 'おうちの ひとと いっしょに みてね。'],
  diagram: 'もしきず（ほんとうの きょりとは ちがいます）',
  weak: 'よわい',
  strong: 'つよい',
} as const;

/** タブの名前（こども）。 */
export const KIDS_TAB_LABELS: Record<Scenario, string> = {
  L2: 'いちばん おおきい じしん',
  HALF_E: 'ひがしがわ だけ',
  HALF_W: 'にしがわ だけ',
  LAG_EW: '2かいに わけて（ひがし→にし）',
  LAG_WE: '2かいに わけて（にし→ひがし）',
};

/** 7だんかいの ゆれメーター（1 = 震度3以下 … 7 = 震度7）。 */
export function intensityStep(label: string): number {
  if (label === '震度3以下') return 1;
  if (label === '震度4') return 2;
  return ({ '5-': 3, '5+': 4, '6-': 5, '6+': 6, '7': 7 } as Record<IntensityLevel, number>)[intensityLevel(label)] ?? 1;
}

export type Face = 'calm' | 'worried' | 'distressed';
export function intensityFace(label: string): Face {
  const s = intensityStep(label);
  return s <= 2 ? 'calm' : s <= 4 ? 'worried' : 'distressed';
}

/** 震度ごとの ことば。 */
export function intensityPhrase(label: string): string {
  switch (intensityStep(label)) {
    case 3: return 'たなの ものが おちる ことも';
    case 4: return 'あるくのが むずかしい';
    case 5: return 'たって いるのが むずかしい';
    case 6: return 'たって いられない。はって うごくのも むずかしい';
    case 7: return 'たって いられない。からだが とばされる ことも';
    default: return 'ものが ゆれて おどろく';
  }
}

/** 「震度6強」→ 震度(しんど) 6 強(きょう)。 */
export function intensityRuby(label: string): RubyPart[] {
  const m = /^震度(\d)(強|弱|以下)?$/.exec(label);
  if (!m) return [{ text: label }];
  const rt: Record<string, string> = { 強: 'きょう', 弱: 'じゃく', 以下: 'いか' };
  return [{ text: '震度', rt: 'しんど' }, { text: ` ${m[1]}` }, ...(m[2] ? [{ text: m[2], rt: rt[m[2]] }] : [])];
}

/** 読み上げ用（ひらがな）。 */
export function intensityReading(label: string): string {
  return intensityRuby(label).map((p) => p.rt ?? p.text.trim()).join('');
}

/**
 * ゆれの表示。時間差は強いほう（同じなら2かいめ）と「Nかいめの じしんで」。読めなければ null。
 */
export function kidShake(intensityLabel: string, lag: boolean): { label: string; prefix: string | null; phrase: string; step: number; face: Face } | null {
  const list = splitIntensity(intensityLabel).filter((s) => s.intensity).map((s) => s.text);
  if (list.length === 0) return null;
  let idx = 0;
  list.forEach((l, i) => { if (intensityStep(l) >= intensityStep(list[idx])) idx = i; });
  const label = list[idx];
  return {
    label,
    prefix: lag && list.length > 1 ? `${idx + 1}かいめの じしんで` : null,
    phrase: intensityPhrase(label),
    step: intensityStep(label),
    face: intensityFace(label),
  };
}

/** 数字 + ふん／ぷん（さいごの けたが 1・3・4・6・8・0 は ぷん）。0 は「すぐ」。 */
export function fun(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v === 0) return 'すぐ';
  return `${v}${[1, 3, 4, 6, 8, 0].includes(v % 10) ? 'ぷん' : 'ふん'}`;
}

/** 浸水深（代表値 m）の ことば。 */
export function bandPhrase(mid: number): string {
  if (mid < 0.3) return 'あしくび くらい。それでも ながされる ことが ある';
  if (mid < 0.5) return 'ひざ くらい。おとなでも あるけない';
  if (mid < 1) return 'こしより ふかい';
  if (mid < 3) return 'おとなの せたけより ふかい';
  if (mid < 5) return 'いえの 2かいまで';
  if (mid < 10) return 'やねの ちかくまで';
  return 'いえより たかい';
}

/** 「10けん あったら」の せつめい（おとなの いえの れつと おなじ かず）。 */
export function houseLegend(collapse: number, half: number): { full: number; half: number; fullText: string; halfText: string; restText: string; aria: string } {
  const t = tenHouses(collapse, half);
  const r10 = (x: number) => Math.max(0, Math.round(x * 10 + 1e-9));
  const count = (n: number, rate: number) => (r10(rate) === 0 && rate > 0 ? '1けんより すくない' : `${n}けんくらい`);
  const fc = count(t.full, collapse), hc = count(t.half, half);
  return {
    full: t.full,
    half: t.half,
    fullText: `こわれて すめなくなる … ${fc}`,
    halfText: `かたむいたり ひびが はいる … ${hc}`,
    restText: 'のこり（すこしは こわれるかも）',
    aria: `10けんの うち、こわれて すめなくなる いえ ${fc}、かたむいたり ひびが はいる いえ ${hc}`,
  };
}

/** 到着の ひとこと（band / nearby だけ）。わからない・5ふん いないは「すぐ」。 */
export function arrivalLine(t: TsunamiVM): { soon: boolean; min: number | null; text: string } | null {
  if (t.kind !== 'band' && t.kind !== 'nearby') return null;
  const min = typeof t.arrivalMin === 'number' && Number.isFinite(t.arrivalMin) ? t.arrivalMin : null;
  if (min === null || min <= 5) return { soon: true, min: null, text: 'すぐ くるかも。まって いたら まにあわない！' };
  return { soon: false, min: Math.round(min), text: `はやいと ${fun(min)}で うみに つく。${KIDS_TEXT.earlier}。まって いたら まにあわない！` };
}

/** つなみの ことば。lines は みえる ぶん。 */
export function tsunamiKidText(t: TsunamiVM): { kind: TsunamiVM['kind']; lines: string[] } {
  if (t.kind === 'none') return { kind: 'none', lines: [KIDS_TEXT.tsunamiNone] };
  if (t.kind === 'unknown') return { kind: 'unknown', lines: [KIDS_TEXT.tsunamiUnknown] };
  const mid = tsunamiMid(t);
  const phrase = mid === null ? null : bandPhrase(mid);
  if (t.kind === 'nearby') return { kind: 'nearby', lines: [`${KIDS_TEXT.nearby}。`, ...(phrase ? [`${phrase}。`] : [])] };
  return { kind: 'band', lines: phrase ? [`${phrase}。`] : [] };
}

/** 「1〜3m」→「1から 3メートル」（よみあげ）。 */
export function depthReading(depth: string): string {
  return depth.replace('〜', 'から ').replace(/m未満$/, 'メートルより ひくい').replace(/m以上$/, 'メートルより たかい').replace(/m$/, 'メートル');
}

export type KidCard = { key: 'protect' | 'escape' | 'meet'; small: string; big: string; note: string; red: boolean };

/** やること 3まい。つなみが こない よそう・はんいの そと（generic）の ときは 2まいめを あかに しない。 */
export function kidActions(t: TsunamiVM, generic = false): KidCard[] {
  return [
    { key: 'protect', small: 'ゆれて いる とき', big: 'あたまを まもる', note: 'ひくく なって、つくえの したや ものが おちて こない ところへ', red: false },
    t.kind === 'none' || generic
      ? { key: 'escape', small: 'ゆれが とまったら', big: 'たかい ところへ', note: 'うみの ちかくなら たかい ところへ。くずれた いえには ちかづかない。', red: false }
      : { key: 'escape', small: 'ゆれが とまったら すぐ', big: 'たかい ところへ にげる', note: 'にもつは もたなくて いい。もどらない。', red: true },
    { key: 'meet', small: 'にげた あと', big: 'きめた ばしょで あう', note: 'かぞくと きめた ばしょで まつ', red: false },
  ];
}

// ---- うごきで みる（再生） ----

export const KID_LATE = 'とおくに いく より、ちかくの たかい たてものへ';
export const KID_TIGHT = 'ぎりぎり。まよわず すぐ にげる。ちかくの たかい ところも かんがえて';

export type KidCaption = { small: string; big: string; note: string; red: boolean; title: string; /** note を あかで（まにあわない・ぎりぎり） */ noteRed?: boolean };

/** 場面の ことば（筋書きは buildTimeline のまま）。i は tl.scenes の番号。 */
export function kidSceneCaption(tl: Timeline, i: number): KidCaption {
  const s: Scene | undefined = tl.scenes[i];
  const t = tl.tsunami;
  const lag = tl.scenes.some((x) => x.kind === 'gap');
  const firstPart = lag && s && s.phase === 0;
  const arr = arrivalLine(t);
  const late = !!tl.end.late;
  switch (s?.kind) {
    case 'shake':
      return { title: lag ? (firstPart ? '1かいめの ゆれ' : '2かいめの ゆれ') : 'ゆれ', small: firstPart ? '1かいめの じしん' : lag ? '2かいめの じしん' : 'いま なにを する？', big: 'あたまを まもる', note: 'ひくく なって うごかない。ゆれは ながく つづく ことが あるよ。', red: false };
    case 'evac':
      if (firstPart) return { title: 'にげる', small: 'ゆれが とまったら', big: 'たかい ところへ にげる', note: '1かいめの じしんでも つなみが くる ことが あるよ。ゆれが とまったら たかい ところへ', red: true };
      if (t.kind === 'none') return { title: 'にげる', small: 'ゆれが とまったら', big: 'たかい ところへ', note: 'うみの ちかくなら たかい ところへ。くずれた いえには ちかづかない。', red: false };
      if (late) return { title: 'にげる', small: 'ゆれが とまったら すぐ', big: 'たかい ところへ にげる', note: KID_LATE, red: true, noteRed: true };
      if (tl.end.tight) return { title: 'にげる', small: 'ゆれが とまったら すぐ', big: 'たかい ところへ にげる', note: KID_TIGHT, red: true, noteRed: true };
      return { title: 'にげる', small: 'ゆれが とまったら すぐ', big: 'たかい ところへ にげる', note: 'ちかくの たかい たてものや たかだいへ。にもつは いらない。', red: true };
    case 'gap':
      return { title: 'まつ あいだ', small: 'つぎの じしん', big: 'いつ くるか わからない', note: 'すうじかん あと かも、なんねんも あと かも。', red: false };
    case 'arrival':
      return { title: 'つなみ', small: 'つなみが くるよ', big: 'もどっては だめ', note: `${arr && arr.min !== null ? `はやいと ${fun(arr.min)}で うみに つく。${KIDS_TEXT.earlier}。` : ''}いちど にげたら、つなみが おわるまで もどらない。`, red: true };
    case 'water': {
      const mid = tsunamiMid(t);
      const phrase = mid === null ? '' : `${bandPhrase(mid)}。`;
      return { title: 'みず', small: 'つなみが きたら', big: 'みずが ここまで くる かも', note: t.kind === 'nearby' ? `${KIDS_TEXT.nearby}。${phrase}` : phrase, red: false };
    }
    case 'end':
      return { title: 'あと', small: 'にげた あと', big: 'きめた ばしょで あう', note: 'かぞくと きめた ばしょで まとう。れんらくは 171で。', red: false };
    default:
      return { title: '', small: '', big: '', note: '', red: false };
  }
}

/** まとめの ついか（あか = すぐ にげる）。 */
export function kidEndLines(tl: Timeline): { text: string; red: boolean }[] {
  const e = tl.end;
  return [
    ...(e.late ? [{ text: KID_LATE, red: true }] : []),
    ...(e.tight ? [{ text: KID_TIGHT, red: true }] : []),
    ...(e.outside ? [{ text: KIDS_TEXT.tsunamiNone, red: false }] : []),
    ...(e.unknown ? [{ text: KIDS_TEXT.tsunamiUnknown, red: false }] : []),
  ];
}

/** 時計の ことば。label は「じしんから」など。0ふんは「じしんが おきた ところ」。 */
export function kidClock(label: string, min: number): string {
  const v = Math.floor(min + 1e-6);
  if (v <= 0) return label.replace(/から$/, 'が おきた ところ');
  return `${label} ${fun(v)}`;
}

// ---- かぞくの きまり ----
export const KIDS_EMPTY = 'まだ きまって いないよ。おうちの ひとと きめよう';
export function kidReviewed(d: string | null): string | null {
  if (!d) return null;
  const [y, m, da] = d.split('-').map(Number);
  return `${y}ねん ${m}がつ${da}にち に みなおしたよ`;
}
