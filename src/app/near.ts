/**
 * 「いまいる場所から近い避難場所」（#near）の文言と、一覧の計算（DOM なし）。
 * 現在地はメモリで使うだけ（保存しない・URL に入れない）。
 */
import { WALK_SPEED, nearestShelters, type ShelterHit } from '../core/evacuation.ts';
import { distanceM } from '../core/mesh.ts';
import type { LatLon, Shelter } from '../core/types.ts';
import { walkMinutes } from './minimap.ts';

/** まず探す半径（m）と、0件のとき広げる半径（m）。 */
export const NEAR_RADIUS_M = 2000;
export const NEAR_WIDE_RADIUS_M = 5000;
export const NEAR_LIMIT = 5;
/** 位置の誤差（m）がこれを超えたら知らせる。 */
export const ACCURACY_WARN_M = 100;

export type NearList = {
  hazard: 'tsunami' | 'earthquake';
  hits: ShelterHit[];
  /** 2km 以内に無く、5km まで広げた */
  widened: boolean;
  /** 簡易地図の「ほかの避難場所」（その災害に対応する 5km 以内のもの） */
  pool: Shelter[];
};

/** 津波・地震の順に、近い避難場所を5件ずつ。2km 以内に無ければ 5km まで広げる。 */
export function nearLists(pos: LatLon, shelters: Shelter[]): NearList[] {
  return (['tsunami', 'earthquake'] as const).map((hazard) => {
    const pool = shelters.filter((s) => s[hazard] && distanceM(pos, s.pos) <= NEAR_WIDE_RADIUS_M);
    const within = pool.filter((s) => distanceM(pos, s.pos) <= NEAR_RADIUS_M);
    const opts = { hazard, speedMps: WALK_SPEED.standard, limit: NEAR_LIMIT };
    const first = nearestShelters(pos, within, opts);
    if (first.length > 0) return { hazard, hits: first, widened: false, pool };
    const wide = nearestShelters(pos, pool, opts);
    return { hazard, hits: wide, widened: wide.length > 0, pool };
  });
}

/** 一覧の1行の距離・徒歩（結果画面と同じ書き方）。 */
export function walkText(m: number): { standard: string; slow: string } {
  return { standard: `約${walkMinutes(m, WALK_SPEED.standard)}分`, slow: `約${walkMinutes(m, WALK_SPEED.slow)}分` };
}

export const NEAR_TEXT = {
  entry: 'いまいる場所から近い避難場所',
  title: 'いまいる場所から近い避難場所',
  lead: '現在地（GPS）から、近い順に津波・地震の避難場所を出します。',
  privacy: '現在地は、この画面で近い避難場所を探すのに使うだけです。保存も送信もしません（画面を離れると消えます）。',
  locate: '現在地を使う',
  relocate: '現在地を取り直す',
  locating: '現在地を調べています…（屋外のほうが早く正確です）',
  loading: '近い避難場所を探しています…',
  unsupported: 'この端末・ブラウザでは現在地を使えません。まわりの案内板や、市町のハザードマップで避難場所を確かめてください。トップで自宅の住所を入れると、自宅から近い避難場所が出ます。',
  denied: '現在地の利用が許可されていません。スマホの設定（位置情報）とブラウザでこのページに位置情報を許可してから、もう一度「現在地を使う」を押してください。許可しない場合は、トップで住所を入れると、その場所から近い避難場所が出ます。',
  failed: '現在地を取得できませんでした（時間切れ・GPS が届きにくい場所など）。屋外や窓の近くに移って、もう一度「現在地を使う」を押してください。',
  none: '近くに登録された避難場所がありません（5県の外か、データが無い場所）。まわりの案内板や、市町のハザードマップで確かめてください。',
  noneList: '5km 以内に、この災害に対応する避難場所のデータがありません。',
  widened: '2km 以内に見つからないため、5km まで広げて探しました。',
  loadFailed: '避難場所のデータを読み込めませんでした。通信状況を確認して、もう一度お試しください。',
  notSaved: '電波がなく、避難場所のデータをこのスマホに保存していないので出せません。',
  /** 自動保存の対象の端末で、notSaved に添える */
  autoNote: '電波があるときに一度開くと自動で保存されます。',
  notSavedDo: [
    '海の近くで強い揺れを感じたら、避難場所を探すより先に、すぐ近くの高い所（高台・高い建物の上の階）へ逃げてください。',
    'まわりの「避難場所」「津波避難ビル」の案内板を探してください。',
    '電波が戻ったら、この画面で「避難場所のデータをこのスマホに保存」を押しておくと、次からは電波がなくても出せます。',
  ],
  tsunamiOffline: 'ここが浸水するかは調べられません。海の近くなら、揺れたらすぐ高い所へ',
  tsunamiLoading: 'この場所の津波の浸水想定を調べています…',
  heading: { tsunami: '津波の避難場所（近い順）', earthquake: '地震の避難場所（近い順）' },
  mapOpen: '🗺 地図',
  mapClose: '🗺 地図を閉じる',
  back: 'トップにもどる',
  coverage: '静岡・愛知・岐阜・三重・和歌山の5県のデータだけです。',
  outside: 'この地域はまだ対応していません',
  outsideDo: '最寄りの市町村のハザードマップ・避難場所を確認してください。',
  seaFirst: '海の近くなら、まず近くの高い所へ',
  todoTitle: 'いまできること',
} as const;

/** 位置の誤差の注意。100m 以下なら null。 */
export function accuracyNote(accuracyM: number | null | undefined): string | null {
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM <= ACCURACY_WARN_M) return null;
  const r = accuracyM >= 1000 ? `${(accuracyM / 1000).toFixed(1)}km` : `${Math.round(accuracyM / 10) * 10}m`;
  return `位置の誤差が約${r}あります。近い順や方向がずれることがあります。屋外で取り直すと正確になります。`;
}

export type GeoErrorKind = 'unsupported' | 'denied' | 'failed';
/** GeolocationPositionError.code（1 = 拒否、2 = 取得できない、3 = 時間切れ）→ 種類。 */
export function geoErrorKind(code: number | undefined): GeoErrorKind {
  return code === 1 ? 'denied' : 'failed';
}
