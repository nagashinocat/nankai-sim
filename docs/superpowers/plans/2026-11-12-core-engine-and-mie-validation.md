# 計算エンジンと三重県データ照合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 住所の座標と建物情報から自宅・周辺の被害率と避難場所を計算するエンジン（ブラウザで動く TypeScript）と、三重県のオープンデータをメッシュファイルに加工するパイプラインを作り、菰野町の公表値と照合して合否を出す。

**Architecture:** 計算はすべて純粋関数の TypeScript モジュール（`src/core/`）にまとめ、画面からは後で呼ぶだけにする。元データの加工はオフラインの Python パイプライン（`pipeline/`）で行い、2次メッシュ単位の JSON と `manifest.json` を `public/data/` に出力する。照合スクリプトはエンジンを Node で呼んで市町村合計を出し、公表値と比べる。

**Tech Stack:** TypeScript 5 / Vite / Vitest（エンジン）、Python 3.11 / pandas / geopandas / pytest（パイプライン）

**Spec:** `docs/superpowers/specs/2026-11-12-nankai-trough-sim-design.md`

この計画の範囲は設計書 §11 の「準備」段階のうち、エンジン・パイプライン・照合。画面（§5）、`geocode`・`hazardLoader`・Service Worker（§9）は次の計画で扱う。

## Global Constraints

- メッシュは 250m（5次地域メッシュ、10桁、JIS X 0410 の分割規則）
- 構造: `wood` / `steel` / `rc`。年代: `pre1981`（1981年5月以前）/ `y1981_2000`（1981年6月〜2000年5月）/ `post2000`（2000年6月以降）
- 被害関数は国の2025年想定（内閣府 南海トラフ巨大地震 被害想定手法）の値を使う。値を推測で作らない
- 被害の合成順は 揺れ → 液状化 → 津波。全壊率＋半壊率は 1 を超えない
- 幅は想定震度 ±0.5 で計算する。「わからない」は全選択肢の最小〜最大
- 耐震補強済みはひとつ新しい年代で計算（`post2000` はそのまま）
- データがないマスは計算しない（`null` を返す）。推測で埋めない
- 照合の合格基準: 市町村の揺れによる全壊棟数が公表値の ±30% 以内
- 照合の最初の基準: 三重県菰野町 L2 揺れによる全壊 約1,400棟、L1 約40棟
- 出典・版・公開日・ライセンス・加工日を `manifest.json` に記録する

## Review Focus

1. **公表値は「全建物」、統計の年代割合は「住宅」だけ** — 住宅・土地統計調査は住宅のみが対象。非住宅の建物にも住宅の割合を当てはめると照合がずれる。Task 7 の割合計算で「住宅以外は木造・年代は市町村の住宅割合と同じ」と仮定していることを `manifest.json` に記録し、照合レポートに注記するテストを Task 8 に置く
2. **震度 ±0.5 で曲線の範囲外に出る** — 震度 7.0 付近で +0.5 すると表の上限を超える。上限・下限で値を固定し、例外にしないこと。Task 2 にテストを置く
3. **メッシュ境界上の座標** — 緯度経度がちょうど境界にあるとき、南西側のメッシュに入る（JIS の規則）。Task 1 にテストを置く
4. **想定エリア外・海上の座標** — データファイルに該当マスがないとき、エンジンは `null` を返し、合計計算ではそのマスを数えない。Task 3・Task 6 にテストを置く
5. **避難場所の災害種別の欠落** — 指定緊急避難場所データで津波欄が空の施設を「津波対応」と扱わない。Task 5 にテストを置く

---

## ファイル構成

