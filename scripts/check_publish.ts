import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** dist/data/hazard/L2/index.json（対応範囲の2次メッシュ一覧）が空でない文字列の配列か。 */
function hazardIndexOk(path: string): boolean {
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === 'string');
  } catch {
    return false;
  }
}

/**
 * 公開ビルドのゲート。
 * 1. dist/data/hazard/ が無い、または L2/index.json（対応範囲）が無い・空ならエラー。
 *    想定データの無い公開物は、三重県の住所にも「対応していません」としか出せないため（final review C1）。
 * 2. dist/data/hazard/ が含まれているのに allow（ALLOW_HAZARD_PUBLISH=1）が無ければエラー。
 *    内閣府データを加工した成果物を公開してよいかの確認が済むまで、公開用ビルドを失敗させるための仕組み。
 */
export function checkPublish(distDir: string, allow: boolean): string[] {
  if (!existsSync(distDir)) return [`${distDir} が見つかりません。先に vite build を実行してください`];
  const hazardDir = join(distDir, 'data', 'hazard');
  if (!existsSync(hazardDir)) {
    return [`${hazardDir} がありません。想定データの無い公開物は作れません。パイプライン（python3 -m pipeline.naikaku_hazard）で public/data/hazard を生成してからビルドしてください`];
  }
  const index = join(hazardDir, 'L2', 'index.json');
  if (!hazardIndexOk(index)) {
    return [`${index} が無いか空です（想定データの対応範囲）。パイプライン（python3 -m pipeline.naikaku_hazard）で生成し直してください`];
  }
  if (!allow) {
    return [
      `${hazardDir} が含まれています。内閣府データの利用条件の確認結果を docs/publishing.md に記録したうえで、ALLOW_HAZARD_PUBLISH=1 を付けて再実行してください`,
    ];
  }
  return [];
}

function main(): void {
  const errors = checkPublish(process.argv[2] ?? 'dist', process.env.ALLOW_HAZARD_PUBLISH === '1');
  for (const e of errors) console.error(`公開ビルドを中止: ${e}`);
  if (errors.length) process.exit(1);
  console.log('公開チェック: OK');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
