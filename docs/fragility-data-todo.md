# 被害関数データ（src/data/fragility.json）

状態: **転記済み（2026-11-12）**。出典は内閣府「被害想定手法の概要」（令和7年3月, sanko_gaiyo.pdf）。

## 作り方（再現手順）
1. PDF を取得: https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/sanko_gaiyo.pdf
2. 揺れ（p.5-8, 画像）: `pdfimages -f 6 -l 9 -png sanko_gaiyo.pdf img/p` → `python3 pipeline/digitize/digitize_shake.py img raw/shake_raw.json <overlay_dir>`
3. 液状化・津波（p.10-12, ベクター）: `python3 pipeline/digitize/extract_vector.py sanko_gaiyo.pdf raw/vector_raw.json`
4. 統合: `python3 pipeline/digitize/build_fragility.py pipeline/digitize/raw src/data/fragility.json`

## 精度の確認
- 木造 全壊率 @計測震度6.4 が愛媛県資料 p.18 の値（71/60/41/11/4/1%）と 0.8pt 以内（テストあり）。
- 津波: 読み取った「全半壊−全壊」と、独立に読み取った「半壊」曲線の差は 木造 0.3pt 以内、非木造 最大 2.4pt。
- 揺れの低い値（約5%未満）は系列の重なりのため ±2pt 程度の誤差がありうる。

## 仮定（出典に記載がない部分）
- 計測震度 4.5 未満は被害なし（出典の図は 5.0 から）。
- 浸水深 0m・沈下量 0cm は被害なし。
- 液状化は出典に全壊率しかないため、半壊は 0。
- 年代・階数・杭の有無・人口集中地区の別は入力がないため、該当クラスの最大値（保守的な包絡）。
