import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * ビルドごとに sw.js の中身を変える（ブラウザが新しい SW を検知し、古いキャッシュが入れ替わる）。
 * 出力ファイル名（ハッシュ付き）から作ったIDを sw.js の __BUILD_ID__ に埋め込む。
 */
function swBuildId(): Plugin {
  let outDir = 'dist';
  let names = '';
  return {
    name: 'sw-build-id',
    apply: 'build',
    configResolved(c) { outDir = join(c.root, c.build.outDir); },
    writeBundle(_, bundle) { names = Object.keys(bundle).sort().join('|'); },
    closeBundle() { // public/ のコピー後に実行される
      const id = createHash('sha256').update(names).digest('hex').slice(0, 10);
      const f = join(outDir, 'sw.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace('__BUILD_ID__', id));
    },
  };
}

// public/ は '/' で配信される（データは /data/...）。
// appType 'mpa': 存在しないデータファイルを index.html（200）で返さず 404 にする（data.ts は 404 を「ファイル無し」として扱う）。
export default defineConfig({ appType: 'mpa', plugins: [swBuildId()] });
