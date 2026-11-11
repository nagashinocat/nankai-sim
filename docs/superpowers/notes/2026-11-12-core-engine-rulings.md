# 計算エンジン（Task 1〜5）の判断記録と持ち越し事項

実装中に下した判断（Ruling）と、後回しにした指摘の一覧。

## 判断
- Ruling R1: Use node:test + node:assert run via global `tsx --test` instead of Vitest — npm install impossible (network off) — cost if wrong: test files need a mechanical port to Vitest later.
- Ruling R2: Structure/Era/Rates live in src/core/types.ts; fragility.ts imports them — single type home — cost if wrong: one import move.
- Ruling R3: Clamp test uses the table's actual max/min intensity read from fragility.json — the plan's 7.0 was an example — cost if wrong: none.
- Ruling R4: T5 tests only that tsunami:false shelters are excluded; the blank→false parser test stays in T6 — ownership by file — cost if wrong: none.
- Ruling R5: Execute T1–T5 now; T6–T8 deferred until source data + geopandas are available (no network, shell allowlist blocks downloads) — cannot run without data, and fabricating data violates spec — cost if wrong: delay only.
- Ruling R6: Work on branch feature/core-engine instead of a worktree — repo has only docs commits, single session — cost if wrong: none.
- Ruling R7: Source priority for curve values: (a) numeric tables/parameters in 内閣府 docs (read honbun.pdf, zuhyo.pdf, 20130318_shiryo2_2.pdf); (b) official prefectural 被害想定手法 docs that publish 内閣府 curve parameters, cited; (c) last resort, digitise official graphs (≥5 points/curve, marked "図読み取り" in JSON). — spec forbids invented values, measurement of official curves is not invention — cost if wrong: curve error of a few % until replaced by official numbers.
- Ruling R8: fragility.json stores the SOURCE classes verbatim; an era→classes map converts. Wood: pre1981→{≤1962,1963-71,1972-80}, y1981_2000→{1981-89,1990-2001}, post2000→{2002-}. Non-wood: pre1981→{≤1971,1972-80}, y1981_2000 & post2000→{1981-}. shakeRates returns the per-intensity MAX (conservative envelope) over mapped classes, and over story groups for steel/rc, and over pile/aspect classes for liquefaction, and over DID/non-DID for tsunami. — no input exists to pick a class; under-estimating is the worse failure for a disaster-prep app — cost if wrong: overstated damage for newer-within-era or high-rise buildings; documented in manifest notes and UI.
- Ruling R9: Liquefaction uses settlement: liquefactionRates(settlementCm, s, e). HazardCell gains `settlementCm: number | null` (pl kept for display). 内閣府 dataset A ships 沈下量 directly. — matches the source curve variable — cost if wrong: Task 3/6 briefs carry the field change.
- Ruling R10: The 2000-06 boundary vs source 2001/2002 class boundaries is accepted and noted in source notes. — cost if wrong: houses built 2000-06..2001 use the 1990-2001 curve under y1981_2000 era only if user picks that era.
- Ruling R11: Split Task 2 — build the fragility ENGINE now (schema, validation, era/class map, max-envelope, interpolation, clamping) with `useFragilityTable(table)` registration and `FragilityDataMissingError` thrown when no table is registered. Tests use an obviously synthetic fixture under tests/fixtures/ (never shipped). src/data/fragility.json is NOT created until official values are transcribed (needs local high-res PDFs from the user). — keeps the spec's no-invented-values rule while unblocking T3–T5 — cost if wrong: T3–T5 tests prove logic only, not real numbers; real-data spot checks remain open.
- Ruling R12: Task 8 brief must compute shake-only collapse for reconciliation (null out settlementCm/tsunamiDepth or add shakeOnly) and note R8 upward bias in the report — published values are 揺れ only — cost if wrong: false reconciliation failures.

## 持ち越した指摘（最終レビューでの扱い）
- 実データを入れる前に必須: eraMap を shake/liquefaction で必須化、曲線の単調性チェック、液状化の年代順・混合クラス・steel/rc のテスト追加
- 時間差タブを出す前に必須: estimateLag の補強対応、手計算値でのテスト
- 画面の計画で対応: 不正な座標・コードの検出、countedMeshes=0 は「データなし」と表示、速度0のガード、合成用fixtureを本番で登録できないようにする

