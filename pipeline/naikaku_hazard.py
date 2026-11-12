"""内閣府 南海トラフ巨大地震 データセットA の CSV → メッシュ別ハザード JSON。

入力は Eq（震度）・Liq（液状化）の CSV（.csv または .csv.gz）。それぞれ複数ファイルを受け取り、
同じメッシュが複数ファイル（または同じファイルの複数行）にあるときは値が一致することを確かめる（不一致は ValueError）。
既定の入力は5県（静岡・愛知・岐阜・三重・和歌山）を含む抽出 data/raw/naikaku_tokai/tokai_{Eq,Liq}_<case>.csv.gz と、
和歌山県の東経135度より西（1次メッシュ 5034・5134）の抽出 data/raw/naikaku_tokai/w34_{Eq,Liq}_<case>.csv.gz（ケースごとに両方を読む）。

出力先: 公開するケース（L2・HALF_E・HALF_W）は public/data/hazard、照合用（L2_RIKU・L2_KIHON）は build/hazard-reconcile。
対応範囲は 250m メッシュ単位（Ruling F1・F4）: メッシュの四角が5県の小地域境界 data/raw/boundary/r2ka{21,22,23,24,30}.shp の和と面積>0で重なるもの。
建物の有無は問わない（山林も対応範囲）。統合後の建物（public/data/stock/municipality_meshes.json）が範囲内にあることも確かめる。

出力: {out_dir}/{case}/{mesh2}.json = {"<mesh250>": [Ia, PL, settlementCm, None, None]}
        対応範囲の 250m メッシュだけ。範囲内で想定値が無い（Ia<0・行なし）メッシュは全項目 null の行。
        行の無いメッシュは対応範囲外（隣県など）。
      {out_dir}/{case}/index.json = 書き出した2次メッシュコードの昇順リスト
"""
import argparse
import csv
import gzip
import json
from datetime import date
from pathlib import Path

from pipeline.manifest import update_manifest

# L2_KIHON = 内閣府ケース1（基本ケース）。岐阜県・静岡県（基本ケース）の公表値との照合用で、アプリは使わない（Ruling T7-a）。
CASES = {"L2": "champ", "L2_RIKU": "2", "HALF_E": "1E", "HALF_W": "1W", "L2_KIHON": "1"}
# 公開する（アプリが読む）ケースと、照合（scripts/reconcile.ts）だけに使うケース（Ruling T7-f: 照合用は public/ の外）
PUBLISHED_CASES = ["L2", "HALF_E", "HALF_W"]
RECONCILE_CASES = ["L2_RIKU", "L2_KIHON"]
DEFAULT_STOCK = "public/data/stock/municipality_meshes.json"
DEFAULT_BOUNDARY_DIR = "data/raw/boundary"
COVERAGE_PREFS = ["21", "22", "23", "24", "30"]
# 和歌山県の西端は東経135度より西のため、1次メッシュ 5034・5134 は w34_* に別に抽出してある
DEFAULT_EQ = ["data/raw/naikaku_tokai/tokai_Eq_{suffix}.csv.gz", "data/raw/naikaku_tokai/w34_Eq_{suffix}.csv.gz"]
DEFAULT_LIQ = ["data/raw/naikaku_tokai/tokai_Liq_{suffix}.csv.gz", "data/raw/naikaku_tokai/w34_Liq_{suffix}.csv.gz"]


def _open(path: Path):
    path = Path(path)
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", newline="")
    return open(path, newline="", encoding="utf-8")


def _paths(x) -> list[Path]:
    return [Path(x)] if isinstance(x, (str, Path)) else [Path(p) for p in x]


def _put(d: dict, mesh: str, val, where: str) -> None:
    old = d.setdefault(mesh, val)
    if old != val:
        raise ValueError(f"メッシュ {mesh} の値がファイル間で違う: {old} / {val}（{where}）")


