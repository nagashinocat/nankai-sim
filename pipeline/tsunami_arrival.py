"""県ごとの沿岸津波到達時間 CSV → 市町村名キーの到達時間 JSON。

CSV 列: muni_code,muni_name と、その県で公表されている最も低い高さの列（m030 = 30cm、または m050 = 50cm）の
どちらか1つ。m100,m300,m500,m1000 などほかの高さの列はあってもよい（形式だけ検証）。値は分、空欄＝その高さの津波は到達しない。
出力: {市町村名: {"min": 分 または null, "cm": 30 または 50}}。キーは municipality_meshes.json の市町村名。
"""
import argparse
import csv
import json
from datetime import date
from pathlib import Path

from pipeline.manifest import update_manifest

DEFAULT_NAMES = Path("public/data/stock/municipality_meshes.json")
LOWEST = {"m030": 30, "m050": 50}  # 最も低い高さの列 → cm
OTHER_COLS = ["m100", "m300", "m500", "m1000"]


def _minutes(s, where: str):
    s = (s or "").strip()
    if s == "":
        return None
    try:
        v = int(s)
    except ValueError:
        raise ValueError(f"{where}: 分の値が整数でない: {s!r}")
    if v < 0:
        raise ValueError(f"{where}: 負の値: {v}")
    return v


def _lowest_col(fields, where) -> str:
    cols = [c for c in LOWEST if c in (fields or [])]
    if len(cols) != 1:
        raise ValueError(f"{where}: 最も低い高さの列（{' / '.join(LOWEST)}）がちょうど1つ必要: {fields}")
    for c in ("muni_code", "muni_name"):
        if c not in fields:
            raise ValueError(f"{where}: 列 {c} がない")
    return cols[0]


def build_arrival(csvs, out: Path, names_path: Path = DEFAULT_NAMES, manifest=None, dataset=None) -> int:
    valid = set(json.loads(Path(names_path).read_text(encoding="utf-8")))
    codes: dict = {}
    result: dict = {}
    for p in csvs:
        with open(p, newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            low = _lowest_col(reader.fieldnames, str(p))
            others = [c for c in OTHER_COLS if c in reader.fieldnames]
            for i, row in enumerate(reader, start=2):
                where = f"{p}:{i}"
                code, name = row["muni_code"].strip(), row["muni_name"].strip()
                if code in codes:
                    raise ValueError(f"{where}: 市町村コード {code} が重複（{codes[code]}）")
                if name in result:
                    raise ValueError(f"{where}: 市町村名 {name} が重複（県をまたぐ同名を含む）")
                if name not in valid:
                    raise ValueError(f"{where}: 市町村名 {name} が {names_path} にない")
                for c in others:  # ほかの高さの列も形式を検証
                    _minutes(row[c], where)
                codes[code] = str(p)
                result[name] = {"min": _minutes(row[low], where), "cm": LOWEST[low]}
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if manifest is not None and dataset is not None:
        for d in dataset if isinstance(dataset, list) else [dataset]:
            update_manifest(manifest, d)
    print(f"津波到達時間: {len(result)} 市町村を出力")
    return len(result)


COMMON_NOTE = "値は津波が海岸（汀線）に着く最短の時間で、自宅に着く時間ではない。空欄（表の「－」）は該当高さの津波が到達しない、または対象外を示し null。海に面さない市町村は行なし。出力 public/data/tsunami_arrival.json（値は {min: 分, cm: 高さ}）。"

# CSV のファイル名 → manifest のエントリ（出典はここに記録し、CSV には書かない）
SOURCES = {
    "mie_tsunami_arrival.csv": {
        "id": "tsunami-arrival",
        "name": "沿岸津波到達時間（市町村別・三重県）",
        "source": "三重県 地震被害想定調査結果（本編）p.28 沿岸津波到達時間（L2 理論上最大クラス）",
        "url": "https://www.pref.mie.lg.jp/common/content/001259032.pdf",
        "publishedDate": "令和7年",
        "license": "三重県公表資料（出典明記）",
        "notes": "表から市町村別に書き写し（data/published/mie_tsunami_arrival.csv）。アプリが使うのは30cm到達時間。",
    },
    "aichi_tsunami_arrival.csv": {
        "id": "tsunami-arrival-23",
        "name": "最短津波到達時間（市町村別・愛知県）",
        "source": "愛知県 2024〜2025年度 愛知県南海トラフ地震被害予測調査結果（2026年6月）p.37 最短津波到達時間（津波高30cm）",
        "url": "https://www.pref.aichi.jp/uploaded/attachment/618554.pdf",
        "publishedDate": "2026年6月",
        "license": "愛知県公表資料（出典明記）",
        "notes": "表の最短値（ケース①⑥⑦⑧⑨の最小）を市町村別に書き写し（data/published/aichi_tsunami_arrival.csv）。アプリが使うのは30cm到達時間。西尾市は表の※のとおり佐久島の値。",
    },
    "shizuoka_tsunami_arrival.csv": {
        "id": "tsunami-arrival-22",
        "name": "市町別最短津波到達時間（静岡県）",
        "source": "静岡県 第4次地震被害想定（第一次報告）本編 第Ⅱ編 表Ⅱ-5.20-2(1)(2)(3) 市町別最短到達時間（南海トラフ巨大地震 ケース①⑥⑧）",
        "url": "https://www.pref.shizuoka.jp/_res/projects/default_project/_page_/001/029/868/honnpendai2henn.pdf",
        "publishedDate": "2013-06-27",
        "license": "静岡県公表資料（出典明記）",
        "notes": "静岡県は30cmの到達時間を公表していないため、公表されている最も低い高さ＋50cmの値を使う（アプリは「（50cm）」と表示）。3ケースの最小を市町別に書き写し（data/published/shizuoka_tsunami_arrival.csv）。政令指定都市は区の最小（浜松市=南区、静岡市=清水区）。東伊豆町はケース⑧の値が最小。",
    },
}


def datasets_for(csvs) -> list[dict]:
    """渡した CSV ごとの manifest エントリ（未知のファイル名は ValueError）。"""
    out = []
    for p in csvs:
        name = Path(p).name
        if name not in SOURCES:
            raise ValueError(f"出典が登録されていない到達時間 CSV: {name}（{', '.join(SOURCES)}）")
        d = dict(SOURCES[name])
        d["processedDate"] = date.today().isoformat()
        d["notes"] = d["notes"] + COMMON_NOTE
        out.append(d)
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", nargs="+", required=True, type=Path)
    ap.add_argument("--out", default="public/data/tsunami_arrival.json", type=Path)
    ap.add_argument("--names", default=DEFAULT_NAMES, type=Path)
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    args = ap.parse_args(argv)
    build_arrival(args.csv, args.out, args.names, manifest=args.manifest, dataset=datasets_for(args.csv))


if __name__ == "__main__":
    main()
