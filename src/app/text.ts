import type { RangeVM } from './viewmodel.ts';

export const CASE_NAME = '最大クラス（国の想定）';

/**
 * 共有文面。市町名・ケース・自宅の代表値と幅だけ。住所・座標は入れない（裁定 W2）。
 * scenario を渡すと「南海トラフ地震・東側の半割れの想定で」の形（入れ子の括弧にしない）。時間差は「後発まで含めた合計」と明記する。
 */
export function buildShareText(municipality: string | null, collapse: RangeVM, half: RangeVM, scenario?: { label: string; lagTotal?: boolean }): string {
  const place = municipality ?? 'この地域';
  const head = scenario ? `南海トラフ地震・${scenario.label}` : `南海トラフ地震（${CASE_NAME}）`;
  const figures = `全壊 代表値${collapse.central}（幅 ${collapse.min}〜${collapse.max}）／半壊 代表値${half.central}（幅 ${half.min}〜${half.max}）`;
  return [
    `${head}の想定で、${place}の自宅の被害の目安です。`,
    scenario?.lagTotal ? `後発まで含めた合計：${figures}` : figures,
    'これは耐震診断ではなく、統計的な目安です。',
  ].join('\n');
}

/** 結果の上の方に必ず出す（final review C2・裁定 F2）。 */
export const TSUNAMI_NOTICE = 'この結果に津波の被害は含まれていません。海の近くで強い揺れを感じたら、すぐに高い所へ避難してください';

/** 対応範囲外（250m メッシュの四角が5県の陸と重ならない。想定データに行が無い。Ruling F1・F4）。「揺れが小さい」とは決して言わない（裁定 F1）。 */
export const OUTSIDE_TITLE = 'この地域はまだ対応していません';
export const OUTSIDE_DETAIL = '現在は静岡県・愛知県・岐阜県・三重県・和歌山県の想定データを使っています。お住まいの地域の想定は、市町村のハザードマップや、次のハザードマップポータルサイトで確認してください。';
export const HAZARD_PORTAL = { url: 'https://disaportal.gsi.go.jp/', label: 'ハザードマップポータルサイト（国土地理院）' } as const;

/** 津波の浸水想定（Global Constraints の文言）。 */
export const TSUNAMI_OUTSIDE = '想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ';
/** 浸水域内（または約50m以内）のときに必ず出す強い一文（Ruling F2）。 */
export const TSUNAMI_INUNDATED_STRONG = '浸水が想定される場所です。強い揺れや長い揺れを感じたら、到達時間を待たずにすぐ高い所へ避難してください';
/** 中心は浸水域外だが約50m以内に浸水がある（Ruling F3）。depth は段階の表記（例「1〜3m」）。 */
export const tsunamiNearbyText = (depth: string) => `すぐ近く（約50m以内）まで浸水が想定されています（最大 ${depth}）`;
export const TSUNAMI_ARRIVAL_NOTE = '到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください';
/** 内閣府データの出典（2026-11-12 内閣府回答「出典を明記すれば使用可」）。加工した値であることも示す。 */
export const HAZARD_ATTRIBUTION = '震度・液状化の出典：内閣府 南海トラフの巨大地震モデル・被害想定手法検討会。本アプリが被害の目安に計算し直した値です（加工して作成。内閣府の元データではありません）';
export const TSUNAMI_ATTRIBUTION = '出典：ハザードマップポータルサイト（津波浸水想定：各都道府県）。浸水深の段階はタイルの色から本アプリが判定（加工して作成）。最新・詳細はお住まいの市町村のハザードマップをご確認ください';
/** 地図右下の短い表示（全文は地図の下に出す）。 */
export const TSUNAMI_CREDIT_SHORT = 'ハザードマップポータルサイト';

/** 避難場所データの出典。最終更新日は県ごとに違う（岐阜 2026-10-21・静岡 10-27・愛知 11-04・三重 11-06・和歌山 10-19。pipeline/shelters.py SHELTER_UPDATED） */
export const SHELTER_SOURCE = '出典: 国土地理院 指定緊急避難場所データ（最終更新は県ごとに 2026-10-19〜2026-11-06）';

/** 半割れ・時間差のタブの説明（Global Constraints の文言）。 */
export const HALF_EXPLAIN = '南海トラフの東側（または西側）だけで大きな地震が起きた場合の想定です。残りの半分でも続けて大地震が起きるおそれがあり、『南海トラフ地震臨時情報（巨大地震警戒）』が出たら、1週間程度は事前避難や備えの再確認をしてください';
export const LAG_EXPLAIN = '先に片側で地震が起き、その後もう片側でも地震が起きた場合の想定です。先の地震で傷んだ建物は、後の地震で壊れやすくなります（国の手法：先の地震で半壊した建物は、後の地震で震度が0.5高い場合と同じ全壊率で計算）';
/** 最大クラス以外のタブで、津波の行の下に出す。 */
export const TSUNAMI_SCENARIO_NOTE = '津波は最大クラスの想定を表示しています。半割れ・時間差では津波の高さや到達時間が異なる場合がありますが、強い揺れを感じたらすぐ高い所へ避難してください';

export const NO_SCENARIO_DATA = 'この想定のデータがありません';
export const SCENARIO_RETRY = 'もう一度読み込む';
