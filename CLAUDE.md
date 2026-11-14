# CLAUDE.md — 南海トラフ 住まいの被害シミュレーター

新しいセッション・別のアカウントで続きをするときは、まず `docs/HANDOFF.md`（引き継ぎ書）を読むこと。

## 進め方（利用者の希望）
- 返答はすべて日本語。
- 計画（docs/superpowers/plans）→ サブエージェントで実装 → 課題ごとにレビュー → 最後に全体レビュー、の流れを好む。
- master への取り込みは「まとめて master へ」（squash）。取り込んだら Mac（~/Documents/nankai-sim）にも反映する。
- 新しい機能は、作る前に短い設計を見せて OK をもらう。

## 守ること（変えない）
- 内閣府「南海トラフの巨大地震モデル・被害想定手法検討会」のデータ（生データ・形式を変えた物）は再配布しない。出典表示を必ず付ける。J-SHIS も同様（利用規約 第5条）。
- 公開ゲート: `npm run build:public` は `ALLOW_HAZARD_PUBLISH=1` が無いと失敗する。内閣府は 2026-11-12 に「出典を明記すれば使用可」と回答（`docs/publishing.md` に記録済み）なので、公開用ビルドでは付けてよい。元データそのものは配布しない。
- 保存・共有文・リンクに住所や座標を入れない（例外: 家族の決まりメモは利用者が書いた文をその端末だけに保存）。
- 国土地理院の避難場所の注意書きはそのまま表示する。
- ダウンロード・利用規約への同意は、利用者の許可を得てから。Mac のファイル削除は許可を得てから。
- 災害の表示は「安心させすぎない」: 到達時間は「最短・目安」、浸水域外でも「想定を超える津波もあり得る」、こどもモードでも同じ。

## よく使うコマンド
- テスト: `npm test`（node:test + tsx）、型: `npm run typecheck`、画面: `npx playwright test`（システムの Chrome）、オフライン: `npm run e2e:offline`
- 開発: `npm run dev`、ビルド: `npm run build`、公開用: `npm run build:public`
- データ作り直し: `docs/publishing.md` の「公開の手順」3（Python: pandas, geopandas, shapely）
- 試作版（外部通信なし・5か所だけ）: `npx vite build -c vite.demo.config.ts --outDir dist-demo`（`demo/` に説明）

## 構成
- `src/core/` 計算（震度→被害率、液状化、津波の段階、避難）
- `src/app/` 画面（`main.ts`、`ui/`、`viewmodel.ts`、`scenario.ts`、`timeline.ts`、`family.ts`、`kids.ts`）
- `pipeline/` データ作成（Python）、`scripts/` 照合・公開チェック
- `docs/` 設計（specs）・計画（plans）・判断記録（notes）・照合結果（reports）・公開手順（publishing.md）