```
package.json, tsconfig.json, vitest.config.ts
src/core/
  types.ts           共通の型
  mesh.ts            緯度経度 ⇔ 5次メッシュ、周辺メッシュ
  fragility.ts       被害関数の表の読み込みと補間
  damage.ts          合成・幅・補強・時間差
  neighborhood.ts    周辺の推計
  evacuation.ts      避難場所の絞り込みと徒歩時間
src/data/
  fragility.json     被害関数の表（Task 2 で転記）
tests/core/*.test.ts
pipeline/
  pyproject.toml
  mie_hazard.py      三重県ハザード → メッシュ JSON
  building_stock.py  建物数・割合 → メッシュ JSON
  manifest.py        manifest.json の生成
  tests/
scripts/
  reconcile.ts       市町村合計と公表値の照合
data/published/
  mie_municipal.csv  公表値（市町, ケース, 揺れ全壊棟数）
public/data/         パイプラインの出力（git には manifest.json と小さなサンプルだけ入れる）
```

---

### Task 1: 開発環境とメッシュ計算

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/core/types.ts`, `src/core/mesh.ts`
- Test: `tests/core/mesh.test.ts`

**Interfaces:**
- Produces:
  - `type LatLon = { lat: number; lon: number }`
  - `latLonToMesh250(p: LatLon): string` — 10桁
  - `meshCenter(code: string): LatLon`
  - `mesh2Of(code: string): string` — 先頭6桁（2次メッシュ。ファイル名に使う）
  - `meshesWithin(center: LatLon, radiusM: number): string[]` — 中心点が半径内にある 250m メッシュ

- [ ] **Step 1: Vite + Vitest + TypeScript の雛形を作る。** `npm test` で `vitest run` が動くこと。
- [ ] **Step 2: 失敗するテストを書く**

```ts
// 値は J-SHIS 地震ハザードカルテのメッシュコードと中心座標
test.each([
  [34.9656, 136.6234, '5236345944'], // 四日市市諏訪町
  [34.8823, 136.5828, '5236245643'], // 鈴鹿市神戸
  [35.1823, 136.9078, '5236671243'], // 名古屋市中区三の丸
])('latLonToMesh250(%f,%f) = %s', (lat, lon, code) => {
  expect(latLonToMesh250({ lat, lon })).toBe(code);
});
test('meshCenter は元の中心から 0.0001度以内', () => {
  const c = meshCenter('5236345944');
  expect(c.lat).toBeCloseTo(34.9656, 3);
  expect(c.lon).toBeCloseTo(136.6234, 3);
});
test('境界上の点は南西側のメッシュに入る', () => {
  const c = meshCenter('5236345944');
  // 5次メッシュは 緯度7.5秒(1/480度) × 経度11.25秒(1/320度)。
  // 中心 + 半分 = 北東の角 = 北東隣のメッシュの南西の角 → 隣のメッシュに入る
  expect(latLonToMesh250({ lat: c.lat + 1/960, lon: c.lon + 1/640 })).not.toBe('5236345944');
});
test('mesh2Of', () => expect(mesh2Of('5236345944')).toBe('523634'));
test('meshesWithin 半径0は自分だけ、半径1000mは 40〜60 個', () => {
  const c = meshCenter('5236345944');
  expect(meshesWithin(c, 0)).toEqual(['5236345944']);
  const n = meshesWithin(c, 1000).length;
  expect(n).toBeGreaterThanOrEqual(40); expect(n).toBeLessThanOrEqual(60);
});
```

- [ ] **Step 3: `npx vitest run tests/core/mesh.test.ts` を実行し、失敗を確認する**
- [ ] **Step 4: `mesh.ts` を実装する。** 1次（緯度40分×経度1度）→ 2次（8分割）→ 3次（10分割）→ 4次・5次（それぞれ2分割、番号は 南西1・南東2・北西3・北東4）。距離は球面近似（半径 6,371,000m）。
- [ ] **Step 5: テストを実行し、成功を確認する**
- [ ] **Step 6: コミットする** `git commit -m "feat(core): 5次メッシュ計算"`

---

### Task 2: 被害関数（単一要因）

**Files:**
- Create: `src/data/fragility.json`, `src/core/fragility.ts`
- Test: `tests/core/fragility.test.ts`

**Interfaces:**
- Consumes: `types.ts`
- Produces:
  - `type Structure = 'wood' | 'steel' | 'rc'`
  - `type Era = 'pre1981' | 'y1981_2000' | 'post2000'`
  - `type Rates = { collapse: number; half: number }`
  - `shakeRates(intensity: number, s: Structure, e: Era): Rates`
  - `liquefactionRates(pl: number, s: Structure, e: Era): Rates`
  - `tsunamiRates(depthM: number, s: Structure): Rates`

`fragility.json` の形式:
```json
{ "source": "内閣府 南海トラフ巨大地震 被害想定手法（令和7年3月）",
  "page": "<転記したページ>",
  "shake":   { "wood:pre1981": [[計測震度, 全壊率, 全壊+半壊率], ...], ... },
  "liquefaction": { ... }, "tsunami": { "wood": [[浸水深m, 全壊率, 全壊+半壊率], ...], ... } }
