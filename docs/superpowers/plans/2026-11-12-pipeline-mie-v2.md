# 三重県データ加工と照合 v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 内閣府データセットA（令和7年）・国勢調査メッシュ・住宅土地統計・固定資産概要調書から、三重県のメッシュ別ハザードと建物ストックを作り、県の市町別公表値（L2 揺れ全壊）と照合する。

**Architecture:** 加工は Python（`pipeline/`）、照合はエンジン（`src/core/`）を Node で呼ぶ TypeScript スクリプト（`scripts/`）。生データは `data/raw/`（git 対象外）にある。出力は `public/data/`（git 対象外、`manifest.json` のみ追跡）。

**Tech Stack:** Python 3.13 / pandas / geopandas / openpyxl / pytest、TypeScript（`tsx --test`、node:test）

**Spec:** `docs/superpowers/specs/2026-11-12-nankai-trough-sim-design.md`
**置き換え:** `docs/superpowers/plans/2026-11-12-core-engine-and-mie-validation.md` の Task 6〜8（データの入手先が変わったため）。避難場所データ（国土地理院）は接続できないため本計画の対象外。

## Global Constraints

- メッシュは 250m（10桁）。内閣府の MESH 列は 4分の1地域メッシュでエンジンの `latLonToMesh250` と同じコード体系
- 震度は参考震度 `Ia` を使う（`I` は表示用の丸め値）。`Ia < 0` は計算対象外 → 出力しない
- 液状化: `S` は沈下量 **m** → エンジンには **cm**（×100）で渡す。`S < 0`（対象層なし）または Liq ファイルに無いメッシュは `null`
- ケース: `L2`=Eq_champ/Liq_champ、`HALF_E`=Eq_1E/Liq_1E、`HALF_W`=Eq_1W/Liq_1W
- ハザード出力の形式（元の計画 Task 6 と同じ）: `public/data/hazard/{case}/{mesh2}.json` = `{ "<mesh250>": [Ia, PL, settlementCm, tsunamiDepth, tsunamiArrivalMin] }`（津波2項目は本計画では常に `null`）
- 建物出力の形式（元の計画 Task 7 と同じ）: `public/data/stock/{mesh2}.json` = `{ "<mesh250>": { "total": number, "shares": { "wood:pre1981": ..., } } }`、shares の合計は 1
- 内閣府データの利用規程: 元データの再配布禁止（形式変換を含む）。`public/data/hazard/` は git 対象外のまま。公開用の変換は別計画
- `manifest.json` に各データセットの出典・URL・公開日・ライセンス/利用条件・加工日・notes を記録
- 照合の合格基準: 市町の揺れ全壊棟数が公表値の ±30%（R12: 揺れのみで比較）

## Review Focus

1. **液状化ファイルにないメッシュ** — Liq は「液状化対象微地形かつ震度5弱以上」のみ。無いメッシュは `null`（0 ではない）。Task 1 にテスト
2. **住宅土地統計が無い町（人口1万5千人未満）** — 構造×年代の割合は県計の割合で代用し、manifest の notes にどの市町が代用かを書く。Task 2 にテスト
3. **世帯0のメッシュ** — 建物を配らない（total 0 → 出力しない）。町の世帯がすべて 0 の場合は例外。Task 2 にテスト
4. **境界にまたがるメッシュ** — メッシュ中心点が入る市町に割り当てる（二重計上しない）。Task 2 にテスト
5. **公表値の「約」と「-」** — 「-」はわずか（5未満）→ 照合対象外。Task 3 にテスト

---

