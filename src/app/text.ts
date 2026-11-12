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

/** 対応範囲外（250m メッシュの四角が4県の陸と重ならない。想定データに行が無い。Ruling F1・F4）。「揺れが小さい」とは決して言わない（裁定 F1）。 */
export const OUTSIDE_TITLE = 'この地域はまだ対応していません';
export const OUTSIDE_DETAIL = '現在は静岡県・愛知県・岐阜県・三重県の想定データを使っています。お住まいの地域の想定は、市町村のハザードマップや、次のハザードマップポータルサイトで確認してください。';
export const HAZARD_PORTAL = { url: 'https://disaportal.gsi.go.jp/', label: 'ハザードマップポータルサイト（国土地理院）' } as const;

/** 津波の浸水想定（Global Constraints の文言）。 */
export const TSUNAMI_OUTSIDE = '想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ';
/** 浸水域内（または約50m以内）のときに必ず出す強い一文（Ruling F2）。 */
export const TSUNAMI_INUNDATED_STRONG = '浸水が想定される場所です。強い揺れや長い揺れを感じたら、到達時間を待たずにすぐ高い所へ避難してください';
/** 中心は浸水域外だが約50m以内に浸水がある（Ruling F3）。depth は段階の表記（例「1〜3m」）。 */
export const tsunamiNearbyText = (depth: string) => `すぐ近く（約50m以内）まで浸水が想定されています（最大 ${depth}）`;
export const TSUNAMI_ARRIVAL_NOTE = '到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください';
export const TSUNAMI_ATTRIBUTION = '出典：ハザードマップポータルサイト（津波浸水想定：各都道府県）。浸水深の段階はタイルの色から本アプリが判定（加工して作成）。最新・詳細はお住まいの市町村のハザードマップをご確認ください';
/** 地図右下の短い表示（全文は地図の下に出す）。 */
export const TSUNAMI_CREDIT_SHORT = 'ハザードマップポータルサイト';
