# 近い避難場所・簡易地図・電波なしで使う 実装計画

> 実装は subagent-driven（課題ごとにレビュー）。branch `near-shelters`。

**Goal:** いまいる場所（GPS）から近い避難場所を、道具なしでも読める簡易地図（方向・距離）で出し、避難場所データを端末に保存して電波なしでも使えるようにする。

**Spec:** `docs/superpowers/specs/2026-11-12-near-shelters-offline-design.md`（2026-11-14 利用者 OK「公開版も更新して」）

## Global Constraints
- 日本語 UI。計算（src/core の被害・津波判定）、Saved v4、共有文は変えない。
- 現在地・自宅の座標は保存しない（localStorage・Cache・URL・共有文のどこにも）。避難場所データ（公開データ）は端末に保存してよい。
- 地図画像（タイル）は保存しない。簡易地図は SVG で、外部通信なしで描ける。
- 「安心させすぎない」: 簡易地図に「直線の方向と距離です。道は実際に確かめてください」。電波なしで津波が調べられないときは「ここが浸水するかは調べられません。海の近くなら、揺れたらすぐ高い所へ」。
- 国土地理院の避難場所の注意（既存の3項目と出典）をこの画面にもそのまま出す。
- こどもモード対応（ことばは kids.ts の方針: ひらがな＋ふりがな、赤は「にげる」だけ）。
- 既存テスト（単体301・画面70・オフライン1）を緑のまま。

## Review Focus
1. 位置情報が拒否・タイムアウト・非対応のとき、何をすればよいかが分かる文が出る（白い画面や無言にならない）。
2. 5県の外・避難場所が近くに無い（2km 以内 0件）ときの表示。
3. コンパスの向き: iPhone（webkitCompassHeading・許可）と Android（deviceorientationabsolute の alpha）で回転の向きが逆にならない。使えないときは北が上のまま。
4. Service Worker 更新（activate で古いキャッシュ削除）で、保存した避難場所データが消えない。
5. 電波なしで #near を開いたとき、保存済みなら一覧と簡易地図、未保存なら「保存していないので出せません」とその場でできること。

---

### Task 1: 方向・距離・簡易地図の計算（純粋関数）
**Files:** Create `src/app/minimap.ts`, `tests/app/minimap.test.ts`
**Produces:**
- `bearingDeg(from: LatLon, to: LatLon): number`（0=北、時計回り、0〜360）
- `dir8(deg: number): string`（北・北東・東・南東・南・南西・西・北西）、`dir8Kids(deg): string`（きた・きたひがし…）
- `localXY(origin: LatLon, p: LatLon): {x:number,y:number}`（m、東が+x、北が+y、正距円筒近似）
- `niceScale(maxM: number): number`（目盛りの長さ: 50/100/200/250/500/1000/2000 から maxM の 1/4〜1/2 に入るもの）
- `minimapModel(origin: LatLon, target: Shelter, others: Shelter[], sizePx: number): {...}`（中心 origin、target が枠の 80% 以内に入る縮尺、others は枠内のものだけ、目盛り長と px、方向文「北東へ 約350m」）
**Tests:** 真北/真東/南西の方位、dir8 の境界（22.5°）、localXY の符号、niceScale、target が枠内、others の枠外除外、距離 0m（同じ地点）でも NaN にならない。

### Task 2: 簡易地図の部品とコンパス
**Files:** Create `src/app/ui/minimap.ts`、`src/app/compass.ts`（+ `tests/app/compass.test.ts`）、CSS
- `renderMinimap(model, opts:{kids?:boolean, headingDeg?:number|null}): HTMLElement` — SVG（中心に「いま／自宅」、target に大きな矢印と名前、others を薄い点、北の矢印、目盛り）、下に文「北東へ 約350m・ゆっくり歩いて約N分」と注意「直線の方向と距離です。道は実際に確かめてください」。role="img" + aria-label。kids: 大きな矢印1つ「この むきに 約350m」。
- `compass.ts`: `startCompass(onHeading:(deg:number|null)=>void): Promise<() => void>` — iOS: `DeviceOrientationEvent.requestPermission()`（クリックから呼ぶ）→ `webkitCompassHeading`；その他: `deviceorientationabsolute` の `alpha`→ heading = (360 - alpha) % 360；使えなければ null。純粋部分 `headingFromEvent(e)` を単体テスト。
- 回転: heading があれば地図全体を -heading 回転（北の矢印も回る）、「向きを合わせています」。ボタン「🧭 向きを合わせる」/「北を上にもどす」。

