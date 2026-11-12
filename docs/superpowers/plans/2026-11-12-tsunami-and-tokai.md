# 津波の取り込みと東海4県への拡大 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自宅の結果に津波（浸水深・到達時間・被害）を加え、対応エリアを三重から静岡・愛知・岐阜・三重の4県に広げる。

**Architecture:** 浸水深はブラウザが地理院の津波浸水想定タイルを1枚読み、ピクセルの色を段階に変換する（データは持ち直さない）。到達時間は県公表の市町村別表を書き写して `tsunami_arrival.json` にする。4県への拡大は、パイプラインを県コード引数で動くように直し、県ごとに実行して `public/data` に統合する。

**Tech Stack:** TypeScript（node:test via tsx）、Vite 8、Leaflet 1.9、Playwright、Python 3（pandas, geopandas, openpyxl, pytest）。

**Spec:** `docs/superpowers/specs/2026-11-12-tsunami-design.md`（親: `docs/superpowers/specs/2026-11-12-nankai-trough-sim-design.md`）

## Global Constraints

- 前計画（`docs/superpowers/plans/2026-11-12-web-app-v1.md`）の Global Constraints をすべて引き継ぐ（免責文、地理院の避難場所の注意3文、住所・自宅座標を保存・共有文・外部リンクに入れない、内閣府データを再配布しない）。
- 到達時間は **30cm（その県で公表されている最も低い高さ）** の到達時間を使う。表の「－」は null。
- 避難開始までの時間 `EVAC_START_MIN = 5`。判定は「徒歩（遅め）＋5分」と到達時間の比較。到達時間が 5分以内または null の場合は判定せず、文言「揺れが収まったらすぐ高い所へ」。
- 判定の文言（そのまま使う）: ok「すぐ避難を始めれば間に合う可能性」／tight「ぎりぎり。より近い高い場所も考えて」／no「間に合わないおそれ。近くの高い建物や高台へ」。
- 浸水域外の文言: 「想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ」
- 到達時間の注記: 「到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください」
- 津波タイルの出典表示: 「津波浸水想定：国土地理院 重ねるハザードマップ（各都道府県の津波浸水想定）」。不透明度 0.5。
- 対応エリアの表記: 「静岡県・愛知県・岐阜県・三重県」。
- 県コード: 静岡 22、愛知 23、岐阜 21、三重 24。
- ダウンロード・サイトへのアクセス・規約への同意は、利用者の許可を得てから（コントローラーが行う。実装担当は外部サイトに接続しない）。

## Review Focus

1. 津波タイルが読めない（CORS エラー、オフライン、404）→ 「判定できない」として既存の「津波は含まれていません」注意を出し、結果全体は出す。
2. タイルの色が凡例と微妙に違う（アンチエイリアスの境界ピクセル）→ 最も近い凡例色との距離がしきい値（RGB ユークリッド距離 24）以内なら採用、それ以外は「判定できない」。
3. 県境の住所（例: 三重と愛知の境、木曽岬町）→ 市町村の到達時間は自宅が属する市町村のものを使う。市町村が決まらないときは到達時間 null（判定しない）。
4. 岐阜など海のない県・到達時間表に無い市町村で浸水色が出る（河川遡上など）→ 浸水深は出すが判定は「揺れが収まったらすぐ高い所へ」。
5. 4県で2次メッシュファイルが重なる（県境）→ 統合結果が県ごとの実行順に依存しない（同じメッシュは同じ値。異なれば失敗させる）。

---

### Task 1: 情報源の確認と生データの取得（コントローラーが行う）

実装担当には出さない。コントローラーが PC の内蔵ブラウザで行い、結果を `docs/superpowers/notes/2026-11-12-tsunami-tokai-sources.md` に記録してコミットする。