## ファイル構成
```
pipeline/naikaku_hazard.py      内閣府CSV → hazard JSON
pipeline/building_stock.py      国勢調査メッシュ + 境界 + 住宅土地統計 + 固定資産 → stock JSON
pipeline/manifest.py            manifest.json の追記
pipeline/tests/test_naikaku_hazard.py, test_building_stock.py, fixtures/
scripts/reconcile.ts            市町合計の照合（エンジン使用）
tests/scripts/reconcile.test.ts
data/published/mie_municipal.csv  県の公表値（追跡する）
```
入力（`data/raw/`、既に配置済み）:
- `naikaku/mie_{Eq,Liq}_{champ,1E,1W}.csv`（三重県周辺の1次メッシュ 5035,5036,5135,5136,5235,5236 を切り出し済み）
- `census_mesh/tblT001142Q{1次メッシュ}.txt`（令和2年国勢調査 4分の1地域メッシュ、cp932、2行目が日本語見出し、「世帯総数」列）
- `boundary/r2ka24.shp`（令和2年国勢調査 小地域境界 三重県、EPSG:6668、`CITY`=市町コード3桁、`CITY_NAME`）
- `housing/mie_housing_r5.txt`（令和5年住宅・土地統計 三重県結果の pdftotext。「第6-3表」の市町ブロック: `3桁コード 市町名` の行に続き「住宅総数」と建築時期7行。列は 総数, 専用住宅, 併用住宅, 木造, 非木造, 鉄筋・鉄骨コンクリート造, 鉄骨造, その他）
- `kotei/kotei_r06_soukatsu.xlsx`（固定資産の価格等の概要調書 令和6年度 総括表。列: 団体コード, 都道府県名, 市町村名, 表側, 団体区分, 棟数, …。表側「木造・総数」「木造以外・総数」を使う）

---

### Task 1: 内閣府ハザードの加工

**Files:** Create `pipeline/naikaku_hazard.py`, `pipeline/manifest.py`; Test `pipeline/tests/test_naikaku_hazard.py`（小さな fixture CSV を tests/fixtures に置く）

**Interfaces:**
- Produces: `build_hazard(eq_csv: Path, liq_csv: Path, case: str, out_dir: Path) -> int`（書いたメッシュ数）、CLI `python3 -m pipeline.naikaku_hazard --raw data/raw/naikaku --out public/data/hazard`（3ケースすべて）
- `update_manifest(path: Path, dataset: dict) -> None`（id が同じなら置き換え）

- [ ] Step 1: 失敗するテスト
  - `Ia` が出力の0番目、`PL` が1番目、`S=0.03` → `3.0`（cm）が2番目、3・4番目は `None`
  - `Ia=-1.000` のメッシュは出力されない
  - Liq に無いメッシュ → PL と settlement が `None`。`S=-1.00` → `None`
  - 2次メッシュ（先頭6桁）ごとのファイルに分かれる
  - 引用符つき MESH（`"5236442023"`）も引用符なしも読める
- [ ] Step 2: `pytest pipeline/tests -v` で失敗確認 → Step 3: 実装 → Step 4: 成功確認
- [ ] Step 5: 実データで3ケースを生成し、`5236442023` の L2 が `[5.862, 10.88, 3.0, null, null]` であることを確認（CLI の出力に表示）。manifest に出典「内閣府 南海トラフの巨大地震モデル・被害想定手法検討会 データセットA（令和7年）」、URL `https://www.geospatial.jp/ckan/dataset/02543200-9310-4fc0-bcbb-bb1d4ff64990`、利用条件（加工物は頒布可・元データの再配布禁止・出典明記）を記録
- [ ] Step 6: コミット（`public/data/manifest.json` は追跡、hazard は対象外）

### Task 2: 建物ストックの加工

**Files:** Create `pipeline/building_stock.py`; Test `pipeline/tests/test_building_stock.py`

**Interfaces:**
- `parse_housing_6_3(txt: Path) -> dict[str, dict[str, float]]`（市町名 → StockKey → 住宅数）
  - 年代: 1970年以前+1971〜1980 → pre1981、1981〜1990+1991〜2000 → y1981_2000、2001〜2010+2011〜2020+2021〜2023/9 → post2000
  - 構造: 木造 → wood、鉄筋・鉄骨コンクリート造 → rc、鉄骨造 → steel、その他は除外。「-」は 0
  - 「三重県」の県計ブロックも返す（キー `"三重県"`）
- `parse_kotei(xlsx: Path, pref: str) -> dict[str, tuple[int, int]]`（市町名 → (木造棟数, 木造以外棟数)）
- `build_stock(census_dir, boundary_shp, housing, kotei, out_dir) -> dict[str, int]`（市町名 → 割り当てた棟数合計）
  - 各メッシュ中心点を含む市町に割り当て（`geopandas.sjoin`）。県外の点は捨てる
  - 市町ごと: 棟数（固定資産の木造/木造以外）をメッシュの世帯総数で按分。構造×年代の割合は木造・非木造それぞれ住宅統計の割合（住宅統計に無い市町は県計の割合、notes に列挙）
  - `shares` は木造・非木造の棟数比で重み付けして合計 1 に正規化
