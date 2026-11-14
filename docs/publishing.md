# 公開の手順と利用条件の確認記録

この文書は、本アプリを Web に公開する前に確認することをまとめたものです。

## 公開の手順

1. 公開用のビルドは `npm run build:public` だけを使う（`vite build` の後に `scripts/check_publish.ts dist` が走る）。`npm run build` の出力をそのまま公開しない。
2. 公開チェックは次のどちらでも終了コード 1 で失敗する。
   - `dist/data/hazard/` が無い、または `dist/data/hazard/L2/index.json`（対応範囲の2次メッシュ一覧）が無い・空。想定データの無い公開物は、三重県の住所にも「この地域はまだ対応していません」としか出せないため、想定データ抜きの公開はできない。
   - `dist/data/hazard/`（内閣府データから計算し直した値）が含まれていて、`ALLOW_HAZARD_PUBLISH=1` が無い。`ALLOW_HAZARD_PUBLISH=1` を付けるのは、下の「内閣府への確認」が回答済みで、「確認結果の記録」に書き込んだ後だけにする。
   つまり、内閣府への確認が済むまでは公開用ビルドは通らない。
3. `public/data` 配下（hazard / stock / shelters）はローカルのパイプラインで生成する（git には入っていない）。公開物にはこのデータを含める必要があるので、ビルドの前にパイプラインで生成しておく。手順（リポジトリのルートで実行）:
   ```sh
   # 建物・避難場所は県ごとに作る（出力 build/data-build/<県コード>/。public/ の外で git 対象外）
   for p in 21 22 23 24 30; do python3 -m pipeline.building_stock --pref $p; done
   for p in 21 22 23 24 30; do python3 -m pipeline.shelters --csv data/raw/shelters/gsi_hinanbasho_${p}000_2.csv; done
   # 5県分を public/data/{stock,shelters} に統合（同じメッシュの値が違えば失敗。県境のメッシュは境界の規則で決め、件数を表示。
   #   別の県に同名の町村があれば（愛知県・和歌山県の美浜町）、どちらも県名付きの名前（愛知県美浜町・和歌山県美浜町）にする）
   python3 -m pipeline.merge --src build/data-build/21 build/data-build/22 build/data-build/23 build/data-build/24 build/data-build/30 --dst public/data
   # 想定データ（対応範囲は 250m メッシュ単位: 四角が5県の境界 data/raw/boundary/r2ka{21,22,23,24,30} の和と面積>0で重なる（Ruling F4）。
   #   入力は各ケースで tokai_* と、和歌山県の東経135度以西（1次メッシュ 5034・5134）の w34_* の両方（既定）。
   #   統合後の建物のメッシュがすべて範囲内かも確かめるので、先に上の統合を済ませる）
   #   公開: L2・HALF_E・HALF_W → public/data/hazard
   #   照合用: L2_RIKU・L2_KIHON → build/hazard-reconcile（公開しない）
   python3 -m pipeline.naikaku_hazard
   # 津波到達時間（市町村名は統合後の municipality_meshes.json で確認）
   python3 -m pipeline.tsunami_arrival --csv data/published/shizuoka_tsunami_arrival.csv data/published/aichi_tsunami_arrival.csv data/published/mie_tsunami_arrival.csv data/published/wakayama_tsunami_arrival.csv
   ```
   各コマンドは `public/data/manifest.json` の該当エントリを書き直す。`build/` は `public/` の外なので公開物には入らない。統合の後も、照合（`scripts/reconcile.ts`）には次の2つが要る（消すと照合できない）:
   - `build/hazard-reconcile/`（L2_RIKU・L2_KIHON のハザード。県の公表値と比べるケース）
   - `build/data-build/22/stock/municipality_meshes.json`（静岡県の `--totals-only` が市町村の一覧に使う）
   照合の実行例は docs/reports/2026-11-12-tokai-reconcile.md・docs/reports/2026-11-12-wakayama-reconcile.md にある（和歌山県は `npx tsx scripts/reconcile.ts --pref 30 --national 84700`。既定で揺れ＋液状化、`--shake-only` で揺れのみ）。
   それ以外の `build/data-build/` は統合の後に消してよい（作り直すときは上の手順をもう一度実行する）。
   想定データの2次メッシュのファイルには対応範囲の 250m メッシュの行だけが入り（範囲内で想定値の無いメッシュは全項目 null の行）、各ケースのフォルダに `index.json`（ファイルのある2次メッシュの一覧）も書き出される。アプリは `index.json` に無い2次メッシュと、ファイルに行の無いメッシュ（同じ2次メッシュの隣県の場所）を「この地域はまだ対応していません」、null の行を「この場所のデータなし」と表示し、`index.json` にあるのにファイルが読めないときは読み込み失敗（再試行ボタン）として扱う。
4. 静的ホストの設定:
   - SPA フォールバックを切る。存在しないファイルは `index.html`（200）ではなく 404 を返すこと（想定データが HTML で返ると、アプリは読み込み失敗として扱い結果を出せない）。
     Cloudflare Pages は `404.html` が無いと SPA とみなして index.html を返すため、`public/404.html` を置いている（ビルドで dist/404.html になる）。
   - サブパスで公開する場合（例: GitHub Pages の `/<repo>/`）は `vite build --base=/<repo>/` でビルドする。このとき公開チェックも同じ `dist/` に対して実行すること（`npx tsx scripts/check_publish.ts dist`）。
