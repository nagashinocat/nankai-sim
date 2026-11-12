import json
from pathlib import Path

from pipeline.manifest import update_manifest
from pipeline.naikaku_hazard import build_hazard

FIX = Path(__file__).parent / "fixtures"


def run(tmp_path):
    n = build_hazard(FIX / "eq.csv", FIX / "liq.csv", "L2", tmp_path)
    return n, tmp_path / "L2"


def test_values_and_order(tmp_path):
    n, d = run(tmp_path)
    data = json.loads((d / "523644.json").read_text())
    assert data["5236442023"] == [5.25, 7.25, 7.0, None, None]
    assert n == 4


def test_negative_ia_excluded(tmp_path):
    _, d = run(tmp_path)
    data = json.loads((d / "523644.json").read_text())
    assert "5236442026" not in data


def test_missing_liq_and_negative_s_are_null(tmp_path):
    _, d = run(tmp_path)
    data = json.loads((d / "523644.json").read_text())
    assert data["5236442024"] == [6.5, None, None, None, None]
    assert data["5236442025"][2] is None


def test_split_by_mesh2(tmp_path):
    _, d = run(tmp_path)
    assert sorted(p.name for p in d.glob("??????.json")) == ["513600.json", "523644.json"]


def test_quoted_and_unquoted_mesh(tmp_path):
    # Eq は引用符つき、Liq は引用符なし。両方が結合できている
    _, d = run(tmp_path)
    data = json.loads((d / "523644.json").read_text())
    assert data["5236442023"][1] == 7.25


def test_stale_mesh_files_removed(tmp_path):
    stale = tmp_path / "L2" / "999999.json"
    stale.parent.mkdir(parents=True)
    stale.write_text("{}")
    other = tmp_path / "L2" / "keep.txt"
    other.write_text("x")
    build_hazard(FIX / "eq.csv", FIX / "liq.csv", "L2", tmp_path)
    assert not stale.exists()
    assert other.exists()
    assert (tmp_path / "L2" / "523644.json").exists()


def test_update_manifest_replaces_same_id(tmp_path):
    p = tmp_path / "manifest.json"
    update_manifest(p, {"id": "a", "v": 1})
    update_manifest(p, {"id": "b", "v": 1})
    update_manifest(p, {"id": "a", "v": 2})
    ds = json.loads(p.read_text())["datasets"]
    assert ds == [{"id": "a", "v": 2}, {"id": "b", "v": 1}]


def test_case_map_includes_riku():
    from pipeline.naikaku_hazard import CASES
    assert CASES["L2_RIKU"] == "2"
    assert CASES["L2"] == "champ"


def test_case_map_includes_kihon_for_reconciliation():
    # Ruling T7-a: 内閣府ケース1（基本ケース）。岐阜・静岡（基本）の照合用。アプリは L2 のまま。
    from pipeline.naikaku_hazard import CASES
    assert CASES["L2_KIHON"] == "1"
    assert CASES == {"L2": "champ", "L2_RIKU": "2", "HALF_E": "1E", "HALF_W": "1W", "L2_KIHON": "1"}


def test_coverage_index_lists_written_mesh2(tmp_path):
    # アプリは index.json で「対応している2次メッシュ」を判定する（ファイルが無い＝範囲外、とは扱わない）
    _, d = run(tmp_path)
    index = json.loads((d / "index.json").read_text())
    assert index == ["513600", "523644"]
    assert index == sorted(p.stem for p in d.glob("??????.json"))


# --- 複数ファイル・gzip（4県の抽出） ---
import gzip

import pytest

from pipeline.naikaku_hazard import parse_args

EQ_HEAD = '"MESH","AVS","dI","I","CASE","X1","Y1","X2","Y2","Ia"'
LIQ_HEAD = "MESH,PL,S,CASE,X1,Y1,X2,Y2"


def eq_row(mesh, ia):
    return f'"{mesh}",100.0,0.1,1.0,"5",137.0,35.0,137.0,35.0,{ia}'


def liq_row(mesh, pl, s):
    return f"{mesh},{pl},{s},5,137.0,35.0,137.0,35.0"


