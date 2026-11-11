import json
from pathlib import Path

import geopandas as gpd
import openpyxl
import pytest
from shapely.geometry import box

from pipeline.building_stock import (
    build_stock,
    build_stock_full,
    latlon_to_mesh250,
    mesh_center,
    parse_housing_6_3,
    parse_kotei,
)

FIX = Path(__file__).parent / "fixtures"
RAW = Path(__file__).resolve().parents[2] / "data" / "raw"
needs_raw = pytest.mark.skipif(not RAW.exists(), reason="data/raw がない")


def test_mesh_center_matches_engine():
    lat, lon = mesh_center("5236442023")
    assert lat == pytest.approx(35.0198, abs=1e-4)
    assert lon == pytest.approx(136.5078, abs=1e-4)
    assert latlon_to_mesh250(lat, lon) == "5236442023"


def test_parse_housing_6_3_komono():
    h = parse_housing_6_3(FIX / "housing_excerpt.txt")
    k = h["菰野町"]
    assert k["wood:pre1981"] == 1330 + 1710
    assert k["rc:post2000"] == 330 + 520 + 30
    assert k["rc:pre1981"] == 0 + 130  # 1970年以前の「-」は 0
    assert k["wood:y1981_2000"] == 1120 + 2480
    assert "津市" not in h  # 第6-2表（9区分）は対象外
    assert set(h) == {"東員町", "菰野町", "三重県"}


def test_parse_housing_prefecture_block():
    h = parse_housing_6_3(FIX / "housing_excerpt.txt")["三重県"]
    assert h["wood:pre1981"] == 23300 + 37700 + 67400
    assert h["rc:post2000"] == 17200 + 16400 + 9900 + 8400 + 3700 + 2400 + 1400 + 1200 + 1300
    assert len(h) == 9


def make_kotei(path, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["第22表　総括表"])
    ws.append(["列番号", None, None, None, None, 1, 2, 3])
    ws.append(["団体コード", "都道府県名", "市町村名", "表側", "団体区分（５）", "棟数", "床面積（㎡）", "決定価格（千円）"])
    for pref, name, wood, non in rows:
        ws.append([240000, pref, name, "木造・総数", 3, wood, 1, 1])
        ws.append([240000, pref, name, "木造・法定免税点以上のもの", 3, 1, 1, 1])
        ws.append([240000, pref, name, "木造以外・総数", 3, non, 1, 1])
    wb.save(path)


def test_parse_kotei_fixture(tmp_path):
    p = tmp_path / "k.xlsx"
    make_kotei(p, [("三重県", "菰野町", 100, 50), ("愛知県", "名古屋市", 9, 9)])
    assert parse_kotei(p, "三重県") == {"菰野町": (100, 50)}


@needs_raw
def test_parse_kotei_real_komono():
    k = parse_kotei(RAW / "kotei" / "kotei_r06_soukatsu.xlsx", "三重県")
    assert k["菰野町"] == (24209, 11369)
    assert len(k) == 29


@needs_raw
def test_parse_housing_real_komono():
    h = parse_housing_6_3(RAW / "housing" / "mie_housing_r5.txt")
    assert h["菰野町"]["wood:pre1981"] == 1330 + 1710
    assert h["菰野町"]["rc:post2000"] == 330 + 520 + 30
    assert "三重県" in h and len(h) == 20


# --- build_stock の合成入力 ---
LAT = 35.0198
LON0 = 136.5078


def mesh_at(k, row=0):
    return latlon_to_mesh250(LAT + row * 3 / 480, LON0 + k / 320)