def _read_eq(eq_csvs) -> dict:
    """mesh → Ia（Ia<0 も含む。重複は一致を確認）。最初に現れた順。"""
    eq: dict = {}
    for p in _paths(eq_csvs):
        with _open(p) as f:
            for i, row in enumerate(csv.DictReader(f), start=2):
                _put(eq, row["MESH"].strip().strip('"'), float(row["Ia"]), f"{p}:{i}")
    return eq


def _read_liq(liq_csvs) -> dict:
    raw: dict = {}
    for p in _paths(liq_csvs):
        with _open(p) as f:
            for i, row in enumerate(csv.DictReader(f), start=2):
                _put(raw, row["MESH"].strip().strip('"'), (float(row["PL"]), float(row["S"])), f"{p}:{i}")
    return {
        mesh: (
            pl if pl >= 0 else None,  # PL=-1 は対象外
            round(s * 100, 3) if s >= 0 else None,  # m -> cm、S<0 は対象層なし
        )
        for mesh, (pl, s) in raw.items()
    }


def meshes_in_geometry(geoms) -> set[str]:
    """shapely のジオメトリ（1つまたはリスト。EPSG:6668 の経度・緯度）→ 250m メッシュの四角がそれと面積>0で重なるメッシュの集合（Ruling F4）。

    四角がどれかのポリゴンの内部に収まるものはそのまま、境界にかかるものだけ重なりの面積を計算する（STRtree で候補を絞る）。
    """
    import numpy as np
    import shapely

    from pipeline.building_stock import _LAT_UNITS, _LON_BASE, _LON_UNITS, latlon_to_mesh250

    polys = [geoms] if hasattr(geoms, "geom_type") else list(geoms)
    parts = []
    for g in polys:
        g = shapely.make_valid(g)
        parts += [q for q in shapely.get_parts(g) if q.geom_type in ("Polygon", "MultiPolygon") and not q.is_empty]
    parts = [q for q in shapely.get_parts(parts) if q.area > 0] if parts else []
    if not parts:
        return set()
    parts_arr = np.array(parts, dtype=object)
    minx, miny, maxx, maxy = shapely.total_bounds(parts_arr)
    lat_idx = np.arange(int(np.floor(miny * _LAT_UNITS)), int(np.ceil(maxy * _LAT_UNITS)) + 1)
    lon_idx = np.arange(int(np.floor((minx - _LON_BASE) * _LON_UNITS)), int(np.ceil((maxx - _LON_BASE) * _LON_UNITS)) + 1)
    gi, gj = np.meshgrid(lon_idx, lat_idx)
    gi, gj = gi.ravel(), gj.ravel()
    x0 = _LON_BASE + gi / _LON_UNITS
    y0 = gj / _LAT_UNITS
    cells = shapely.box(x0, y0, x0 + 1 / _LON_UNITS, y0 + 1 / _LAT_UNITS)
    tree = shapely.STRtree(parts_arr)
    # 内部に収まる四角（大半）は面積計算なし
    ci, _ = tree.query(cells, predicate="within")
    covered = np.zeros(len(cells), dtype=bool)
    covered[ci] = True
    ci, pj = tree.query(cells, predicate="intersects")
    keep = ~covered[ci]
    ci, pj = ci[keep], pj[keep]
    if len(ci):
        area = shapely.area(shapely.intersection(cells[ci], parts_arr[pj]))
        covered[ci[area > 0]] = True
    idx = np.nonzero(covered)[0]
    return {latlon_to_mesh250((gj[k] + 0.5) / _LAT_UNITS, _LON_BASE + (gi[k] + 0.5) / _LON_UNITS) for k in idx}