def write(p, head, rows, gz=False):
    text = "\n".join([head] + rows) + "\n"
    if gz:
        with gzip.open(p, "wt", encoding="utf-8", newline="") as f:
            f.write(text)
    else:
        p.write_text(text, encoding="utf-8")
    return p


def test_gzip_input_same_as_plain(tmp_path):
    eq_gz = tmp_path / "eq.csv.gz"
    with gzip.open(eq_gz, "wb") as f:
        f.write((FIX / "eq.csv").read_bytes())
    liq_gz = tmp_path / "liq.csv.gz"
    with gzip.open(liq_gz, "wb") as f:
        f.write((FIX / "liq.csv").read_bytes())
    build_hazard(FIX / "eq.csv", FIX / "liq.csv", "L2", tmp_path / "plain")
    build_hazard(eq_gz, liq_gz, "L2", tmp_path / "gz")
    for name in ("523644.json", "513600.json", "index.json"):
        assert (tmp_path / "plain" / "L2" / name).read_text() == (tmp_path / "gz" / "L2" / name).read_text()


def test_multiple_files_union_and_consistent_overlap(tmp_path):
    a = write(tmp_path / "a.csv", EQ_HEAD, [eq_row("5236442023", 5.25), eq_row("5236442024", 6.5)])
    b = write(tmp_path / "b.csv.gz", EQ_HEAD, [eq_row("5236442024", 6.5), eq_row("5336001001", 4.0)], gz=True)
    la = write(tmp_path / "la.csv", LIQ_HEAD, [liq_row("5236442023", 7.25, 0.07)])
    lb = write(tmp_path / "lb.csv", LIQ_HEAD, [liq_row("5236442023", 7.25, 0.07), liq_row("5336001001", -1, -1)])
    n = build_hazard([a, b], [la, lb], "L2", tmp_path / "out")
    assert n == 3  # 重なったメッシュは1つとして数える
    d = tmp_path / "out" / "L2"
    assert json.loads((d / "523644.json").read_text()) == {
        "5236442023": [5.25, 7.25, 7.0, None, None],
        "5236442024": [6.5, None, None, None, None],
    }
    assert json.loads((d / "533600.json").read_text()) == {"5336001001": [4.0, None, None, None, None]}
    assert json.loads((d / "index.json").read_text()) == ["523644", "533600"]


def test_eq_mismatch_across_files_raises(tmp_path):
    a = write(tmp_path / "a.csv", EQ_HEAD, [eq_row("5236442023", 5.25)])
    b = write(tmp_path / "b.csv", EQ_HEAD, [eq_row("5236442023", 5.3)])
    liq = write(tmp_path / "l.csv", LIQ_HEAD, [])
    with pytest.raises(ValueError, match="5236442023"):
        build_hazard([a, b], [liq], "L2", tmp_path / "out")


def test_liq_mismatch_across_files_raises(tmp_path):
    eq = write(tmp_path / "e.csv", EQ_HEAD, [eq_row("5236442023", 5.25)])
    la = write(tmp_path / "la.csv", LIQ_HEAD, [liq_row("5236442023", 7.25, 0.07)])
    lb = write(tmp_path / "lb.csv", LIQ_HEAD, [liq_row("5236442023", 7.25, 0.08)])
    with pytest.raises(ValueError, match="5236442023"):
        build_hazard([eq], [la, lb], "L2", tmp_path / "out")


def test_negative_ia_mismatch_also_checked(tmp_path):
    # 片方で Ia<0（対象外）、もう片方で値あり → 不一致
    a = write(tmp_path / "a.csv", EQ_HEAD, [eq_row("5236442023", -1)])
    b = write(tmp_path / "b.csv", EQ_HEAD, [eq_row("5236442023", 5.0)])
    liq = write(tmp_path / "l.csv", LIQ_HEAD, [])
    with pytest.raises(ValueError):
        build_hazard([a, b], [liq], "L2", tmp_path / "out")