- [ ] 津波タイル: URL テンプレート（想定 `https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png`）、最大ズーム、凡例の8色（RGB）、利用条件と出典表示を公式ページで確認。
- [ ] CORS: 内蔵ブラウザの別オリジンのページから `fetch(タイルURL)` して `Access-Control-Allow-Origin` を確認し、Canvas の `getImageData` が例外を出さないこと。**不可なら計画を止め、仕様の代替案（国土数値情報 A40）に改める。**
- [ ] 到達時間の表: 三重（取得済み本編 p.28）、静岡（第4次地震被害想定）、愛知（被害予測調査）の市町村別表の場所。
- [ ] 答え合わせ用の県公表値: 静岡・愛知・岐阜の市町村別「揺れによる全壊棟数」（理論上最大）の表と、県が使った内閣府ケース。
- [ ] 利用者の許可を得てダウンロード: 内閣府データセットA の不足地域（Eq/Liq、champ・2・1E・1W）、住宅・土地統計 令和5年 県結果（22/23/21）、地理院 指定緊急避難場所 CSV（22000/23000/21000）、県の報告書 PDF。e-Stat（国勢調査 T001142 の該当1次メッシュ、境界 r2ka22/23/21）はクラウドから取得。
- [ ] すべてを `data/raw/` の県別フォルダに置き、ファイル名・取得元URL・取得日をノートに記録。

### Task 2: 津波の段階と色の変換、到達判定（コア）

**Files:**
- Create: `src/core/tsunami.ts`
- Modify: `src/core/evacuation.ts`, `src/core/damage.ts`
- Test: `tests/core/tsunami.test.ts`, `tests/core/evacuation.test.ts`, `tests/core/damage.test.ts`

**Interfaces:**
- Produces:
  - `export type TsunamiBand = { label: string; lo: number; hi: number; mid: number }`（20m以上は hi=20, mid=20）
  - `export const TSUNAMI_BANDS: TsunamiBand[]`（8段階、Task 1 で確かめた RGB を `rgb: [r,g,b]` として持つ）
  - `export function bandFromRgba(r: number, g: number, b: number, a: number): TsunamiBand | 'none' | 'unknown'` — a < 128 → 'none'（浸水域外）。最も近い凡例色との距離 ≤ 24 → その段階、それ以外 'unknown'。
  - `export const EVAC_START_MIN = 5`
  - `reachBeforeTsunami(walkMin: number, arrivalMin: number | null): 'ok' | 'tight' | 'no' | 'n/a'` を次に変更: arrivalMin が null または ≤ 5 → 'n/a'。t = walkMin + 5。t < arrivalMin − 5 → 'ok'、t ≤ arrivalMin → 'tight'、それ以外 'no'。
  - `estimateHome(cell, input, tsunamiRange?: Range)` — tsunamiRange があれば深さ {lo, hi} も幅のループに加える。central は `cell.tsunamiDepth`（呼び出し側が mid を入れる）。

- [ ] Step 1: 失敗するテスト
  - `bandFromRgba` が8色それぞれ・各色から距離 10 ずれた色で正しい段階、a=0 で 'none'、(0,0,255,255) で 'unknown'。
  - `reachBeforeTsunami`: (10, null)→'n/a'; (1, 5)→'n/a'; (5, 30)→'ok'（10 < 25）; (20, 30)→'tight'（25 ≤ 30, ≥ 25）; (30, 30)→'no'。
  - `estimateHome`: 揺れ震度 6.0 の木造 pre1981 で tsunamiRange [1,3]・depth 2 のとき、collapse の下限 ≤ central ≤ 上限、かつ津波なしより上限が大きい。tsunamiRange 無しの結果は従来どおり（既存テストが通る）。
- [ ] Step 2: 失敗を確認 → 実装 → `npm test` と `npx tsc --noEmit` が通る → コミット。

### Task 3: 津波タイルの読み取りと到達時間データ（アプリ）

**Files:**
- Create: `src/app/tsunami-tile.ts`
- Modify: `src/app/data.ts`
- Test: `tests/app/tsunami-tile.test.ts`, `tests/app/data.test.ts`

**Interfaces:**
- Consumes: `bandFromRgba`, `TsunamiBand`（Task 2）。
- Produces:
  - `export const TSUNAMI_TILE_URL: string`（Task 1 で確定した値）、`export const TSUNAMI_TILE_ZOOM: number`（Task 1 で確定した最大ズーム）
  - `export function tileAndPixel(pos: LatLon, z: number): { x: number; y: number; px: number; py: number }`（Web メルカトル、256px タイル）
  - `export type PixelReader = (url: string, px: number, py: number) => Promise<[number, number, number, number]>`
  - `export async function tsunamiAt(pos: LatLon, read: PixelReader): Promise<TsunamiBand | 'none' | 'unknown'>` — 読み取りの例外・404 は 'unknown'。同じタイルは1回だけ読む（キャッシュ）。
  - `export function canvasPixelReader(): PixelReader`（ブラウザ用。`fetch` → `createImageBitmap` → OffscreenCanvas/Canvas → `getImageData`。404 のタイルは透明＝'none' ではなく例外にする）
  - DataSource に `tsunamiArrival(muniCode: string): Promise<number | null>`（`tsunami_arrival.json` = `{ "<5桁市町村コード>": 分 | null }`、ファイル無しは null）

