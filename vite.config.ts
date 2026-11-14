import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { buildShelterIndex } from './scripts/shelter_index.ts';

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
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    writeBundle(_, bundle) { names = Object.keys(bundle).sort().join('|'); },
    closeBundle() { // public/ のコピー後に実行される
      const id = createHash('sha256').update(names).digest('hex').slice(0, 10);
      const f = join(outDir, 'sw.js');
      writeFileSync(f, readFileSync(f, 'utf8').replace('__BUILD_ID__', id));
    },
  };
}

/**
 * data/shelters/index.json（避難場所のデータを端末に保存するときのファイル一覧と更新日）。
 * 開発サーバーではその場で作って返し、ビルドでは出力先に書く（public/ のコピーの後）。
 */
function shelterIndex(): Plugin {
  let outDir = 'dist';
  let publicDir = 'public';
  return {
    name: 'shelter-index',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); publicDir = c.publicDir || join(c.root, 'public'); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!path.endsWith('/data/shelters/index.json')) return next();
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-cache');
        res.end(JSON.stringify(buildShelterIndex(join(publicDir, 'data'))));
      });
    },
    closeBundle() {
      if (!existsSync(join(outDir, 'data', 'shelters'))) return; // データの無いビルド・public を写さないビルド
      writeFileSync(join(outDir, 'data', 'shelters', 'index.json'), JSON.stringify(buildShelterIndex(join(outDir, 'data'))));
    },
  };
}

// public/ は '/' で配信される（データは /data/...）。
// appType 'mpa': 存在しないデータファイルを index.html（200）で返さず 404 にする（data.ts は 404 を「ファイル無し」として扱う）。
export default defineConfig({ appType: 'mpa', plugins: [swBuildId(), shelterIndex()] });
