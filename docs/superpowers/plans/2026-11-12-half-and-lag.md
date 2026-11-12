# 半割れ・時間差タブ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 結果画面に想定の切り替えタブを付け、最大クラス（L2）に加えて「東側の半割れ」「西側の半割れ」「時間差（東→西／西→東）」を選べるようにする。

**Architecture:** ハザードは既に公開データにある `HALF_E`（内閣府 1E）と `HALF_W`（1W）を使う。時間差は国の手法（`estimateLag`、先発で半壊した建物は後発で震度+0.5 の全壊率）で、先発と後発の2段階を表示する。津波は浸水想定タイルが最大クラスのみなので、どのタブでも最大クラスの津波を表示し、その旨を書く。

**Tech Stack:** TypeScript（node:test via tsx）、Vite、Leaflet、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-12-nankai-trough-sim-design.md` §2（想定する地震 A）、§3（`HALF_E`/`HALF_W`/`LAG_EW`/`LAG_WE`）、§4.5（時間差・国の手法）、§5.2（タブ、時間差は2段階）。津波は `docs/superpowers/specs/2026-11-12-tsunami-design.md`。

## Global Constraints

- タブの名前（この順）: 「最大クラス」「東側の半割れ」「西側の半割れ」「時間差（東→西）」「時間差（西→東）」。初期表示は「最大クラス」。
- 半割れの説明文: 「南海トラフの東側（または西側）だけで大きな地震が起きた場合の想定です。残りの半分でも続けて大地震が起きるおそれがあり、『南海トラフ地震臨時情報（巨大地震警戒）』が出たら、1週間程度は事前避難や備えの再確認をしてください」
- 時間差の説明文: 「先に片側で地震が起き、その後もう片側でも地震が起きた場合の想定です。先の地震で傷んだ建物は、後の地震で壊れやすくなります（国の手法：先の地震で半壊した建物は、後の地震で震度が0.5高い場合と同じ全壊率で計算）」
- 時間差は「先発（東 or 西）」「後発まで含めた合計」の2段階を並べて表示する。合計は先発以上であること。
- 津波の注記（L2 以外のタブ）: 「津波は最大クラスの想定を表示しています。半割れ・時間差では津波の高さや到達時間が異なる場合がありますが、強い揺れを感じたらすぐ高い所へ避難してください」
- 周辺の推計（1km）と地図の色分けもタブに合わせて切り替える。時間差は合計を使う。
- 既存の制約（住所・座標を保存しない、出典、F2 の強い避難の一文など）はすべて維持。保存する結果には選んだタブ名を含める。
- 内閣府データの再配布禁止は従来どおり（`HALF_E`/`HALF_W` は既に公開ゲートの対象）。

## Review Focus

1. 片方のケースのファイルが読めない／そのメッシュが無い → そのタブだけ「この想定のデータがありません」、他のタブは使える。
2. 時間差で先発の震度が null → 時間差タブはデータなし扱い（後発だけで計算しない）。
3. タブを素早く切り替えた → 古い計算結果が後から描画されない（最後に選んだタブの結果だけ出る）。
4. 幅（わからない項目・震度±0.5・曲線3種）が時間差でも出る。合計の下限 ≥ 先発の下限。
5. オフライン時: 前回保存した結果は保存したときのタブで表示される。

---

### Task 1: 時間差の幅つき推定（コア）

**Files:** Modify `src/core/damage.ts`; Test `tests/core/damage.test.ts`

**Interfaces:**
- Produces: `estimateHomeLag(first: HazardCell, second: HazardCell, input: HomeInput, tsunamiRange?: Range): { first: { collapse: Range; half: Range; central: Rates }; total: { collapse: Range; half: Range; central: Rates } } | null` — 幅は `estimateHome` と同じ組合せ（構造×年代×震度±0.5×曲線{min,rep,max}）。先発の幅は `estimateHome(first, …)` と一致。合計は各組合せで `estimateLag` 相当（先発・後発に同じ震度ずれを適用）。津波は合計にのみ加える（`ratesForCell` の順序どおり、後発の津波として）。

- [ ] Step 1: 失敗するテスト: 先発の幅が `estimateHome(first)` と一致／合計の下限 ≥ 先発の下限、上限 ≥ 先発の上限／先発の震度 null → null／後発が震度 0 相当なら合計 ≈ 先発。
- [ ] Step 2: 実装 → `npm test`・tsc → コミット。

### Task 2: データとビューモデルのケース対応

**Files:** Modify `src/app/data.ts`, `src/app/viewmodel.ts`, `src/app/main.ts`, `src/app/storage.ts`; Test `tests/app/*.test.ts`

**Interfaces:**
- `export type Scenario = 'L2' | 'HALF_E' | 'HALF_W' | 'LAG_EW' | 'LAG_WE'`
- DataSource の `hazardCell` / `hazardFor` / `covers` の caseId を `'L2' | 'HALF_E' | 'HALF_W'` に広げる（対応エリアの判定は常に L2 の index を使う）。
- `homeViewModel` に時間差用の `lag?: { first, total }` を渡せる形、または `homeLagViewModel(...)` を追加し、OkHomeVM に `stages?: { label: string; collapse: RangeVM; half: RangeVM }[]` を持たせる。
- `Saved` に `scenario: Scenario`（v4、v3 は 'L2' とみなして読む）。

- [ ] Step 1: 失敗するテスト（ケースごとの読み込み、片方のファイルが 404 → そのシナリオだけ unavailable、保存 v3→v4 の読み替え）。
- [ ] Step 2: 実装 → テスト → コミット。

### Task 3: タブの画面

**Files:** Modify `src/app/ui/result.ts`, `src/app/ui/map.ts`, `src/app/ui/last.ts`, `src/app/ui/about.ts`, `src/app/style.css`, `src/app/text.ts`; Test `tests/e2e/smoke.spec.ts`

- [ ] Step 1: 失敗する e2e: 結果にタブ5つ（Global Constraints の名前と順）。「東側の半割れ」を押すと説明文と数値が変わる。「時間差（東→西）」で2段階表示（先発／合計）と説明文。L2 以外で津波の注記。素早く2回切り替えて最後のタブの結果だけ出る。390px でタブが折り返さず横スクロールで選べる。
- [ ] Step 2: 実装（タブは role="tablist"、キーボード操作可）。説明ページに半割れ・時間差と臨時情報の説明を追加。
- [ ] Step 3: `npm test`、tsc、build、`npx playwright test`、offline 設定 → 390×844 のスクリーンショットを確認 → コミット。