```

- [ ] **Step 1: 内閣府の被害想定手法の資料から表を転記する。** 揺れは計測震度 0.1 刻み（資料が曲線のパラメータで示す場合は、そのパラメータから 0.1 刻みの表を生成するスクリプトを `pipeline/` に置き、パラメータも JSON に残す）。出典ページを `page` に書く。
- [ ] **Step 2: 失敗するテストを書く**

```ts
test('震度が上がると全壊率は減らない（全キー）', ...);
test('同じ震度なら古い年代ほど全壊率が高い（木造, 計測震度6.5）', () => {
  const r = (e: Era) => shakeRates(6.5, 'wood', e).collapse;
  expect(r('pre1981')).toBeGreaterThan(r('y1981_2000'));
  expect(r('y1981_2000')).toBeGreaterThan(r('post2000'));
});
test('表の範囲外は端の値で固定し、例外にしない', () => {
  expect(shakeRates(7.6, 'wood', 'pre1981')).toEqual(shakeRates(7.0, 'wood', 'pre1981')); // 7.0 は表の上限の例。実際の上限値に合わせる
  expect(shakeRates(3.0, 'rc', 'post2000')).toEqual({ collapse: 0, half: 0 });
});
test('collapse + half <= 1、half >= 0（全キー・全点）', ...);
test('転記の抜き取り確認: 資料の代表点 3 点と一致', ...); // 値は Step 1 で資料から読み、ページ番号をコメントに書く
```

- [ ] **Step 3: テストを実行し、失敗を確認する**
- [ ] **Step 4: `fragility.ts` を実装する。** 表の間は線形補間。`half = (全壊+半壊率) − 全壊率`。
- [ ] **Step 5: テストを実行し、成功を確認する**
- [ ] **Step 6: コミットする** `git commit -m "feat(core): 被害関数の表と補間"`

---

### Task 3: 自宅の被害（合成・幅・補強・時間差）

**Files:**
- Create: `src/core/damage.ts`
- Test: `tests/core/damage.test.ts`

**Interfaces:**
- Consumes: Task 2 の関数と型
- Produces:
  - `type HazardCell = { intensity: number | null; pl: number | null; tsunamiDepth: number | null; tsunamiArrivalMin: number | null }`
  - `type Range = [number, number]`
  - `type HomeInput = { structure: Structure | 'unknown'; era: Era | 'unknown'; retrofitted: boolean }`
  - `combine(list: Rates[]): Rates`
  - `ratesForCell(cell: HazardCell, s: Structure, e: Era): Rates | null` — `intensity` が `null` なら `null`
  - `estimateHome(cell: HazardCell, input: HomeInput): { collapse: Range; half: Range } | null`
  - `estimateLag(first: HazardCell, second: HazardCell, s: Structure, e: Era): Rates | null`

時間差の式（設計書 §4.5）。`older(e)` はひとつ古い年代：

```
f = ratesForCell(first, s, e); u = 1 - f.collapse - f.half
ri = ratesForCell(second, s, e)                   // 無傷だった分
rd = e === 'pre1981'
     ? { collapse: r.collapse + r.half, half: 0 } // r = ratesForCell(second, s, 'pre1981')
     : ratesForCell(second, s, older(e))          // 先発で半壊した分
