import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * data/shelters/index.json（避難場所のデータを端末に保存するときの一覧）。
 * files = 2次メッシュごとのファイル名、updated = manifest の避難場所（gsi-shelters）の作成日、count = 避難場所の件数、bytes = 合計の大きさ。
 * 公開データ（国土地理院 指定緊急避難場所）だけで、利用者の位置は入らない。
 */
export type ShelterIndex = { files: string[]; updated: string | null; count: number; bytes: number };

export const SHELTER_FILE = /^\d{6}\.json$/;

export function buildShelterIndex(dataDir: string): ShelterIndex {
  const dir = join(dataDir, 'shelters');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => SHELTER_FILE.test(f)).sort() : [];
  let count = 0, bytes = 0;
  for (const f of files) {
    const p = join(dir, f);
    bytes += statSync(p).size;
    try {
      const v: unknown = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(v)) count += v.length;
    } catch { /* 壊れたファイルも一覧には入れる（保存はできる） */ }
  }
  let updated: string | null = null;
  try {
    const m = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as { datasets?: { id?: string; processedDate?: unknown }[] };
    const d = m.datasets?.find((x) => x.id === 'gsi-shelters')?.processedDate;
    if (typeof d === 'string') updated = d;
  } catch { /* manifest が無い */ }
  return { files, updated, count, bytes };
}