def make_inputs(tmp_path, households, kotei_rows=None):
    """households: {(k,row): 世帯数 or '*' or ''}"""
    raw = tmp_path / "raw"
    (raw / "census_mesh").mkdir(parents=True)
    (raw / "boundary").mkdir()
    lines = ["KEY_CODE,HTKSYORI,HTKSAKI,GASSAN,T001142001,T001142002", ",,,,　人口（総数）,　世帯総数"]
    for (k, row), v in households.items():
        lines.append(f"{mesh_at(k, row)},0,,,10,{v}")
    lines.append("5236000022,0,,,1,1")  # 境界外
    (raw / "census_mesh" / "tblT001142Q5236.txt").write_bytes(("\n".join(lines) + "\n").encode("cp932"))
    lon_a = LON0 + 2.5 / 320
    lon_b = LON0 + 4.5 / 320
    g = gpd.GeoDataFrame(
        {
            "KEY_CODE": ["1", "2", "3", "4"],
            "CITY_NAME": ["菰野町", "菰野町", "東員町", "朝日町"],
            "geometry": [
                box(136.505, 35.015, 136.51, 35.025),
                box(136.51, 35.015, lon_a, 35.025),
                box(lon_a, 35.015, lon_b, 35.025),
                box(136.505, 35.0255, 136.52, 35.04),
            ],
        },
        crs="EPSG:6668",
    )
    g.to_file(raw / "boundary" / "b.shp")
    housing = FIX / "housing_excerpt.txt"
    kotei = tmp_path / "k.xlsx"
    make_kotei(kotei, kotei_rows or [("三重県", "菰野町", 1000, 500), ("三重県", "東員町", 600, 300), ("三重県", "朝日町", 200, 100)])
    return raw / "census_mesh", raw / "boundary" / "b.shp", housing, kotei


HH = {(0, 0): 10, (1, 0): "*", (2, 0): 30, (3, 0): 20, (4, 0): 20, (5, 0): 99, (0, 1): 5, (1, 1): ""}


def load_all(out):
    d = {}
    for f in out.glob("??????.json"):
        d.update(json.loads(f.read_text()))
    return d


def test_totals_conserved_and_allocation(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    out = tmp_path / "out"
    totals = build_stock(c, b, h, k, out)
    assert totals == {"菰野町": 1500, "東員町": 900, "朝日町": 300}
    meshes = load_all(out)
    # 菰野町: 世帯 10 + 0(*) + 30、棟数 1500 を按分
    assert meshes[mesh_at(0)]["total"] == pytest.approx(1500 * 10 / 40)
    assert meshes[mesh_at(2)]["total"] == pytest.approx(1500 * 30 / 40)
    assert mesh_at(1) not in meshes  # 世帯 "*" は 0 → 出力しない
    assert mesh_at(1, 1) not in meshes  # 空欄も 0
    assert sum(m["total"] for m in meshes.values()) == pytest.approx(1500 + 900 + 300)


def test_outside_boundary_not_allocated(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    out = tmp_path / "out"
    build_stock(c, b, h, k, out)
    meshes = load_all(out)
    assert mesh_at(5) not in meshes  # 中心点がどの市町にも入らない
    assert "5236000022" not in meshes


def test_each_mesh_in_one_municipality(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    out = tmp_path / "out"
    build_stock(c, b, h, k, out)
    mm = json.loads((out / "municipality_meshes.json").read_text())
    assert set(mm) == {"菰野町", "東員町", "朝日町"}
    allm = [m for v in mm.values() for m in v]
    assert len(allm) == len(set(allm))
    assert set(mm["菰野町"]) == {mesh_at(0), mesh_at(2)}
    assert set(allm) == set(load_all(out))


def test_shares_sum_to_one_and_weights(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    out = tmp_path / "out"
    build_stock(c, b, h, k, out)
    m = load_all(out)[mesh_at(0)]
    assert sum(m["shares"].values()) == pytest.approx(1.0)
    assert set(m["shares"]) == {f"{s}:{e}" for s in ("wood", "rc", "steel") for e in ("pre1981", "y1981_2000", "post2000")}
    wood_share = 1000 / 1500
    assert m["shares"]["wood:pre1981"] == pytest.approx(wood_share * (1330 + 1710) / 11130)
    assert sum(v for key, v in m["shares"].items() if key.startswith("wood")) == pytest.approx(wood_share)


def test_missing_housing_uses_prefecture_and_notes(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    r = build_stock_full(c, b, h, k, tmp_path / "out")
    assert r.fallback == ["朝日町"]
    assert "朝日町" in r.notes and "菰野町" not in r.notes
    asahi = load_all(tmp_path / "out")[mesh_at(0, 1)]
    pref = parse_housing_6_3(h)["三重県"]
    wood_total = sum(v for key, v in pref.items() if key.startswith("wood"))
    assert asahi["shares"]["wood:pre1981"] == pytest.approx((200 / 300) * pref["wood:pre1981"] / wood_total)


def test_all_zero_households_raises(tmp_path):
    hh = dict(HH)
    hh[(3, 0)] = 0
    hh[(4, 0)] = "*"
    c, b, h, k = make_inputs(tmp_path, hh)
    with pytest.raises(ValueError, match="東員町"):
        build_stock(c, b, h, k, tmp_path / "out")