collapse = f.collapse + u * ri.collapse + f.half * rd.collapse
half     = u * ri.half + f.half * (1 - rd.collapse)
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('combine は二重に数えない', () => {
  expect(combine([{collapse:.5,half:0},{collapse:.5,half:0}]).collapse).toBeCloseTo(.75);
});
test('combine の結果は collapse+half <= 1', ...);
test('intensity が null のマスは null', () => {
  expect(estimateHome({intensity:null,pl:null,tsunamiDepth:null,tsunamiArrivalMin:null},
    {structure:'wood',era:'pre1981',retrofitted:false})).toBeNull();
});
test('幅は ±0.5 を含む: min <= 中央値 <= max', ...);
test('unknown の幅は既知のどの選択肢の幅も含む', ...);
test('補強済み pre1981 = 未補強 y1981_2000', ...);
test('補強済み post2000 = 未補強 post2000', ...);
test('時間差の全壊率 >= 後発単独の全壊率', ...);
test('時間差で先発の被害がゼロなら後発単独と同じ', ...);
```

- [ ] **Step 2: テストを実行し、失敗を確認する**
- [ ] **Step 3: `damage.ts` を実装する。** 合成順は揺れ → 液状化 → 津波（`pl`・`tsunamiDepth` が `null` の要因は飛ばす）。
- [ ] **Step 4: テストを実行し、成功を確認する**
- [ ] **Step 5: コミットする** `git commit -m "feat(core): 自宅の被害（合成・幅・補強・時間差）"`

---

### Task 4: 周辺の推計

**Files:**
- Create: `src/core/neighborhood.ts`
- Test: `tests/core/neighborhood.test.ts`

**Interfaces:**
- Consumes: `ratesForCell`、`HazardCell`
- Produces:
  - `type StockKey = \`${Structure}:${Era}\``
  - `type BuildingStock = { total: number; shares: Partial<Record<StockKey, number>> }` — `shares` の合計は 1
  - `estimateArea(cells: Record<string, HazardCell>, stock: Record<string, BuildingStock>, meshes: string[]): { collapse: number; half: number; countedMeshes: number }` — 棟数
  - `meshCollapseRate(cell: HazardCell, stock: BuildingStock): number | null` — 地図の色分け用

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('建物100棟・全部 wood:pre1981 なら 100 × 全壊率', ...);
test('cells か stock にないメッシュは数えず countedMeshes にも入れない', ...);
test('shares の合計が 1 から 0.01 以上ずれていたら例外', ...);
```

- [ ] **Step 2: 失敗を確認 → Step 3: 実装 → Step 4: 成功を確認**
- [ ] **Step 5: コミットする** `git commit -m "feat(core): 周辺の推計"`

---

### Task 5: 避難場所

**Files:**
- Create: `src/core/evacuation.ts`
- Test: `tests/core/evacuation.test.ts`

**Interfaces:**
- Consumes: `LatLon`
- Produces:
  - `type Shelter = { id: string; name: string; pos: LatLon; earthquake: boolean; tsunami: boolean }`
  - `nearestShelters(origin: LatLon, shelters: Shelter[], opts: { hazard: 'earthquake' | 'tsunami'; speedMps: number; limit: number }): { shelter: Shelter; distanceM: number; walkMin: number }[]`
  - `reachBeforeTsunami(walkMin: number, arrivalMin: number | null): 'ok' | 'tight' | 'no' | 'n/a'`
  - 定数: `WALK_SPEED = { standard: 1.0, slow: 0.5 }`（m/s）、`DETOUR_FACTOR = 1.3`（直線距離を道のりに換算）

この計画で決めた値（設計書にはないので、画面で「目安」と明記する）: 徒歩速度 標準 1.0m/s・ゆっくり 0.5m/s、迂回係数 1.3、`tight` は所要時間が到達時間の 80% 以上 100% 以下。

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('tsunami 指定では tsunami=false の施設を除外', ...);
test('データの津波欄が空 → 取り込み時に false（Task 6 のパーサーと合わせる）', ...);
test('近い順に limit 件', ...);
test('walkMin = 直線距離 × 1.3 ÷ 速度 ÷ 60', ...);
test.each([[10,20,'ok'],[17,20,'tight'],[25,20,'no'],[10,null,'n/a']])('reachBeforeTsunami(%d,%s)=%s', ...);
```

