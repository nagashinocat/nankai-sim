# 被害関数データ（fragility）転記 TODO

`src/core/fragility.ts` のエンジンは実装済み。**実データ `src/data/fragility.json` は未作成**（公式の数値表が入手できていないため）。
`useFragilityTable(table)` で登録するまで、各関数は `FragilityDataMissingError` を投げる。
`tests/fixtures/fragility.synthetic.json` は論理検証用の人工データであり、実データではない。

## スキーマ（`FragilityTable`、詳細は fragility.ts）
- `source`, `notes`（保守的な包絡であること、2000 年と 2001/2002 年の境界ずれを書く）
- `shake` / `liquefaction` / `tsunami`: それぞれ `{ source, page, method, groups }`
  - `method`: 数値表からの転記は `"表転記"`、公式グラフからは `"図読み取り"`
  - `groups`: shake = `wood|steel|rc`、liquefaction・tsunami = `wood|nonwood`
  - 各 group: `classes: { <出典の区分名そのまま>: [[x, 全壊率, 全壊+半壊率], ...] }`、`eraMap?: { pre1981|y1981_2000|post2000: [区分名...] }`
- x は 計測震度 / 地盤沈下量(cm) / 浸水深(m)。x は単調非減少、`0 <= 全壊 <= 全壊+半壊 <= 1`（`validateFragilityTable` が検査）。
- 関数は対応クラスの全壊率・全壊+半壊率それぞれの最大値（保守的包絡）を返し、`half = 全壊+半壊 − 全壊`。
- 年代対応（R8）: 木造 pre1981→[≤1962, 1963-71, 1972-80]、y1981_2000→[1981-89, 1990-2001]、post2000→[2002-]。非木造 pre1981→[≤1971, 1972-80]、y1981_2000 と post2000→[1981-]。steel/rc は階数区分も含めて包絡。
- steel/rc の液状化・津波は `nonwood` グループを使う。津波は eraMap なし（DID／非DID の全クラスの最大値）。

## 転記すべき曲線
| 族 | x | クラス（出典） |
|---|---|---|
| 揺れ 木造 | 計測震度 5.0-7.0 | 旧≤1962 / 中①1963-71 / 中②1972-80 / 新①1981-89 / 新②1990-2001 / 新③2002-（全壊・全半壊） |
| 揺れ S造 | 同上 | 築年 2 区分（〜1980 / 1981〜）× 階数 3 区分（1-4, 5-6, 7-15）= 6 |
| 揺れ RC/SRC | 同上 | 築年 3 区分（〜1971 / 1972-80 / 1981〜）× 階数 3 区分（1-6, 7-10, 11-15）= 9。16 階以上は被害なし扱い |
| 液状化 木造 | 沈下量 0-35cm | 〜1980(昭和55年以前) / 1981〜 |
| 液状化 非木造 | 沈下量 | 杭無し / 杭有り・アスペクト比大の小規模（〜1974, 1975-83, 1984〜）/ 杭有り その他（全壊以上なし扱い） |
| 津波 木造・非木造 | 浸水深 0-8m | 人口集中地区 / それ以外（全壊・全半壊・半壊） |

注意: 令和7年資料の S/RC の築年境界（1980/1981、1971/1972）と、2012 資料の非木造境界（昭和46年以前＝1971）は資料内でも表記ゆれがある。転記時にページを確認すること。

## 調べた出典と結果（いずれも数値表・パラメータは本文に無し、曲線はグラフのみ）
- 内閣府 令和7年3月「南海トラフ巨大地震の被害想定項目及び手法の概要」 https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/sanko_gaiyo.pdf （PDF 87 頁。揺れ＝PDF 約 4-6 頁、液状化・津波＝続く頁。ブラウザの PDF ビューアでは表示可能）
- 内閣府 令和元年6月 手法の概要 https://www.bousai.go.jp/jishin/nankai/taisaku_wg/pdf/2_sanko2.pdf （揺れ p.3-5、液状化 p.6-7、津波 p.8。p.4 に全壊率テーブルありと書かれるが数値は非掲載）
- 内閣府 2012/2013 第二次報告 https://www.bousai.go.jp/jishin/nankai/taisaku_wg/pdf/20130318_shiryo2_2.pdf （建物被害の節は本文抽出に出ず）
- 令和7年 地震モデル報告書 honbun.pdf / zuhyo.pdf / sanko.pdf（kento_wg/pdf/）: 被害関数なし
- 三重県 https://www.pref.mie.lg.jp/common/content/000028314.pdf p.2-7（グラフのみ）
- 愛媛県 https://www.pref.ehime.jp/uploaded/attachment/96006.pdf p.17-42（グラフ。下記の部分情報あり）
- 新潟県 https://www.pref.niigata.lg.jp/uploaded/life/301728_486037_misc.pdf p.2-8、神奈川県 https://www.pref.kanagawa.jp/documents/16375/2syou02.pdf p.38-49（表は画像。津波は正規分布 CDF の μ,σ だが値は本文に無い）、大阪府 https://www.pref.osaka.lg.jp/documents/2473/5_shiryou_3.pdf p.5-16、静岡県 https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/029/964/25517shiryou2-5.pdf p.14-37
- 未確認: 岡山県 https://www.pref.okayama.lg.jp/uploaded/life/826156_7804116_misc.pdf（取得許可外）

## 部分情報（そのまま使わず、検算用）
- 愛媛県 p.18（図5-2-2, 5-2-3）: 計測震度 6.4 の全壊率の注記。木造 71%, 60%, 41%, 11%, 4%, 1%、非木造 15%, 11%, 3%。築年区分との対応は本文抽出では不明（旧→新の順と推定されるが未確認）。
- 静岡県 p.17: 新耐震の木造曲線は旧曲線を計測震度軸方向に 0.15（=1.89×log10(1.2)）移動したもの。S造は PGV 1.2 倍の移動。

## 再開手順
1. 公式 PDF（上記）を高倍率で表示するか、ローカルに置いて数値表／グラフを入手。
2. 数値表があれば `"method": "表転記"`、グラフ読み取りは曲線ごとに ≥5 点で `"method": "図読み取り"` とし、`page` を族ごとに記録。
3. `src/data/fragility.json` を作成し、アプリ起動時に `useFragilityTable()` で登録。
4. `tests/core/fragility.test.ts` の `test.todo`（転記の抜き取り確認）を、資料の代表点 3 点と一致する実テストに置き換える。
