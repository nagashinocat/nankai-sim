"""国土地理院 指定緊急避難場所データ CSV → 2次メッシュ別 Shelter JSON。

出力: {out_dir}/{mesh2}.json = [{"id", "name", "pos": {"lat","lon"}, "earthquake", "tsunami"}]
CSV は UTF-8 (BOM 付き)・CRLF。
"""
import argparse
import csv
import json
import math
from datetime import date
from pathlib import Path

from pipeline.manifest import update_manifest

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


def build_shelters(csv_path: Path, out_dir: Path) -> int:
    groups: dict = {}
    count = dropped = 0
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            lat, lon = _num(row["緯度"]), _num(row["経度"])
            if lat is None or lon is None:
                dropped += 1
                continue
            groups.setdefault(mesh2(lat, lon), []).append(
                {
                    "id": row["共通ID"],
                    "name": row["施設・場所名"],
                    "pos": {"lat": lat, "lon": lon},
                    "earthquake": row["地震"].strip() == "1",
                    "tsunami": row["津波"].strip() == "1",
                }
            )
            count += 1
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("??????.json"):
        old.unlink()
    for m2, items in groups.items():
        (out_dir / f"{m2}.json").write_text(
            json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    print(f"避難場所: {count} 件を出力（緯度経度が数値でない {dropped} 件を除外）")
    return count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="data/raw/shelters/gsi_hinanbasho_24000_2.csv", type=Path)
    ap.add_argument("--out", default="public/data/shelters", type=Path)
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    ap.add_argument("--updated", default="2026-11-06", help="データの最終更新日")
    args = ap.parse_args()
    build_shelters(args.csv, args.out)
    update_manifest(
        args.manifest,
        {
            "id": "gsi-shelters",
            "name": "指定緊急避難場所データ（三重県）",
            "source": "国土地理院 指定緊急避難場所データ",
            "url": "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
            "publishedDate": args.updated,
            "license": "国土地理院コンテンツ利用規約・ご利用上の注意（出典明記）",
            "processedDate": date.today().isoformat(),
            "notes": "最終更新 " + args.updated + "。緯度経度が数値でない行は除外。地震・津波の対応可否のみ使用。データは最新でない場合や未掲載の場合がある。指定緊急避難場所と指定避難所は別。出力 public/data/shelters/ は git 対象外。",
        },
    )


if __name__ == "__main__":
    main()
