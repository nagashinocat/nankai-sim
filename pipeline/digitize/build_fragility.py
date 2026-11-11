"""Build src/data/fragility.json from digitised 内閣府 curves (raw/*.json)."""
import json, sys
import numpy as np

SRC = "内閣府（防災担当）南海トラフ巨大地震対策検討ワーキンググループ 被害想定手法の概要（令和7年3月）sanko_gaiyo.pdf"
URL = "https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/sanko_gaiyo.pdf"

def iso(v):
    """non-decreasing (pool adjacent violators)"""
    b = [[x, 1] for x in v]; i = 0
    while i < len(b) - 1:
        if b[i][0] > b[i + 1][0] + 1e-12:
            a, c = b[i], b[i + 1]; b[i:i + 2] = [[(a[0] * a[1] + c[0] * c[1]) / (a[1] + c[1]), a[1] + c[1]]]; i = max(i - 1, 0)
        else: i += 1
    return [x for x, n in b for _ in range(n)]

def curve(xs, col, tot):
    col = np.clip(iso(list(col)), 0, 1); tot = np.clip(iso(list(tot)), 0, 1)
    tot = np.maximum(tot, col)
    return [[round(float(x), 3), round(float(c), 4), round(float(t), 4)] for x, c, t in zip(xs, col, tot)]

REP_MAP = {
    "wood": {"pre1981": ["1963-71"], "y1981_2000": ["1981-89"], "post2000": ["2002-"]},
    "steel": {"pre1981": ["≤1980/1-4階"], "y1981_2000": ["1981-/1-4階"], "post2000": ["1981-/1-4階"]},
    "rc": {"pre1981": ["≤1971/1-6階", "1972-80/1-6階"], "y1981_2000": ["1981-/1-6階"], "post2000": ["1981-/1-6階"]},
}

def shake(raw):
    I = raw["intensity"]; ch = raw["charts"]
    def c(fam, name):
        co = np.array(ch[fam]["collapse"][name]["values_pct"]) / 100
        to = np.array(ch[fam]["total"][name]["values_pct"]) / 100
        pts = curve(I, co, to)
        return [[4.5, 0.0, 0.0]] + pts          # ruling: 震度5弱未満(計測震度<4.5)は被害なし
    wood = {"≤1962": c("wood", "~1962"), "1963-71": c("wood", "1963-71"), "1972-80": c("wood", "1972-80"),
            "1981-89": c("wood", "1981-89"), "1990-2001": c("wood", "1990-2001"), "2002-": c("wood", "2002-")}
    steel = {f"{e}/{f}階": c(fam, f + "F") for e, fam in [("≤1980", "steel_~1980"), ("1981-", "steel_1981-")]
             for f in ["1-4", "5-6", "7-15"]}
    rc = {f"{e}/{f}階": c(fam, f + "F") for e, fam in [("≤1971", "rc_~1971"), ("1972-80", "rc_1972-80"), ("1981-", "rc_1981-")]
          for f in ["1-6", "7-10", "11-15"]}
    st = lambda es: [f"{e}/{f}階" for e in es for f in ["1-4", "5-6", "7-15"]]
    rcs = lambda es: [f"{e}/{f}階" for e in es for f in ["1-6", "7-10", "11-15"]]
    return {
        "source": SRC, "page": "p.5-8（PDF 6-9ページ）図 全壊率曲線・全半壊率曲線（木造・S造・RC/SRC造）",
        "method": "図読み取り（画像の印の位置を画素単位で読み取り、計測震度0.1刻み。重なりで隠れた印は隣の系列から補完）",
        "groups": {
            "wood": {"classes": wood, "eraMap": {"pre1981": ["≤1962", "1963-71", "1972-80"],
                                                  "y1981_2000": ["1981-89", "1990-2001"], "post2000": ["2002-"]}, "repMap": REP_MAP["wood"]},
            "steel": {"classes": steel, "eraMap": {"pre1981": st(["≤1980"]), "y1981_2000": st(["1981-"]), "post2000": st(["1981-"])}, "repMap": REP_MAP["steel"]},
            "rc": {"classes": rc, "eraMap": {"pre1981": rcs(["≤1971", "1972-80"]), "y1981_2000": rcs(["1981-"]), "post2000": rcs(["1981-"])}, "repMap": REP_MAP["rc"]},
        }}

