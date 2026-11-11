"""内閣府 南海トラフ巨大地震 データセットA の CSV → メッシュ別ハザード JSON。

出力: {out_dir}/{case}/{mesh2}.json = {"<mesh250>": [Ia, PL, settlementCm, None, None]}
"""
import argparse
import csv
import json
from datetime import date
from pathlib import Path

from pipeline.manifest import update_manifest

CASES = {"L2": "champ", "L2_RIKU": "2", "HALF_E": "1E", "HALF_W": "1W"}


def _read_liq(liq_csv: Path) -> dict:
    liq = {}
    with open(liq_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pl = float(row["PL"])
            s = float(row["S"])
            liq[row["MESH"].strip().strip('"')] = (
                pl if pl >= 0 else None,  # PL=-1 は対象外
                round(s * 100, 3) if s >= 0 else None,  # m -> cm、S<0 は対象層なし
            )
    return liq


def build_hazard(eq_csv: Path, liq_csv: Path, case: str, out_dir: Path) -> int:
    liq = _read_liq(Path(liq_csv))
    groups: dict = {}
    count = 0
    with open(eq_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ia = float(row["Ia"])
            if ia < 0:
                continue
            mesh = row["MESH"].strip().strip('"')
            pl, s_cm = liq.get(mesh, (None, None))
            groups.setdefault(mesh[:6], {})[mesh] = [ia, pl, s_cm, None, None]
            count += 1
    case_dir = Path(out_dir) / case
    case_dir.mkdir(parents=True, exist_ok=True)
    for old in case_dir.glob("??????.json"):
        old.unlink()
    for mesh2, data in groups.items():
        (case_dir / f"{mesh2}.json").write_text(
            json.dumps(data, separators=(",", ":")), encoding="utf-8"
        )
    return count


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="data/raw/naikaku", type=Path)
    ap.add_argument("--out", default="public/data/hazard", type=Path)
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    args = ap.parse_args()
    for case, suffix in CASES.items():
        n = build_hazard(
            args.raw / f"mie_Eq_{suffix}.csv",
            args.raw / f"mie_Liq_{suffix}.csv",
            case,
            args.out,
        )
        print(f"{case}: {n} meshes")
    probe = json.loads((args.out / "L2" / "523644.json").read_text())
    print("L2 5236442023 =", json.dumps(probe.get("5236442023")))
    update_manifest(
        args.manifest,
        {
            "id": "naikaku-hazard",
            "name": "南海トラフ巨大地震 メッシュ別ハザード（三重県）",
            "source": "内閣府 南海トラフの巨大地震モデル・被害想定手法検討会 データセットA（令和7年）",
            "url": "https://www.geospatial.jp/ckan/dataset/02543200-9310-4fc0-bcbb-bb1d4ff64990",
            "publishedDate": "令和7年",
            "license": "加工物は頒布可・元データの再配布禁止・出典明記",
            "processedDate": date.today().isoformat(),
            "notes": "Ia（参考震度）<0 のメッシュは除外。液状化は PL・沈下量(cm)、対象外は null。津波項目は null。ケース: L2=champ（ケース1〜5と経験的手法の最大値）, L2_RIKU=ケース2（陸側ケース。県・内閣府の公表値と比較する基準）, HALF_E=1E, HALF_W=1W。出力 public/data/hazard/ は git 対象外。",
        },
    )


if __name__ == "__main__":
    main()
