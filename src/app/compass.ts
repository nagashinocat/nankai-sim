/**
 * スマホの向き（コンパス）。画面の上が向いている方位（0 = 北、時計回り）を返す。
 * - iPhone（Safari）: DeviceOrientationEvent.requestPermission()（ボタンを押したときに呼ぶ）→ deviceorientation の webkitCompassHeading
 * - Android（Chrome など）: deviceorientationabsolute の alpha（反時計回り）→ heading = (360 - alpha) % 360
 *   （新しい Chrome にも requestPermission があるので、許可のあとは両方のイベントを聞く）
 * - 使えない（許可されない・センサーが無い・北の基準が無い）ときは null（簡易地図は北が上のまま）
 * 向きは画面に使うだけで、保存しない。
 */

export type OrientationLike = {
  webkitCompassHeading?: number | null;
  alpha?: number | null;
  absolute?: boolean;
};

const norm = (d: number): number => ((d % 360) + 360) % 360;

/**
 * イベントから方位（度）。webkitCompassHeading（iOS、時計回り）を優先。
 * それが無ければ absolute（北が基準）の alpha だけを使う（相対の alpha は北と関係ないので null）。
 * screenAngle は画面の回転（screen.orientation.angle。横向きで 90 など）。
 */
export function headingFromEvent(e: OrientationLike, screenAngle = 0): number | null {
  const a = Number.isFinite(screenAngle) ? screenAngle : 0;
  const w = e.webkitCompassHeading;
  if (typeof w === 'number' && Number.isFinite(w) && w >= 0) return norm(w + a);
  const alpha = e.alpha;
  if (e.absolute === true && typeof alpha === 'number' && Number.isFinite(alpha)) return norm(360 - alpha + a);
  return null;
}

type DOEWithPermission = { requestPermission?: () => Promise<'granted' | 'denied' | string> };

/** 最初の向きが来るのを待つ時間（ms）。来なければ null を知らせる。 */
export const COMPASS_WAIT_MS = 3000;

/**
 * コンパスを始める。onHeading に方位（度）か、使えないとき null を渡す。戻り値は止める関数。
 * iPhone の許可の問い合わせは、ボタンのクリックの中から呼ぶこと。
 */
export async function startCompass(onHeading: (deg: number | null) => void): Promise<() => void> {
  const noop = () => {};
  if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
    onHeading(null);
    return noop;
  }
  const DOE = window.DeviceOrientationEvent as unknown as DOEWithPermission;
  // 許可の問い合わせは iPhone だけでなく、新しい Chrome にもある（そのときも北の基準は deviceorientationabsolute）
  if (typeof DOE.requestPermission === 'function') {
    try {
      if ((await DOE.requestPermission()) !== 'granted') { onHeading(null); return noop; }
    } catch {
      onHeading(null);
      return noop;
    }
  }
  // 両方を聞く: iPhone は deviceorientation の webkitCompassHeading、Android は deviceorientationabsolute の alpha。
  // 相対の alpha（absolute でない）は headingFromEvent が捨てる。
  const events: string[] = ['deviceorientation', ...('ondeviceorientationabsolute' in window ? ['deviceorientationabsolute'] : [])];
  let got = false;
  let stopped = false;
  const screenAngle = (): number => {
    try { return screen.orientation?.angle ?? 0; } catch { return 0; }
  };
  const listener = (ev: Event): void => {
    if (stopped) return;
    const h = headingFromEvent(ev as unknown as OrientationLike, screenAngle());
    if (h === null) return;
    got = true;
    onHeading(h);
  };
  for (const n of events) window.addEventListener(n, listener);
  const timer = setTimeout(() => { if (!got && !stopped) onHeading(null); }, COMPASS_WAIT_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const n of events) window.removeEventListener(n, listener);
  };
}
