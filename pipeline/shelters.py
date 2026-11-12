"""国土地理院 指定緊急避難場所データ CSV → 2次メッシュ別 Shelter JSON。

出力: {out_dir}/{mesh2}.json = [{"id", "name", "pos": {"lat","lon"}, "earthquake", "tsunami"}]
CSV は UTF-8 (BOM 付き)・CRLF。県ごとのファイル名は NNNNN_2.csv（先頭2桁が県コード）。
複数の CSV、または CSV を含む zip を受け取る。共通ID の重複は最初の1件にまとめる。
既定の出力は build/data-build/<県コード>/shelters/（pipeline.merge で public/data/shelters/ に統合）。
"""
import argparse
import csv
import io
import json
import math
import re
import zipfile
from datetime import date
from pathlib import Path

from pipeline.manifest import update_manifest_pref
from pipeline.prefs import PREFS

DEFAULT_CSV = Path("data/raw/shelters/gsi_hinanbasho_24000_2.csv")
_PREF_FILE = re.compile(r"(\d{2})000_2\.(?:csv|zip)$")

LAT_UNITS = 480  # 5次メッシュ: 緯度 1/480 度
LON_UNITS = 320  # 経度 1/320 度
EPS = 1e-7


def mesh2(lat: float, lon: float) -> str:
    """緯度経度 → 2次メッシュコード(6桁)。src/core/mesh.ts と同じ境界規則。"""
    lat_idx = math.floor(lat * LAT_UNITS + EPS)
    lon_idx = math.floor((lon - 100) * LON_UNITS + EPS)
    p, u = lat_idx // 320, lon_idx // 320
    q, v = (lat_idx % 320) // 40, (lon_idx % 320) // 40
    return f"{p}{u}{q}{v}"


def _num(s: str):
    try:
        x = float(s)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def prefs_of(paths) -> list[str]:
    """ファイル名（…NNNNN_2.csv / .zip）から県コードを取り出す（昇順）。読めなければ ValueError。"""
    out = set()
    for p in paths:
        m = _PREF_FILE.search(Path(p).name)
        if not m or m.group(1) not in PREFS:
            raise ValueError(f"ファイル名から県コードが分からない: {p}")
        out.add(m.group(1))
    return sorted(out)


def _texts(path: Path):
    """CSV なら本文を1つ、zip なら中の *.csv の本文を順に返す。"""
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            names = sorted(n for n in zf.namelist() if n.lower().endswith(".csv"))
            if not names:
                raise ValueError(f"{path}: CSV が入っていない")
            for n in names:
                yield f"{path}!{n}", zf.read(n).decode("utf-8-sig")
    else:
        yield str(path), path.read_text(encoding="utf-8-sig")


def build_shelters(csv_paths, out_dir: Path) -> int:
    """csv_paths は1つのパスまたはパスのリスト（CSV または CSV を含む zip）。戻り値は出力件数。"""
    if isinstance(csv_paths, (str, Path)):
        csv_paths = [csv_paths]
    groups: dict = {}
    seen: dict = {}
    count = dropped = dup = conflict = 0
    for p in csv_paths:
        for _, text in _texts(p):
            for row in csv.DictReader(io.StringIO(text, newline="")):
                lat, lon = _num(row["緯度"]), _num(row["経度"])
                if lat is None or lon is None:
                    dropped += 1
                    continue
                item = {
                    "id": row["共通ID"],
                    "name": row["施設・場所名"],
                    "pos": {"lat": lat, "lon": lon},
                    "earthquake": row["地震"].strip() == "1",
                    "tsunami": row["津波"].strip() == "1",
                }
                if item["id"] in seen:
                    dup += 1
                    conflict += seen[item["id"]] != item
                    continue
                seen[item["id"]] = item
                groups.setdefault(mesh2(lat, lon), []).append(item)
                count += 1
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("??????.json"):
        old.unlink()
    for m2, items in groups.items():
        (out_dir / f"{m2}.json").write_text(
            json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    print(
        f"避難場所: {count} 件を出力（緯度経度が数値でない {dropped} 件を除外、"
        f"共通ID の重複 {dup} 件を1件にまとめた（うち内容が違う {conflict} 件は最初の行を採用））"
    )
    return count


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", nargs="+", default=[DEFAULT_CSV], type=Path, help="CSV または zip（…NNNNN_2）")
    ap.add_argument("--out", type=Path, help="既定 build/data-build/<県コード>/shelters（1県のときのみ）")
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    ap.add_argument("--updated", default="2026-11-06", help="データの最終更新日")
    a = ap.parse_args(argv)
    try:
        a.prefs = prefs_of(a.csv)
    except ValueError as e:
        ap.error(str(e))
    if a.out is None:
        if len(a.prefs) != 1:
            ap.error("複数の県のファイルを渡すときは --out を指定する")
        a.out = Path("build/data-build") / a.prefs[0] / "shelters"
    return a


def main(argv=None) -> None:
    args = parse_args(argv)
    build_shelters(args.csv, args.out)
    for pref in args.prefs:
        update_manifest_pref(
            args.manifest,
            {
                "id": "gsi-shelters",
                "name": "指定緊急避難場所データ（{prefs}）",
                "source": "国土地理院 指定緊急避難場所データ",
                "url": "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
                "publishedDate": args.updated,
                "license": "国土地理院コンテンツ利用規約・ご利用上の注意（出典明記）",
                "processedDate": date.today().isoformat(),
                "notes": "緯度経度が数値でない行は除外。共通ID の重複は1件にまとめる。地震・津波の対応可否のみ使用。データは最新でない場合や未掲載の場合がある。指定緊急避難場所と指定避難所は別。出力 public/data/shelters/ は git 対象外。",
            },
            pref,
            "最終更新 " + args.updated + "。",
        )

if __name__ == "__main__":
    main()
