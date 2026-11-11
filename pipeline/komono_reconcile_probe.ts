import { useFragilityTable, shakeRates } from '/home/claude/nankai-sim/src/core/fragility.ts';
import { estimateLag } from '/home/claude/nankai-sim/src/core/damage.ts';
import t from '/home/claude/nankai-sim/src/data/fragility.json' with { type: 'json' };
import m from '../data/komono_meshes.json' with { type: 'json' };
useFragilityTable(t as any);
// 令和5年住宅・土地統計 菰野町 第6-3表（住宅数, 戸）
const stock: Record<string, number> = {
  'wood:pre1981': 1330 + 1710, 'rc:pre1981': 130, 'steel:pre1981': 170,
  'wood:y1981_2000': 1120 + 2480, 'rc:y1981_2000': 70 + 710, 'steel:y1981_2000': 100 + 510,
  'wood:post2000': 1670 + 2230 + 590, 'rc:post2000': 330 + 520 + 30, 'steel:post2000': 460 + 400 + 90,
};
// 固定資産の価格等の概要調書（令和6年度）菰野町: 木造 24,209 棟・木造以外 11,369 棟。
// 住宅統計の構造・年代の割合で按分し、全建物（棟）に拡大する。
const WOOD = 24209, NONWOOD = 11369;
if (process.env.SCALE === '1') {
  const w = Object.entries(stock).filter(([k]) => k.startsWith('wood'));
  const n = Object.entries(stock).filter(([k]) => !k.startsWith('wood'));
  const ws = w.reduce((a, [, v]) => a + v, 0), ns = n.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of w) stock[k] = WOOD * v / ws;
  for (const [k, v] of n) stock[k] = NONWOOD * v / ns;
}
const total = Object.values(stock).reduce((a, b) => a + b, 0);
const hhTot = m.meshes.reduce((a, x) => a + x.hh, 0);
function run(field: 'champ' | 'e' | 'w', floors?: number) {
  let col = 0, half = 0;
  for (const x of m.meshes) {
    const I = x[field]; if (!Number.isFinite(I) || x.hh === 0) continue;
    const n = total * x.hh / hhTot;
    for (const [k, v] of Object.entries(stock)) {
      const [s, e] = k.split(':') as any;
      const r = shakeRates(I, s, e, s === 'wood' ? undefined : floors);
      col += n * (v / total) * r.collapse; half += n * (v / total) * r.half;
    }
  }
  return { col: Math.round(col), half: Math.round(half) };
}
console.log('建物(住宅)数', total);
console.log('最大クラス(champ) 揺れ 全壊/半壊 [階数=全区分の最大]', run('champ'));
console.log('最大クラス(champ) 揺れ 全壊/半壊 [非木造=低層]     ', run('champ', 3));
console.log('東側半割れ 1E', run('e', 3), ' 西側半割れ 1W', run('w', 3));