def coverage_from_boundaries(boundary_dir: Path, prefs=COVERAGE_PREFS) -> set[str]:
    """r2ka<県コード>.shp（小地域境界）の和 → 四角がそれと面積>0で重なる 250m メッシュの集合（Ruling F1・F4 の対応範囲）。"""
    import geopandas as gpd

    polys = []
    for pref in prefs:
        shp = Path(boundary_dir) / f"r2ka{pref}.shp"
        if not shp.exists():
            raise FileNotFoundError(f"{shp}: 境界データが無い（対応範囲を決められない）")
        polys += list(gpd.read_file(shp).to_crs("EPSG:6668").geometry)
    cov = meshes_in_geometry(polys)
    if not cov:
        raise ValueError(f"{boundary_dir}: 対応範囲のメッシュが1つもない")
    return cov


def stock_meshes(municipality_meshes: Path) -> set[str]:
    """統合後の建物の municipality_meshes.json → 市町村に割り当てた 250m メッシュの集合（対応範囲内にあることの確認用）。"""
    mm = json.loads(Path(municipality_meshes).read_text(encoding="utf-8"))
    return {m for meshes in mm.values() for m in meshes}


def case_out_dir(case: str, out: Path, reconcile_out: Path) -> Path:
    """公開するケースは out（public/data/hazard）、照合用ケースは reconcile_out（build/hazard-reconcile）。"""
    if case in PUBLISHED_CASES:
        return Path(out)
    if case in RECONCILE_CASES:
        return Path(reconcile_out)
    raise ValueError(f"未知のケース: {case}")


def remove_unpublished_cases(out: Path) -> list[str]:
    """out（公開先）に残っている照合用ケースのフォルダを消す。戻り値は消したケース名。"""
    import shutil

    removed = []
    for case in sorted(RECONCILE_CASES):
        d = Path(out) / case
        if d.is_dir():
            shutil.rmtree(d)
            removed.append(case)
    return removed


def build_hazard(eq_csv, liq_csv, case: str, out_dir: Path, coverage: set[str] | None = None) -> int:
    """eq_csv・liq_csv は1つのパスまたはパスのリスト。戻り値は書き出したメッシュ数。

    coverage（250m メッシュコードの集合）を渡すと、その 250m メッシュの行だけを書き出す（index.json もその2次メッシュ）。
    範囲内で想定値の無いメッシュは全項目 null の行にする（アプリは「データなし」。行が無い＝範囲外と区別する）。
    """
    liq = _read_liq(liq_csv)
    groups: dict = {}
    count = 0
    for mesh, ia in _read_eq(eq_csv).items():
        if ia < 0 or (coverage is not None and mesh not in coverage):
            continue
        pl, s_cm = liq.get(mesh, (None, None))
        groups.setdefault(mesh[:6], {})[mesh] = [ia, pl, s_cm, None, None]
        count += 1
    for mesh in sorted(coverage or ()):
        groups.setdefault(mesh[:6], {}).setdefault(mesh, [None, None, None, None, None])
    case_dir = Path(out_dir) / case
    case_dir.mkdir(parents=True, exist_ok=True)
    for old in case_dir.glob("??????.json"):
        old.unlink()
    for mesh2, data in groups.items():
        (case_dir / f"{mesh2}.json").write_text(
            json.dumps(data, separators=(",", ":")), encoding="utf-8"
        )
    # 対応範囲。アプリはここに無い2次メッシュを「まだ対応していない地域」、
    # ここにあるのにファイルが読めない場合を「読み込み失敗」として扱う。
    (case_dir / "index.json").write_text(
        json.dumps(sorted(groups), separators=(",", ":")), encoding="utf-8"
    )
    return count


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eq", nargs="+", default=list(DEFAULT_EQ), help="Eq CSV のパス（{suffix} がケース名 champ/2/1E/1W/1 に置き換わる）")
    ap.add_argument("--liq", nargs="+", default=list(DEFAULT_LIQ), help="Liq CSV のパス（{suffix} を含む）")
    ap.add_argument("--out", default="public/data/hazard", type=Path, help="公開するケース（L2・HALF_E・HALF_W）の出力")
    ap.add_argument("--reconcile-out", default="build/hazard-reconcile", type=Path, help="照合用ケース（L2_RIKU・L2_KIHON）の出力（public/ の外）")
    ap.add_argument("--boundary-dir", default=DEFAULT_BOUNDARY_DIR, type=Path, help="対応範囲を決める r2ka<県コード>.shp（COVERAGE_PREFS）の場所")
    ap.add_argument("--stock", default=DEFAULT_STOCK, type=Path, help="統合後の municipality_meshes.json（建物のメッシュが対応範囲内にあるかの確認）")
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    a = ap.parse_args(argv)
    for t in a.eq + a.liq:
        if "{suffix}" not in t:
            ap.error(f"パスに {{suffix}} がない: {t}")
    return a


