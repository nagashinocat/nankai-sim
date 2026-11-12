import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// 試作版（スマホでどこでも見る用・非公開アーティファクト）。住所検索と津波タイルを差し替え、相対パスで配信する。
const demo = (f: string) => fileURLToPath(new URL(`./demo/${f}`, import.meta.url));
function demoSwap(): Plugin {
  return {
    name: 'demo-swap',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !importer.endsWith('src/app/main.ts')) return null;
      if (source === './geocode.ts') return demo('geocode.ts');
      if (source === './tsunami-tile.ts') return demo('tsunami-tile.ts');
      return null;
    },
    transform(code, id) {
      if (!id.endsWith('src/app/ui/map.ts')) return null;
      const line = 'L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map);';
      if (!code.includes(line)) throw new Error('demo: map.ts の背景地図の行が見つかりません');
      return `import { addDemoBase } from ${JSON.stringify(demo('basemap.ts'))};\n` + code.replace(line, 'addDemoBase(map, center);');
    },
    transformIndexHtml(html) {
      return html.replace('<div id="app"></div>', `<div style="background:#fff3cd;border:2px solid #c9a227;border-radius:8px;padding:8px 12px;margin:8px;font-size:.9rem;line-height:1.5"><strong>試作版（あなただけが見られるページです。共有しないでください）</strong><br>住所欄に何か入れて検索すると、次の5か所から選べます：静岡市清水区真砂町／名古屋市港区港町／岐阜市橋本町／尾鷲市中村町／和歌山市美園町。地図は海・川と津波の浸水想定だけの簡易版です。「現在地を使う」は使えません。</div><div id="app"></div>`);
    },
  };
}
export default defineConfig({ base: './', appType: 'mpa', plugins: [demoSwap()], build: { outDir: 'dist-demo', copyPublicDir: false } });