def test_cli_defaults_read_tokai_gz_and_accept_several():
    a = parse_args([])
    assert a.eq == ["data/raw/naikaku_tokai/tokai_Eq_{suffix}.csv.gz"]
    assert a.liq == ["data/raw/naikaku_tokai/tokai_Liq_{suffix}.csv.gz"]
    assert a.out == Path("public/data/hazard")
    assert a.reconcile_out == Path("build/hazard-reconcile")
    assert a.boundary_dir == Path("data/raw/boundary")
    assert a.stock == Path("public/data/stock/municipality_meshes.json")
    b = parse_args(["--eq", "x_{suffix}.csv", "y_{suffix}.csv.gz", "--liq", "l_{suffix}.csv"])
    assert b.eq == ["x_{suffix}.csv", "y_{suffix}.csv.gz"]
    assert [t.format(suffix="1E") for t in b.eq] == ["x_1E.csv", "y_1E.csv.gz"]


def test_cli_template_without_suffix_rejected():
    with pytest.raises(SystemExit):
        parse_args(["--eq", "plain.csv"])


# --- Ruling F1/F4: 対応範囲は 250m メッシュ単位（四角が4県の境界 r2ka21〜24 の和と面積>0で重なる）。照合用ケースは public/ の外 ---
from pipeline.building_stock import mesh_center  # noqa: E402
from pipeline.naikaku_hazard import (  # noqa: E402
    PUBLISHED_CASES,
    RECONCILE_CASES,
    case_out_dir,
    coverage_from_boundaries,
    meshes_in_geometry,
    remove_unpublished_cases,
)


def _box_around(meshes, pad=1e-5):
    from shapely.geometry import box

    cs = [mesh_center(m) for m in meshes]
    return box(min(c[1] for c in cs) - pad, min(c[0] for c in cs) - pad, max(c[1] for c in cs) + pad, max(c[0] for c in cs) + pad)


def _cell(mesh):
    """250m メッシュの四角（経度・緯度）。"""
    from shapely.geometry import box

    la, lo = mesh_center(mesh)
    return box(lo - 1 / 640, la - 1 / 960, lo + 1 / 640, la + 1 / 960)


def test_meshes_in_geometry_cells_that_overlap_land():
    # Ruling F4: メッシュの四角が陸と面積>0で重なれば対応範囲
    assert meshes_in_geometry(_box_around(["5236442023"])) == {"5236442023"}
    got = meshes_in_geometry(_box_around(["5236442021", "5236442024"]))
    assert got == {"5236442021", "5236442022", "5236442023", "5236442024"}


def test_coastal_cell_with_centre_in_sea_is_covered():
    # 海岸のメッシュ: 中心は海、四角の北端の一部（1割）だけ陸 → 対応範囲。南隣（陸なし）は範囲外
    from shapely.geometry import box

    c = _cell("5236442023")
    minx, miny, maxx, maxy = c.bounds
    land = box(minx - 0.01, maxy - (maxy - miny) * 0.1, maxx + 0.01, maxy + 0.01)  # 北側の陸（中心は含まない）
    la, lo = mesh_center("5236442023")
    assert not land.contains(__import__("shapely.geometry", fromlist=["Point"]).Point(lo, la))
    got = meshes_in_geometry(land)
    assert "5236442023" in got
    south = "5236442021"  # 5236442023 の南隣
    assert mesh_center(south)[0] < la
    assert south not in got


def test_cell_touching_land_only_along_an_edge_is_outside():
    # 陸と辺だけで接する（重なる面積 0）メッシュは範囲外。陸の無い離れたメッシュも範囲外
    c = _cell("5236442023")
    minx, miny, maxx, maxy = c.bounds
    from shapely.geometry import box

    land = box(minx, maxy, maxx, maxy + (maxy - miny) * 0.5)  # 5236442023 の北の辺から北へ
    got = meshes_in_geometry(land)
    assert "5236442023" not in got
    assert "5236449999" not in got and "5336001011" not in got


def test_meshes_in_geometry_accepts_several_polygons():
    assert meshes_in_geometry([_box_around(["5236442023"]), _box_around(["5336001011"])]) == {"5236442023", "5336001011"}