- [ ] **Step 2: 失敗を確認 → Step 3: 実装 → Step 4: 成功を確認**
- [ ] **Step 5: コミットする** `git commit -m "feat(core): 避難場所の絞り込み"`

---

### Task 6: 三重県ハザードデータの加工パイプライン

**Files:**
- Create: `pipeline/pyproject.toml`, `pipeline/mie_hazard.py`, `pipeline/shelters.py`, `pipeline/manifest.py`
- Test: `pipeline/tests/test_mie_hazard.py`, `pipeline/tests/test_shelters.py`, `pipeline/tests/fixtures/`

**Interfaces:**
- Produces（ファイル形式。エンジンはこの形を読む）:
  - `public/data/hazard/{case}/{mesh2}.json` = `{ "<mesh250>": [intensity, pl, tsunamiDepth, tsunamiArrivalMin], ... }`（欠損は `null`）。`case` は `L2` / `L1` / `HALF_E` / `HALF_W`
  - `public/data/shelters/{mesh2}.json` = `Shelter[]`（Task 5 の型）
  - `public/data/manifest.json` = `{ "version": "YYYYMMDD.n", "datasets": [{ "id", "source", "url", "publishedAt", "license", "processedAt", "notes" }] }`
  - CLI: `python -m pipeline.mie_hazard --src <dir> --case L2 --out public/data/hazard`

- [ ] **Step 1: 三重県の公開データ（震度予測・液状化・津波浸水想定）と、国土地理院の指定緊急避難場所データを取得する。** 形式（シェープファイル・CSV・メッシュ）を確認し、`pipeline/README.md` に入手元 URL・形式・ライセンス（三重県は CC BY 4.0）を書く。三重県のデータが 250m メッシュでない場合は、各 250m メッシュの中心点の値を取る（ポリゴンなら中心点を含むポリゴンの値、細かいメッシュなら中心点を含むセル）。
- [ ] **Step 2: 小さな fixture（3×3 メッシュ分）で失敗するテストを書く**

```python
def test_meshcode_matches_ts():  # Task 1 と同じ3点
    assert to_mesh250(34.9656, 136.6234) == "5236345944"
def test_output_grouped_by_mesh2(tmp_path): ...
def test_missing_values_are_null(tmp_path): ...
def test_sea_cells_not_written(tmp_path): ...   # データのないマスはキー自体を出さない
def test_shelter_tsunami_blank_is_false(): ...
def test_manifest_has_required_fields(tmp_path): ...
```

- [ ] **Step 3: `pytest pipeline/tests -v` で失敗を確認 → Step 4: 実装 → Step 5: 成功を確認**
- [ ] **Step 6: 菰野町と周辺で実データを加工し、`public/data/` に出力する。** 生成ファイルは git に入れず（`.gitignore`）、`manifest.json` と fixture だけ入れる
- [ ] **Step 7: コミットする** `git commit -m "feat(pipeline): 三重県ハザードと避難場所の加工"`

---

### Task 7: 建物データの加工

**Files:**
- Create: `pipeline/building_stock.py`
- Test: `pipeline/tests/test_building_stock.py`