- [ ] Step 1: 失敗するテスト: `tileAndPixel` が既知の点（例: 35.02, 136.5072, z=17）で手計算と一致。`tsunamiAt` が偽の reader で段階／'none'／例外→'unknown'、同じタイルを2回読まない。`tsunamiArrival` がコードありで数値、無しで null、ファイル 404 で null。
- [ ] Step 2: 失敗を確認 → 実装 → テスト・tsc → コミット。

### Task 4: 到達時間の表（三重）

**Files:**
- Create: `data/published/mie_tsunami_arrival.csv`, `pipeline/tsunami_arrival.py`, `pipeline/tests/test_tsunami_arrival.py`

**Interfaces:**
- CSV 列: `muni_code,muni_name,m030,m100,m300,m500,m1000`（分、「－」は空欄）。
- `build_arrival(csvs: list[Path], out: Path) -> int` — 複数県の CSV を一つの `{muni_code: m030 or null}` に。同じコードが2回あれば ValueError。manifest に dataset `tsunami-arrival` を追加（出典は各県の報告書名・ページ）。
- CLI: `python3 -m pipeline.tsunami_arrival --csv data/published/*_tsunami_arrival.csv --out public/data/tsunami_arrival.json`

- [ ] Step 1: 三重の表を `data/raw/mie_reports/mie_honpen.txt` の「沿岸津波到達時間」（本編 p.28、L2）から全市町分書き写す（海に面していない市町は行を作らない）。値は例えば 尾鷲市 m030=3、四日市市 m030=15、桑名市 m030=3・m100=87、朝日町はすべて空欄。
- [ ] Step 2: 失敗するテスト（合成 CSV 2つ、重複コードで ValueError、空欄→null）→ 実装 → pytest → 実データで実行し件数を報告 → コミット（CSV・パイプライン・テスト・manifest）。

### Task 5: 画面に津波を出す