def resample(series, grid):
    x = np.array(series["x"]); y = np.array(series["y"]) / 100
    o = np.argsort(x); x, y = x[o], y[o]
    return np.interp(grid, x, y, left=y[0], right=y[-1])

def liquefaction(raw):
    g = np.arange(0, 35.001, 1.0)
    def c(key, name):
        y = np.clip(resample(raw[key]["series"][name], g), 0, 1)
        y[0] = 0.0                                # 沈下 0cm は被害なし（曲線も 0 から始まる）
        return curve(g, y, y)                     # 出典は全壊率のみ → 全壊+半壊 = 全壊 とする
    return {
        "source": SRC, "page": "p.10-11（PDF 11-12ページ）図 地盤沈下量に対する建物全壊率",
        "method": "PDFのベクター図形から座標を抽出（ベジェ曲線を評価し線の中心を取得）、1cm刻み",
        "groups": {
            "wood": {"classes": {"≤1980": c("liquefaction_wood", "~1980(S55以前)"), "1981-": c("liquefaction_wood", "1981-(S56以降)")},
                     "eraMap": {"pre1981": ["≤1980"], "y1981_2000": ["1981-"], "post2000": ["1981-"]}},
            "nonwood": {"classes": {"杭無し": c("liquefaction_nonwood_nopile", "all"),
                                    "杭有り細長≤1974": c("liquefaction_nonwood_pile_small", "~1974(S49以前)"),
                                    "杭有り細長1975-83": c("liquefaction_nonwood_pile_small", "1975-1983(S50-58)"),
                                    "杭有り細長1984-": c("liquefaction_nonwood_pile_small", "1984-(S59以降)")},
                        "eraMap": {"pre1981": ["杭無し", "杭有り細長≤1974", "杭有り細長1975-83"],
                                   "y1981_2000": ["杭無し", "杭有り細長1975-83", "杭有り細長1984-"],
                                   "post2000": ["杭無し", "杭有り細長1984-"]}},
        }}

def tsunami(raw):
    g = np.round(np.arange(0.1, 8.0001, 0.1), 1)
    def c(key, kind):
        s = raw[key]["series"]
        co = resample(s[f"{kind}_collapse"], g); to = resample(s[f"{kind}_total"], g)
        # dashed series end where hidden under the solid line at ~100%: extend at last value
        pts = curve(g, co, to)
        return [[0.0, 0.0, 0.0]] + pts            # 浸水深 0m は被害なし
    return {
        "source": SRC, "page": "p.12（PDF 13ページ）図 津波浸水深ごとの建物被害率（人口集中地区／それ以外）",
        "method": "PDFのベクター図形から座標を抽出。木造=実線（ベジェ評価）、非木造=破線の各片の中心。0.1m刻み",
        "groups": {
            "wood": {"classes": {"DID": c("tsunami_DID", "wood"), "nonDID": c("tsunami_nonDID", "wood")}},
            "nonwood": {"classes": {"DID": c("tsunami_DID", "nonwood"), "nonDID": c("tsunami_nonDID", "nonwood")}},
        }}

def main(raw_dir, out):
    sh = json.load(open(f"{raw_dir}/shake_raw.json")); ve = json.load(open(f"{raw_dir}/vector_raw.json"))
    table = {
        "source": f"{SRC} {URL}",
        "notes": ("内閣府の図からの読み取り値（公式の数表ではない）。揺れは画像の画素読み取りで、低い値（約5%未満）では"
                  "系列の重なりにより±2ポイント程度の誤差がありうる。年代・階数・杭・人口集中地区の区分は入力がないため"
                  "保守的な包絡（最大値）を使う。年代境界は本アプリの2000年6月と出典の2001/2002年でずれる。"
                  "計測震度4.5未満は被害なし、浸水深0m・沈下0cmは被害なしと仮定。液状化は出典に全壊率のみのため半壊は0とする。"
                  "代表的な曲線: 地域の合計には、各年代の代表クラス（repMap。木造は 1963-71・1981-89・2002-、S造は 1-4 階、RC造は 1-6 階）の曲線を使い、家の推定の中央値もこれに合わせる。家の幅は対応クラスの最小〜最大。"),
        "shake": shake(sh), "liquefaction": liquefaction(ve), "tsunami": tsunami(ve),
    }
    json.dump(table, open(out, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main(*sys.argv[1:])
