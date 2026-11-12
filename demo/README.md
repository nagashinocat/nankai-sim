# 試作版（アーティファクト用・外部通信なし）

claude.ai のアーティファクトは外部への通信・位置情報・Service Worker が使えないため、5か所だけを中に入れた版を作る。

- `presets.json` … 5か所（住所検索の代わり）
- `tsunami-pixels.json` … 5か所の計算に使う津波タイルの画素（国土地理院から読み取り）
- `basemap.json` / `basemap.ts` … 海・川と津波浸水想定を簡略化した背景（`bm/` は元データ）
- `geocode.ts` / `tsunami-tile.ts` … 差し替え用
- `crawl.mjs` … 5か所×全タブを開いて、必要なデータファイルを `used.json` に書く

作り方:
```sh
npx vite build -c vite.demo.config.ts --outDir /tmp/demo-build --emptyOutDir
# dist-demo/ に index.html と assets を入れ、used.json に載ったファイルを dist/data から dist-demo/data へコピー
```
内閣府データ由来の値を含むので、共有しない（公開ゲートと同じ扱い）。