**Files:**
- Modify: `src/app/viewmodel.ts`, `src/app/main.ts`, `src/app/ui/result.ts`, `src/app/ui/map.ts`, `src/app/ui/shelters.ts`, `src/app/ui/last.ts`, `src/app/ui/about.ts`, `src/app/storage.ts`
- Test: `tests/app/viewmodel.test.ts`, `tests/app/storage.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: Task 2・3 の関数。
- Produces:
  - `HomeVM`（ok）に `tsunami: { kind: 'band'; depth: string; arrival: string | null } | { kind: 'none' } | { kind: 'unknown' }`。depth は「1〜3m」「20m以上」「0.3m未満」の形。arrival は「海岸への到達 最短約{n}分（30cm）」または null。
  - `homeViewModel(cell, input, tsunami: TsunamiBand | 'none' | 'unknown', arrivalMin: number | null)`
  - `evacuationViewModel(origin, shelters, arrivalMin: number | null)` — 津波リストの reach は Task 2 の新しい判定、文言は Global Constraints。
  - 周辺: `estimateArea` に渡す各マスの `tsunamiDepth` に、そのマス中心の段階の mid（'none' は 0、'unknown' は null）を入れる。
  - `Saved` を v3 に: 津波の段階の文言と判定の文言を保存（座標なし）。v2 以前は破棄。
- [ ] Step 1: 失敗するテスト: viewmodel（段階・none・unknown の3通り、到達あり／なし、各判定の文言）、storage v3（v2 は null）、e2e（`page.route` で津波タイルを「1〜3m の色だけの 256×256 PNG」に差し替え → 浸水深の行と判定が出る／透明 PNG → 浸水域外の文言／タイル 500 → 「津波は含まれていません」注意）。
- [ ] Step 2: 実装。地図に津波タイルを不透明度 0.5 で重ね、凡例（8色）と出典表示。about にタイル取得先の説明を追加。
- [ ] Step 3: `npm test`、tsc、build、`npx playwright test`、offline 設定が通る。390×844 のスクリーンショットを撮って確認 → コミット。

### Task 6: パイプラインを県コード対応にする

**Files:**
- Modify: `pipeline/building_stock.py`, `pipeline/shelters.py`, `pipeline/naikaku_hazard.py`, `scripts/reconcile.ts`
- Create: `pipeline/merge.py`
- Test: `pipeline/tests/test_building_stock.py`, `pipeline/tests/test_shelters.py`, `pipeline/tests/test_naikaku_hazard.py`, `pipeline/tests/test_merge.py`, `tests/scripts/reconcile.test.ts`

**Interfaces:**
- `building_stock.py`: `--pref <2桁コード>`（必須）。県名・境界ファイル名・住宅統計ファイル名・固定資産の行をコードから決める（`PREFS = {"21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県"}`）。出力は `out/<pref>/` に一度書き、Task 7 でまとめる。
- `naikaku_hazard.py`: `--eq` と `--liq` を複数受け取り、同じメッシュが複数ファイルにあれば値が一致することを確認（不一致は ValueError）。
- `shelters.py`: `--csv` を複数受け取る。id の重複は1件にまとめる。
- `merge.py`: `merge_mesh_dirs(srcs: list[Path], dst: Path) -> int` — 2次メッシュ JSON を統合。同じメッシュのキーが異なる値なら ValueError。`index.json` と `municipality_meshes.json` も統合。
- `reconcile.ts`: `--pref <code>` で `data/published/<pref>_municipal.csv` を読む（既定 24）。県合計の比較対象（国の想定値）は CSV の注記行ではなく引数 `--national <棟数>`（三重は 157000）。
- 三重の出力が変わらないこと: 直す前の `public/data` のコピーと、直した後に `--pref 24` で作った出力が一致するテスト（実データがある環境でのみ実行、無ければ skip）。

- [ ] Step 1: 失敗するテスト（県コード → 名前・ファイル名、統合の一致／不一致、複数 CSV の重複 id）→ 実装 → pytest・npm test → 三重の一致確認 → コミット。

### Task 7: 4県のデータを作り、答え合わせする

**Files:**
- Create: `data/published/{22,23,21}_municipal.csv`（県公表の市町村別 揺れによる全壊棟数）, `data/published/shizuoka_tsunami_arrival.csv`, `data/published/aichi_tsunami_arrival.csv`, `docs/reports/2026-11-12-tokai-reconcile.md`
- Rename: `data/published/mie_municipal.csv` → `data/published/24_municipal.csv`（reconcile の参照も直す）

- [ ] Step 1: Task 1 のノートの表から、県公表値と到達時間を書き写す（出典ページを CSV の先頭コメントではなく manifest に記録）。
- [ ] Step 2: 4県それぞれでハザード・建物・避難場所を作り、`merge.py` で `public/data` に統合。到達時間 JSON を作り直す。
- [ ] Step 3: `reconcile.ts --pref` を4県で実行。県が使ったケースに合わせる（Task 1 で確認したもの。ルールとして記録）。県合計の比と ±30% に入る市町村の数を報告書にまとめる。三重の数値が前回（165,798 棟、29市町中20）と同じであること。
- [ ] Step 4: 報告書・CSV・manifest をコミット（生データと public/data はコミットしない）。

### Task 8: 4県向けの文言と画面

**Files:**
- Modify: `src/app/text.ts`, `src/app/ui/about.ts`, `src/app/ui/actions.ts`, `src/app/main.ts`
- Test: `tests/app/*.test.ts`, `tests/e2e/smoke.spec.ts`

- [ ] Step 1: 失敗するテスト: 対応エリアの表記が Global Constraints の文言。補助制度の検索リンクが自宅の市町村名で作られる（静岡市・名古屋市・岐阜市の例）。e2e で愛知の住所（偽の住所検索結果）を入れて結果が出る（テスト用の小さなデータを `tests/e2e/fixtures` から配信するか、実データがあればそれを使う）。
- [ ] Step 2: 実装 → テスト・tsc・build・Playwright → コミット。