5. 公開後、`/data/hazard/L2/index.json` が開けること、`/data/hazard/` 配下に存在しないファイルを開いて 404 になること、オフラインで前回の結果が開けることを確認する。

### 公開前チェックリスト

- [x] 内閣府への確認が回答済みで、下の記録欄に書いてある（2026-11-12 回答、2026-11-14 記入）
- [x] 画面に出典「内閣府 南海トラフの巨大地震モデル・被害想定手法検討会」が表示されている（説明ページに `public/data/manifest.json` の全データセットも表示）
- [x] 加工した値であり、内閣府の未加工データではないことが分かる表示になっている
- [x] 地図タイルの出典「国土地理院」が表示されている
- [x] 避難場所データの出典「国土地理院 指定緊急避難場所データ」と、国土地理院「ご利用上の注意」1〜3 の注意が結果画面に表示されている
- [x] 国土地理院の利用規約を公開前に再確認した（2026-11-14: 指定緊急避難場所データは国土地理院コンテンツ利用規約に基づき防災アプリの開発等に利用可能、と国土地理院が案内。出典表示と最新版の確認の注意は表示済み）
- [x] 「これは耐震診断ではなく、統計的な目安です」が最初に表示される

## 内閣府データの利用規程（要点）

根拠は設計書 §3.9（2026-11-12 確認済み）。第3条・第4条の条文そのものはここに転記しない。全文は内閣府の利用規約のページ（データ提供ページ https://www.bousai.go.jp/jishin/nankai/model/data_teikyou.html から辿れる）で確認すること。

- 第4条: 加工した成果物は自由に頒布できる。元データをそのまま、またはファイル形式だけ変えて頒布することは禁止。
- 第3条: 出典「内閣府 南海トラフの巨大地震モデル・被害想定手法検討会」を明記する。加工したものを内閣府の未加工データのように見せない。
- このため公開版のデータは、生の震度表ではなく、本アプリで計算し直した値（被害率など）を配る。元データ（`data/naikaku_raw/`）は git に入れない。

## 内閣府への確認

確認したいこと: メッシュ（250m）別の震度を、被害率などに計算し直した形で Web 公開することが、第4条の「加工」に当たるか。

問い合わせ先:

- 内閣府（防災担当）調査・企画担当 03-3501-5693
- FAX 03-3501-6820（Web の問い合わせフォームは無い。2026-11-12 にデータ提供ページ https://www.bousai.go.jp/jishin/nankai/model/data_teikyou.html で確認。窓口は「内閣府政策統括官（防災担当）付 参事官（調査・企画担当）付」、代表 03-5253-2111 内線51325）

## 確認結果の記録

| 項目 | 記入 |
|---|---|
| 問い合わせ日 | 2026-11-12 |
| 問い合わせ方法（電話 / FAX） | 電話 |
| 担当者・受付番号 | 内閣府（防災担当）調査・企画担当（担当者名・受付番号は聞いていない） |
| 質問内容 | データセットA（Eq/Liq、champ・1E・1W、5県）のメッシュ別の参考震度・PL値・沈下量を形式を変えてWeb上に置くことが第4条の「加工」か「再配布」か。再配布なら (a) 震度階級・PL区分に丸めた値だけ、(b) 被害率だけ、なら公開してよいか。表示すべき注記の有無 |
| 回答日 | 2026-11-12（電話） |
| 回答内容（原文または要約） | 要約（利用者からの聞き取り）: アプリの内容を説明したところ、出典を明記すれば使用してよい、との回答。範囲や条件について特に指定はなかった。 |
| 公開してよいか（可 / 条件付き可 / 不可） | 条件付き可（出典の明記） |
| 条件（出典表記の指定など） | 出典を明記すること（表記の指定はなし）。本アプリでは第3条どおり「内閣府 南海トラフの巨大地震モデル・被害想定手法検討会」と、加工した値である旨を表示する。念のため、元データ（data/raw/naikaku*）そのものの配布は引き続き行わない。 |
| 記録者 | 利用者（電話で確認）、2026-11-14 に Claude が記入 |

## 公開先（2026-11-14〜）

- GitHub Pages: https://nagashinocat.github.io/nankai-sim/ （リポジトリ nagashinocat/nankai-sim、`gh-pages` ブランチの `/(root)`）
- 更新のしかた（リポジトリのルートで）:
  ```sh
  rm -rf dist && ALLOW_HAZARD_PUBLISH=1 npx vite build --base=/nankai-sim/ && ALLOW_HAZARD_PUBLISH=1 npx tsx scripts/check_publish.ts dist
  touch dist/.nojekyll
  # dist の中身だけを gh-pages ブランチとして送る（履歴は持たない）
  cd dist && git init -q -b gh-pages && git add -A && git commit -qm "公開版" && git push -f https://github.com/nagashinocat/nankai-sim gh-pages && rm -rf .git
  ```
- 2026-11-14 の公開後の確認: トップが開く／尾鷲市中村町で結果（震度・津波・避難場所・地図）が出る／`data/hazard/L2/999999.json` が 404（404.html）