- Task 1: minor (deferred): mesh.ts:56 comment says boundary goes to "南西側(=大きい方)" — contradictory wording
- Task 1: minor (deferred): mesh.test.ts center tolerance 1e-3 looser than brief's 5e-4; name says 0.0001度
- Task 1: minor (deferred): package.json test glob unquoted — ** acts as *
- Task 1: minor (deferred): no tests for invalid code / 1st-2nd level boundary; no input range check
- Task 1: minor (deferred): typescript ^7.0.2 / @types/node ^22 versions unverified on registry (offline)
- Task 2: minor (deferred): validator TypeError when a family/groups key missing (fragility.ts:81-83)
- Task 2: minor (deferred, fix before real data lands): eraMap optional for shake/liquefaction → era dependence silently lost (fragility.ts:62-70)
- Task 2: minor (deferred): no NaN guard in interpolation (fragility.ts:90-97)
- Task 2: minor (deferred): tests depend on declaration order for table registration
- Task 2: minor (deferred): missing tests — liquefaction era order, max-collapse/max-total from different classes, steel vs rc group, table mutation
- Task 3: minor (deferred): redundant useFragilityTable calls in damage tests; unreachable `if (!r)` damage.ts:60
- Task 3: minor (deferred): no hand-computed value test for estimateLag branches; retrofit+unknown; monotonicity assumption comment damage.ts:51-63
- Task 3: minor (deferred): estimateLag ignores retrofit (brief formula has no retrofit input)
- Task 4: minor (deferred): negative/NaN individual shares not rejected; duplicate meshes double-counted; unchecked StockKey split for JSON input; shares check only on counted meshes
- Task 5: minor (deferred): no guard for speedMps<=0/NaN; NaN walkMin → 'no' undocumented; TDD red step not observed

## 被害関数データの転記（2026-11-12 追加）
- Ruling R13: 計測震度 4.5 未満は被害なしとして [4.5, 0, 0] を加えた — 出典の図は 5.0 からで、5.0 の値で固定すると震度4でも数%の被害が出てしまう — 誤りの場合: 4.5〜5.0 の被害をわずかに過小評価。
- Ruling R14: 液状化は出典に全壊率しかないため半壊を 0 とした — 誤りの場合: 液状化による半壊を過小評価。
- Ruling R15: 浸水深 0m に [0, 0, 0] を加えた（出典は 0.1m から） — 誤りの場合: 0〜0.1m の浸水で被害を過小評価。
- 決定（ユーザー承認 2026-11-12）: 時間差発生は出典 p.10 に国の手法がある（1回目で半壊した建物は計測震度+0.5 と同じ全壊率）。国の手法に切り替えた。
- 決定（ユーザー承認 2026-11-12）: S造・RC造は階数で被害が大きく違う（RC 1〜6階 58% / 11〜15階 94% @7.0）。現行 R8 は全階数の最大値。階数の入力を加えた（未入力時は従来どおり包絡、16階以上は被害なし）。周辺推計は建物データに階数がないため包絡のまま。

## 三重県データ加工と照合 v2（2026-11-12）
- Ruling P1: 建物ストックの CLI が municipality_meshes.json も出力する — 照合が依存 — 誤りの場合: 影響なし。
- Ruling P2: 住宅統計の県計は第6-1表から取り、年代を3区分にまとめ直す（第6-3表に県計がないため）— 誤りの場合: 県計で代用した10町の割合がわずかにずれる。
- Ruling P3: 県・内閣府の公表値は陸側ケースなので、照合は L2_RIKU（Eq_2）で行う — 誤りの場合: ハザードのケースが1つ増えるだけ。
- 決定（ユーザー承認）: 地域の合計は代表的な曲線、自宅は該当クラスの最小〜最大の幅で示す（R8 の包絡を置き換え）。根拠: 包絡のままだと県計が内閣府推計の 1.39 倍、代表的な曲線では 1.06 倍。
- テストの fixture から内閣府の元データの行を除き、ブランチはスカッシュして取り込んだ（元データの行を含むコミットは履歴に残していない）。
Task 1: minor (deferred): PL<0→None untested; stale mesh2 files not cleared on rerun; hard-coded probe; processedDate churn
Task 2: minor (deferred): ValueError as control flow for fallback; name-mismatch error wording; double parse_kotei; no test for 9 vs 7 era layout / 専用住宅 terminator; boundary-point drop
Task 3: minor (deferred): skipped-mesh count not reported; published<=0 treated as '-'; dead existsSync; report test weak; computeMunicipality untested; housing source label
