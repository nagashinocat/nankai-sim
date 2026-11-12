/** 一部割れ練習モードの場面。文言は計画書（docs/superpowers/plans/2026-11-12-practice-mode.md）のとおり。増やさない。 */
export type Scene = { day: string; situation?: string; question: string; choices: { text: string; best: boolean }[]; explanation: string };

export const PRACTICE_TITLE = '練習モード：南海トラフ地震臨時情報（巨大地震注意）';
export const PRACTICE_ENTRY = '臨時情報が出たら？ 1週間の練習';
export const PRACTICE_NOTICE =
  'これは練習です。臨時情報は地震の予知ではなく、発表されても実際に地震が起きるかはわかりません。実際に発表されたときは、テレビ・ラジオ・自治体の情報に従ってください';

const c = (text: string, best = false) => ({ text, best });

export const SCENES: Scene[] = [
  {
    day: '0日目 夜',
    situation: '南海トラフ沿いでM7クラスの地震が起き、『南海トラフ地震臨時情報（巨大地震注意）』が発表されました。あなたの住む地域では大きな被害はありません',
    question: '今夜、どうしますか？',
    choices: [c('すぐ逃げられる服装で寝て、非常持出品を枕元に置く', true), c('念のため家族全員で避難所に泊まりに行く'), c('いつもどおりパジャマで寝る')],
    explanation: '巨大地震注意では事前の避難は求められません。日頃の備えを確かめ、すぐ逃げられる態勢をとったうえで、普段の生活を続けます',
  },
  {
    day: '1日目 朝',
    question: '仕事や学校はどうしますか？',
    choices: [c('普段どおり行くが、非常持出品を持ち歩く', true), c('1週間は家から出ない'), c('何も持たずに普段どおり行く')],
    explanation: '社会経済活動は続けます。そのうえで、非常持出品を常に持ち歩くなどの『特別な備え』をします',
  },
  {
    day: '2日目',
    question: '家の中で確かめておくことは？',
    choices: [c('避難場所と避難経路、家族との連絡方法、家具の固定、備蓄を確かめる', true), c('水と食料を大量に買い足す'), c('特に何もしない')],
    explanation: '日頃からの備えの再確認が呼びかけられます：避難場所・避難経路の確認、家族との連絡手段の確認、家具等の固定、非常食などの備蓄の確認',
  },
  {
    day: '3日目 夜',
    question: 'どの部屋で寝ますか？',
    choices: [c('倒れてくる家具がない、なるべく安全な部屋', true), c('いつもの部屋（たんすの横）'), c('車の中')],
    explanation: '屋内のできるだけ安全な場所で過ごし、寝るときもすぐ逃げられるようにします',
  },
  {
    day: '5日目',
    situation: 'SNSで『今週中に必ず巨大地震が来る』という投稿が広まっています',
    question: 'どうしますか？',
    choices: [c('気象庁や自治体の情報を確かめ、むやみに広めない', true), c('家族や友人にすぐ転送する'), c('怖いので情報を見ないようにする')],
    explanation: '臨時情報は地震の予知ではありません。公式の情報を確かめましょう',
  },
  {
    day: '7日目',
    situation: '地震発生から1週間が過ぎ、特別な注意の呼びかけが終わりました',
    question: 'これからは？',
    choices: [c('普段の生活に戻るが、地震の可能性がなくなったわけではないので備えは続ける', true), c('もう大きな地震は来ないので、非常持出品を片づける'), c('念のためあと1か月は家から出ない')],
    explanation: '呼びかけは1週間（地震発生から168時間経過した以降の正時まで）です。終わっても大規模地震の可能性がなくなったわけではありません',
  },
];

export const SUMMARY_WARNING =
  '『巨大地震警戒』が出た場合は、地震が起きてからの避難では間に合わないおそれのある地域で、1週間の事前避難が求められます。お住まいの地域が対象かは市町村に確認してください';
export const TSUNAMI_URGENT_LINE =
  'あなたの家は津波の到達が早い／浸水が想定される場所です。『巨大地震警戒』のときに事前避難の対象になっていないか、市町村に確認してください';
export const TSUNAMI_UNKNOWN_LINE = '津波の想定を確かめられませんでした。お住まいの市町村のハザードマップで確認してください';
export const SHAKE_LINE = '揺れへの備え（家具の固定・耐震）を確かめておきましょう';

export const PRACTICE_SOURCES = [
  { label: '内閣府「南海トラフ地震臨時情報（巨大地震注意）」資料', url: 'https://www.bousai.go.jp/jishin/nankai/rinji/pdf/r8pdf03.pdf' },
  { label: '気象庁 南海トラフ地震臨時情報の発表条件', url: 'https://www.jma.go.jp/jma/kishou/know/jishin/nteq/info_criterion.html' },
];

export type PracticeHome = { urgentTsunami: boolean; tsunamiUnknown: boolean };

export function summaryLines(score: number, home: PracticeHome | null): string[] {
  return [
    `最適な行動を選べた数：${SCENES.length}問中 ${score}問`,
    SUMMARY_WARNING,
    ...(home ? [home.urgentTsunami ? TSUNAMI_URGENT_LINE : home.tsunamiUnknown ? TSUNAMI_UNKNOWN_LINE : SHAKE_LINE] : []),
  ];
}

/** 津波の段階あり（自宅または約50m以内）、または海岸への到達が10分以内。 */
export function isUrgentTsunami(kind: 'band' | 'nearby' | 'none' | 'unknown', arrivalMin: number | null): boolean {
  if (kind === 'band' || kind === 'nearby') return true;
  return arrivalMin !== null && Number.isFinite(arrivalMin) && arrivalMin <= 10;
}