**Interfaces:**
- Produces: `public/data/stock/{mesh2}.json` = `{ "<mesh250>": { "total": int, "shares": { "wood:pre1981": float, ... } } }`（Task 4 の `BuildingStock`）
- CLI: `python -m pipeline.building_stock --buildings <基盤地図情報 建築物外周線> --stats <住宅・土地統計 市町村表> --municipalities <市町村境界> --out public/data/stock`

決めごと:
- `total` は、建物ポリゴンの重心が入るメッシュで数える
- `shares` は、メッシュの重心が入る市町村の住宅・土地統計の「構造 × 建築時期」の割合。統計の建築時期区分は 1980年以前 / 1981〜1990年 / 1991〜2000年 / 2001年以降 なので、`pre1981` = 1980年以前、`y1981_2000` = 1981〜2000年、`post2000` = 2001年以降 として扱う（境界の月ずれは許容し、`manifest.json` の `notes` に書く）
- 統計の構造区分の対応: 木造・防火木造 → `wood`、鉄骨造 → `steel`、鉄筋・鉄骨コンクリート造 → `rc`、その他・不詳は除いて割合を正規化する
- 非住宅も同じ割合で扱う（Review Focus 1）。`notes` に書く

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_shares_sum_to_one(): ...
def test_building_counted_once_by_centroid(): ...
def test_unknown_structure_excluded_and_renormalized(): ...
def test_notes_mention_non_residential_assumption(tmp_path): ...
```

- [ ] **Step 2: 失敗を確認 → Step 3: 実装 → Step 4: 成功を確認**
- [ ] **Step 5: 菰野町と周辺で実データを加工する**
- [ ] **Step 6: コミットする** `git commit -m "feat(pipeline): 建物数と構造・年代の割合"`

---

### Task 8: 菰野町での照合

**Files:**
- Create: `scripts/reconcile.ts`, `data/published/mie_municipal.csv`
- Test: `tests/scripts/reconcile.test.ts`

**Interfaces:**
- Consumes: `estimateArea`（Task 4）、Task 6・7 の出力、市町村境界から作った `{ municipality: string; meshes: string[] }[]`
- Produces:
  - `reconcile(rows: { municipality: string; case: string; published: number; computed: number }[], tolerance = 0.3): { municipality: string; case: string; ratio: number; pass: boolean }[]`
  - CLI: `npx tsx scripts/reconcile.ts --case L2 --case L1` → `reports/reconcile-YYYYMMDD.md`

`mie_municipal.csv` の初期値（三重県 市町別被害想定結果シート、令和8年3月、6月訂正版）:
```
municipality,case,shake_collapse
菰野町,L2,1400
菰野町,L1,40
```
三重県の他の市町も同じシートから追記する（揺れによる全壊棟数のみ）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
test('±30% 以内なら pass', () => {
  expect(reconcile([{municipality:'菰野町',case:'L2',published:1400,computed:1800}])[0].pass).toBe(true);  // 1.29
  expect(reconcile([{municipality:'菰野町',case:'L2',published:1400,computed:1850}])[0].pass).toBe(false); // 1.32
});
test('published が 0 のときは computed も 0 なら pass、それ以外は fail', ...);
test('レポートに非住宅の仮定（manifest の notes）が載る', ...);
```

- [ ] **Step 2: 失敗を確認 → Step 3: 実装 → Step 4: 成功を確認**
- [ ] **Step 5: 実データで実行する。** 菰野町の L2・L1 の結果をレポートに出す。不合格なら、原因の候補（震度データの違い、被害関数の転記、建物数、非住宅の扱い）を順に切り分け、`reports/` に記録する。合否の数字は変えない
- [ ] **Step 6: コミットする** `git commit -m "feat: 公表値との照合スクリプトと菰野町の結果"`

---

## この計画の外（次の計画で扱う）
- 内閣府データ（L2 の全域・半割れ）の申請と取り込み（設計書 §3.9 の確認事項）
- 画面、`geocode`、`hazardLoader`、Service Worker、説明ページ、共有カード、練習モード
- 他県のオープンデータの取り込み