- CLI `python3 -m pipeline.building_stock --raw data/raw --out public/data/stock`

- [ ] Step 1: 失敗するテスト（fixture は 2市町・数メッシュの手作りデータ）
  - 第6-3表のパース: 菰野町の `wood:pre1981 == 1330+1710`、`rc:post2000 == 330+520+30`（実ファイルの抜粋を fixture にする）
  - 固定資産のパース: 菰野町 `(24209, 11369)`（実ファイルで確認するテスト）
  - 市町ごとの割り当て棟数の合計 = 固定資産の木造+木造以外（世帯 0 のメッシュは除外、合計は保存）
  - 中心点が境界外のメッシュは割り当てない。1メッシュは1市町にだけ入る
  - 住宅統計に無い町は県計の割合を使い、notes に町名が入る
  - 町の全メッシュの世帯が 0 → `ValueError`
- [ ] Step 2: 失敗確認 → Step 3: 実装 → Step 4: 成功確認
- [ ] Step 5: 実データで生成。29市町の割り当て棟数が固定資産の棟数と一致することを CLI 出力で確認。manifest に 3データセット（国勢調査メッシュ、住宅土地統計、固定資産）を記録
- [ ] Step 6: コミット

### Task 3: 照合

**Files:** Create `scripts/reconcile.ts`, `data/published/mie_municipal.csv`; Test `tests/scripts/reconcile.test.ts`

**Interfaces:**
- `reconcile(rows: { municipality: string; case: string; published: number | null; computed: number }[], tolerance = 0.3): { municipality, case, ratio: number | null, pass: boolean | null }[]` — `published` が null（「-」）は ratio/pass とも null
- CLI `tsx scripts/reconcile.ts` → `reports/reconcile-mie-L2.md`（git 対象外）と標準出力の要約
  - 市町ごとに、その市町に割り当てたメッシュについて `shakeRates(Ia, s, e)`（揺れのみ, R12）× 棟数 × shares を合計。非木造は階数未入力（全階数の包絡）
  - 市町とメッシュの対応は Task 2 の CLI が `public/data/stock/municipality_meshes.json`（`{ 市町名: [mesh...] }`）として出力したものを使う（Task 2 に追加の出力として含める）
  - `src/data/fragility.json` を `useFragilityTable` で登録して使う

`data/published/mie_municipal.csv`（三重県南海トラフ地震被害想定 令和8年3月 本編 p.96「全壊・焼失棟数（各市町の最大値）」揺れ列、L2）:
```
municipality,case,shake_collapse
桑名市,L2,4800
いなべ市,L2,600
木曽岬町,L2,700
東員町,L2,600
四日市市,L2,20000
菰野町,L2,1400
朝日町,L2,500
川越町,L2,800
鈴鹿市,L2,7800
亀山市,L2,1000
津市,L2,19000
松阪市,L2,20000
多気町,L2,4200
明和町,L2,4400
大台町,L2,1500
伊賀市,L2,900
名張市,L2,400
伊勢市,L2,26000
鳥羽市,L2,3200
志摩市,L2,8800
玉城町,L2,2700
南伊勢町,L2,5000
大紀町,L2,1200
度会町,L2,1200
尾鷲市,L2,4400
紀北町,L2,5100
熊野市,L2,3800
御浜町,L2,1600
紀宝町,L2,1000
```

- [ ] Step 1: 失敗するテスト: ±30% の境界（1.29 pass / 1.32 fail）、published null → pass null、レポートに manifest の notes（非住宅にも住宅の割合を当てた仮定）が載る
- [ ] Step 2: 失敗確認 → Step 3: 実装 → Step 4: 成功確認
- [ ] Step 5: 実データで実行。菰野町が約 1,170（±5%）になることを確認（2026-11-12 の試算と一致するか）。結果の数字は変えず、不合格の市町は原因の候補（県独自の地盤モデル、沿岸の津波地域、年代区分）をレポートに書く
- [ ] Step 6: コミット（csv とスクリプトのみ）
