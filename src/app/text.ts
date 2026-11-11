import type { RangeVM } from './viewmodel.ts';

export const CASE_NAME = '最大クラス（国の想定）';

/** 共有文面。市町名・ケース・自宅の代表値と幅だけ。住所・座標は入れない（裁定 W2）。 */
export function buildShareText(municipality: string | null, collapse: RangeVM, half: RangeVM): string {
  const place = municipality ?? 'この地域';
  return [
    `南海トラフ地震（${CASE_NAME}）の想定で、${place}の自宅の被害の目安です。`,
    `全壊 代表値${collapse.central}（幅 ${collapse.min}〜${collapse.max}）／半壊 代表値${half.central}（幅 ${half.min}〜${half.max}）`,
    'これは耐震診断ではなく、統計的な目安です。',
  ].join('\n');
}

/** 結果の上の方に必ず出す（final review C2・裁定 F2）。 */
export const TSUNAMI_NOTICE = 'この結果に津波の被害は含まれていません。海の近くで強い揺れを感じたら、すぐに高い所へ避難してください';

/** 対応範囲外（想定データの index.json に無い2次メッシュ）。「揺れが小さい」とは決して言わない（裁定 F1）。 */
export const OUTSIDE_TITLE = 'この地域はまだ対応していません';
export const OUTSIDE_DETAIL = '現在は三重県の想定データだけを使っています。お住まいの地域の想定は、市町のハザードマップや、次のハザードマップポータルサイトで確認してください。';
export const HAZARD_PORTAL = { url: 'https://disaportal.gsi.go.jp/', label: 'ハザードマップポータルサイト（国土地理院）' } as const;