def test_coverage_from_boundaries_is_union_of_prefectures(tmp_path):
    import geopandas as gpd

    for pref, mesh in (("21", "5236442023"), ("24", "5336001011")):
        gpd.GeoDataFrame({"CITY_NAME": ["x"]}, geometry=[_box_around([mesh])], crs="EPSG:6668").to_file(tmp_path / f"r2ka{pref}.shp")
    assert coverage_from_boundaries(tmp_path, ["21", "24"]) == {"5236442023", "5336001011"}
    with pytest.raises(Exception):
        coverage_from_boundaries(tmp_path, ["22"])  # 境界ファイルが無い県は失敗させる（黙って範囲を狭めない）


def test_coverage_limits_rows_per_250m_mesh(tmp_path):
    # 5236442023/24 は4県内、5236442025 は同じ2次メッシュだが4県外（隣県）、5235350011 は4県外の2次メッシュ
    eq = write(tmp_path / "e.csv", EQ_HEAD, [eq_row("5236442023", 5.5), eq_row("5236442024", 5.0), eq_row("5236442025", 6.8), eq_row("5235350011", 6.0)])
    liq = write(tmp_path / "l.csv", LIQ_HEAD, [])
    n = build_hazard([eq], [liq], "L2", tmp_path / "out", coverage={"5236442023", "5236442024"})
    assert n == 2
    d = tmp_path / "out" / "L2"
    assert json.loads((d / "index.json").read_text()) == ["523644"]
    assert not (d / "523535.json").exists()
    # 同じ2次メッシュでも4県外の 250m メッシュの行は書かない（アプリは行が無いメッシュを「まだ対応していません」）
    assert set(json.loads((d / "523644.json").read_text())) == {"5236442023", "5236442024"}


def test_covered_mesh_without_hazard_gets_null_row(tmp_path):
    # 4県内なのに想定値が無い（Ia<0 または行が無い）→ 全項目 null の行（アプリは「この場所のデータなし」）。
    # 4県内のメッシュだけの2次メッシュ（533600）も index.json に入る。
    eq = write(tmp_path / "e.csv", EQ_HEAD, [eq_row("5236442023", 5.5), eq_row("5236442026", -1)])
    liq = write(tmp_path / "l.csv", LIQ_HEAD, [liq_row("5236442026", 3.0, 0.1)])
    n = build_hazard([eq], [liq], "L2", tmp_path / "out", coverage={"5236442023", "5236442026", "5336001001"})
    assert n == 1
    d = tmp_path / "out" / "L2"
    assert json.loads((d / "523644.json").read_text()) == {
        "5236442023": [5.5, None, None, None, None],
        "5236442026": [None, None, None, None, None],
    }
    assert json.loads((d / "533600.json").read_text()) == {"5336001001": [None, None, None, None, None]}
    assert json.loads((d / "index.json").read_text()) == ["523644", "533600"]


def test_coverage_none_keeps_everything(tmp_path):
    eq = write(tmp_path / "e.csv", EQ_HEAD, [eq_row("5236442023", 5.5), eq_row("5235350011", 6.0)])
    liq = write(tmp_path / "l.csv", LIQ_HEAD, [])
    assert build_hazard([eq], [liq], "L2", tmp_path / "out") == 2


def test_reconcile_cases_go_outside_public(tmp_path):
    assert PUBLISHED_CASES == ["L2", "HALF_E", "HALF_W"]
    assert RECONCILE_CASES == ["L2_RIKU", "L2_KIHON"]
    from pipeline.naikaku_hazard import CASES
    assert set(PUBLISHED_CASES) | set(RECONCILE_CASES) == set(CASES)
    pub, rec = tmp_path / "public", tmp_path / "build"
    assert case_out_dir("L2", pub, rec) == pub
    assert case_out_dir("HALF_W", pub, rec) == pub
    assert case_out_dir("L2_RIKU", pub, rec) == rec
    assert case_out_dir("L2_KIHON", pub, rec) == rec
    with pytest.raises(ValueError):
        case_out_dir("BOGUS", pub, rec)


def test_stale_reconcile_cases_removed_from_public(tmp_path):
    pub = tmp_path / "public"
    for c in ("L2", "L2_RIKU", "L2_KIHON"):
        (pub / c).mkdir(parents=True)
        (pub / c / "index.json").write_text("[]")
    assert remove_unpublished_cases(pub) == ["L2_KIHON", "L2_RIKU"]
    assert sorted(p.name for p in pub.iterdir()) == ["L2"]