def main(argv=None) -> None:
    args = parse_args(argv)
    coverage = coverage_from_boundaries(args.boundary_dir)
    print(f"対応範囲: 250m メッシュ {len(coverage)}、2次メッシュ {len({m[:6] for m in coverage})}（{args.boundary_dir}/r2ka{{{','.join(COVERAGE_PREFS)}}}.shp）")
    if args.stock.exists():
        stray = stock_meshes(args.stock) - coverage
        if stray:
            raise ValueError(f"建物を割り当てたメッシュが対応範囲の外にある: {len(stray)} 件（例 {sorted(stray)[:5]}）")
        print(f"建物を割り当てたメッシュはすべて対応範囲内（{args.stock}）")
    for case, suffix in CASES.items():
        out = case_out_dir(case, args.out, args.reconcile_out)
        n = build_hazard(
            [t.format(suffix=suffix) for t in args.eq],
            [t.format(suffix=suffix) for t in args.liq],
            case,
            out,
            coverage,
        )
        print(f"{case}: {n} meshes → {out / case}")
    for case in remove_unpublished_cases(args.out):
        print(f"公開先から照合用ケースを削除: {args.out / case}")
    probe = json.loads((args.out / "L2" / "523644.json").read_text())
    print("L2 5236442023 =", json.dumps(probe.get("5236442023")))
    update_manifest(
        args.manifest,
        {
            "id": "naikaku-hazard",
            "name": "南海トラフ巨大地震 メッシュ別ハザード（静岡県・愛知県・岐阜県・三重県・和歌山県を含む範囲）",
            "source": "内閣府 南海トラフの巨大地震モデル・被害想定手法検討会 データセットA（令和7年）",
            "url": "https://www.geospatial.jp/ckan/dataset/02543200-9310-4fc0-bcbb-bb1d4ff64990",
            "publishedDate": "令和7年",
            "license": "加工物は頒布可・元データの再配布禁止・出典明記",
            "processedDate": date.today().isoformat(),
            "notes": "1次メッシュ 緯度コード50〜54 × 経度コード35〜39（静岡県・愛知県・岐阜県・三重県・和歌山県の東経135度以東を含む）と、和歌山県の東経135度以西の 5034・5134 の抽出を使用。複数ファイルに同じメッシュがあれば値の一致を確認。Ia（参考震度）<0 のメッシュは除外。液状化は PL・沈下量(cm)、対象外は null。津波項目は null。ケース: L2=champ（ケース1〜5と経験的手法の最大値）, L2_RIKU=ケース2（陸側ケース。県・内閣府の公表値と比較する基準）, HALF_E=1E, HALF_W=1W, L2_KIHON=ケース1（基本ケース。岐阜県・静岡県の基本ケースの公表値と比較する照合用。アプリは使わない）。対応範囲は250mメッシュ単位で、メッシュの四角が5県の小地域境界（国勢調査 r2ka21〜24・30）の和と面積>0で重なるものだけ（建物の有無は問わない。範囲内で想定値の無いメッシュは null の行。行の無いメッシュ（隣県など）は「まだ対応していません」）。公開するのは L2・HALF_E・HALF_W（public/data/hazard/）。L2_RIKU・L2_KIHON は照合用で build/hazard-reconcile/ に出力し公開しない。いずれも git 対象外。",
        },
    )


if __name__ == "__main__":
    main()