### Task 3: #near 画面と入口
**Files:** Create `src/app/ui/near.ts`、Modify `main.ts`（ルート #near、入力画面と結果画面に大きなボタン「📍 いまいる場所から近い避難場所」、フッターにも）、`ui/result.ts`（避難場所の各項目に「🗺 地図」ボタン → その場で `renderMinimap` を開閉、中心は自宅＝計算に使った位置（保存しない））、kids 対応。
- #near: 「現在地を使う」ボタン（自動では取らない）→ getCurrentPosition(enableHighAccuracy, timeout 15s, maximumAge 60s)。拒否/失敗/非対応の文。
- 結果: 津波の避難場所5・地震の避難場所5（既存 `nearestShelters`、半径 2km→無ければ 5km まで広げる、それでも0件は「近くに登録された避難場所がありません（5県の外か、データが無い場所）」）。各項目に距離・徒歩（標準/ゆっくり）・簡易地図（最初の1件は開いた状態）。
- オンラインなら現在地の津波（`tsunamiAround`）を1行で（浸水域なら強い文を既存どおり）。オフライン/失敗は上の注意文。
- 位置の精度（accuracy）が 100m を超えたら「位置の誤差が約Nmあります」。
- 現在地はメモリだけ。#near を離れたら捨てる。

### Task 4: 避難場所データを端末に保存・電波なし表示
**Files:** Modify `public/sw.js`、Create `src/app/offline.ts`、`vite.config.ts`（または plugin）、`pipeline/merge.py` は任意
- `data/shelters/index.json`（ファイル名一覧＋manifest の更新日）をビルド時に生成（dev でも出る）。テストあり。
- 「避難場所のデータをこのスマホに保存（約3MB）」ボタン（#near と結果画面）: 専用キャッシュ `nankai-offline-shelters-v1` に全ファイルを入れる（進み具合を表示、途中失敗は再開できる）。保存日を localStorage `nankai-sim:shelters-saved`（日付と件数だけ）。manifest の避難場所の更新日が保存日より新しければ「新しいデータがあります。保存し直してください」。「保存したデータを消す」も。
- sw.js: `data/shelters/` はネットワーク優先→失敗なら版つきキャッシュ→専用キャッシュの順。activate で専用キャッシュを消さない（名前の接頭辞を変える）。
- 電波なしの帯: `navigator.onLine` と online/offline イベントで、画面上に「電波がありません。近い避難場所（保存済みなら）・前回の結果・家族の決まりは見られます」。
- Web App Manifest（`public/manifest.webmanifest`、name/short_name/start_url "./"/display standalone/theme_color/背景、アイコン 192/512 PNG と maskable）＋ index.html の link と apple-touch-icon。アイコンはアプリ内で作った単純な図（波と家、文字なし）。

### Task 5: テストと仕上げ
- e2e（tests/e2e/near.spec.ts）: `context.grantPermissions(['geolocation'])`＋`setGeolocation` で一覧と簡易地図、拒否時の文、0件時の文、結果画面の「🗺 地図」開閉、kids の大きな矢印、390px はみ出しなし。
- オフライン e2e（offline.spec.ts に追加）: 保存→`context.setOffline(true)`→#near で一覧が出る／未保存なら「保存していないので出せません」／電波なしの帯。SW 更新後も専用キャッシュが残ること（キャッシュ名の確認でよい）。
- `docs/HANDOFF.md`・spec の状態を更新。

### 公開
master へ squash 取り込み後、`docs/publishing.md`「公開先」の手順で gh-pages を更新し、本番で #near（位置はブラウザで許可）と保存・オフラインを確認。
