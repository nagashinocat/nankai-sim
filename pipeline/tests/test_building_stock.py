import json
from pathlib import Path

import geopandas as gpd
import openpyxl
import pytest
from shapely.geometry import box

from pipeline.building_stock import (
    PREFS,
    build_stock,
    build_stock_full,
    latlon_to_mesh250,
    mesh_center,
    municipality_name,
    parse_args,
    parse_housing_6_3,
    parse_housing_estat_csv,
    parse_kotei,
    pref_inputs,
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


# --- 県コード対応 ---
def test_prefs_codes():
    assert PREFS == {"21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "30": "和歌山県"}


def test_pref_inputs_mie_uses_6_3_text(tmp_path):
    p = pref_inputs("24", tmp_path)
    assert p.name == "三重県"
    assert p.boundary == tmp_path / "boundary" / "r2ka24.shp"
    assert p.housing == tmp_path / "housing" / "mie_housing_r5.txt"
    assert p.parse_housing is parse_housing_6_3


@pytest.mark.parametrize("code,name", [("21", "岐阜県"), ("22", "静岡県"), ("23", "愛知県"), ("30", "和歌山県")])
def test_pref_inputs_tokai_use_estat_csv(tmp_path, code, name):
    p = pref_inputs(code, tmp_path)
    assert p.name == name
    assert p.boundary == tmp_path / "boundary" / f"r2ka{code}.shp"
    assert p.housing == tmp_path / "housing" / "estat_r5_6-3-2_tokai_raw.csv"
    assert p.parse_housing.func is parse_housing_estat_csv and p.parse_housing.keywords == {"pref": name}


def test_pref_inputs_unknown_code(tmp_path):
    with pytest.raises(ValueError, match="13"):
        pref_inputs("13", tmp_path)


def test_cli_requires_pref_and_defaults_out_per_pref():
    with pytest.raises(SystemExit):
        parse_args([])
    a = parse_args(["--pref", "23"])
    assert a.pref == "23"
    assert a.out == Path("build/data-build/23/stock")
    assert parse_args(["--pref", "24", "--out", "x"]).out == Path("x")
    with pytest.raises(SystemExit):
        parse_args(["--pref", "99"])


def test_parse_housing_estat_csv():
    h = parse_housing_estat_csv(FIX / "housing_estat.csv")
    assert set(h) == {"岐阜県", "岐阜市", "愛知県", "名古屋市", "豊橋市"}
    assert h["名古屋市"] == {
        "wood:pre1981": 500, "wood:y1981_2000": 600, "wood:post2000": 700,
        "rc:pre1981": 80, "rc:y1981_2000": 90, "rc:post2000": 100,
        "steel:pre1981": 10, "steel:y1981_2000": 20, "steel:post2000": 30,
    }
    assert h["豊橋市"]["wood:y1981_2000"] == 0  # "-" は 0
    assert h["豊橋市"]["rc:pre1981"] == 0
    assert all(isinstance(v, float) for v in h["岐阜市"].values())


def test_parse_housing_estat_csv_duplicate_name_raises(tmp_path):
    p = tmp_path / "h.csv"
    lines = (FIX / "housing_estat.csv").read_text(encoding="utf-8").splitlines()
    p.write_text("\n".join(lines + [lines[2]]) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="岐阜市"):
        parse_housing_estat_csv(p)


def test_parse_housing_estat_csv_scoped_to_prefecture_block(tmp_path):
    """同名の町村が別の県にある（愛知県美浜町・和歌山県美浜町）。pref を渡すとその県のブロックだけを読む。"""
    p = tmp_path / "h.csv"
    lines = (FIX / "housing_estat.csv").read_text(encoding="utf-8").splitlines()
    p.write_text("\n".join(lines + ["美浜町,1,2,3,4,5,6,7,8,9", "和歌山県,10,20,30,40,50,60,70,80,90", "和歌山市,1,1,1,1,1,1,1,1,1"]) + "\n", encoding="utf-8")
    w = parse_housing_estat_csv(p, "和歌山県")
    assert set(w) == {"和歌山県", "和歌山市"}
    a = parse_housing_estat_csv(p, "愛知県")
    assert set(a) == {"愛知県", "名古屋市", "豊橋市", "美浜町"}
    with pytest.raises(ValueError, match="三重県"):
        parse_housing_estat_csv(p, "三重県")
    # 同じ県のブロックの中の重複は誤り。別の県なら同名でもよい
    p.write_text("\n".join(lines + ["美浜町,1,2,3,4,5,6,7,8,9", "和歌山県,10,20,30,40,50,60,70,80,90", "美浜町,1,1,1,1,1,1,1,1,1"]) + "\n", encoding="utf-8")
    assert parse_housing_estat_csv(p, "和歌山県")["美浜町"]["wood:pre1981"] == 1
    assert parse_housing_estat_csv(p, "愛知県")["美浜町"]["wood:pre1981"] == 1 and parse_housing_estat_csv(p, "愛知県")["美浜町"]["wood:post2000"] == 3


def test_parse_housing_estat_csv_bad_header_raises(tmp_path):
    p = tmp_path / "h.csv"
    p.write_text("name,a,b\n岐阜県,1,2\n", encoding="utf-8")
    with pytest.raises(ValueError):
        parse_housing_estat_csv(p)


@pytest.mark.parametrize(
    "raw,want",
    [
        ("名古屋市千種区", "名古屋市"),
        ("静岡市葵区", "静岡市"),
        ("浜松市中区", "浜松市"),
        ("菰野町", "菰野町"),
        ("四日市市", "四日市市"),
        ("津市", "津市"),
    ],
)
def test_municipality_name_strips_designated_city_ward(raw, want):
    assert municipality_name(raw) == want


def make_aichi_inputs(tmp_path):
    """愛知県（23）の合成入力: 名古屋市の2区を1市にまとめ、豊橋市は住宅統計あり、架空町は県計で代用。"""
    raw = tmp_path / "raw"
    (raw / "census_mesh").mkdir(parents=True)
    (raw / "boundary").mkdir()
    hh = {(0, 0): 10, (1, 0): 30, (2, 0): 20, (3, 0): 40, (4, 0): 5}
    lines = ["KEY_CODE,HTKSYORI,HTKSAKI,GASSAN,T001142001,T001142002", ",,,,　人口（総数）,　世帯総数"]
    for (k, row), v in hh.items():
        lines.append(f"{mesh_at(k, row)},0,,,10,{v}")
    (raw / "census_mesh" / "tblT001142Q5236.txt").write_bytes(("\n".join(lines) + "\n").encode("cp932"))
    x = [LON0 - 0.5 / 320 + i / 320 for i in range(6)]
    g = gpd.GeoDataFrame(
        {
            "KEY_CODE": ["1", "2", "3", "4"],
            "CITY_NAME": ["名古屋市千種区", "名古屋市東区", "豊橋市", "架空町"],
            "geometry": [
                box(x[0], 35.015, x[1], 35.025),
                box(x[1], 35.015, x[2], 35.025),
                box(x[2], 35.015, x[4], 35.025),
                box(x[4], 35.015, x[5], 35.025),
            ],
        },
        crs="EPSG:6668",
    )
    g.to_file(raw / "boundary" / "b.shp")
    kotei = tmp_path / "k.xlsx"
    make_kotei(
        kotei,
        [("愛知県", "名古屋市", 300, 100), ("愛知県", "豊橋市", 60, 30), ("愛知県", "架空町", 8, 2), ("三重県", "菰野町", 1, 1)],
    )
    return raw / "census_mesh", raw / "boundary" / "b.shp", FIX / "housing_estat.csv", kotei


def test_build_stock_aichi_wards_merged_and_fallback(tmp_path):
    c, b, h, k = make_aichi_inputs(tmp_path)
    out = tmp_path / "out"
    r = build_stock_full(c, b, h, k, out, pref="23")
    assert r.totals == {"名古屋市": 400, "豊橋市": 90, "架空町": 10}
    mm = json.loads((out / "municipality_meshes.json").read_text(encoding="utf-8"))
    assert set(mm) == {"名古屋市", "豊橋市", "架空町"}  # 区は市にまとめる
    assert set(mm["名古屋市"]) == {mesh_at(0), mesh_at(1)}
    meshes = load_all(out)
    assert meshes[mesh_at(0)]["total"] == pytest.approx(400 * 10 / 40)
    assert r.fallback == ["架空町"]
    assert "架空町" in r.notes and "愛知県" in r.notes
    pref = parse_housing_estat_csv(h)["愛知県"]
    wood_total = sum(v for key, v in pref.items() if key.startswith("wood"))
    assert meshes[mesh_at(4)]["shares"]["wood:pre1981"] == pytest.approx(0.8 * pref["wood:pre1981"] / wood_total)
    nagoya = parse_housing_estat_csv(h)["名古屋市"]
    nw = sum(v for key, v in nagoya.items() if key.startswith("wood"))
    assert meshes[mesh_at(0)]["shares"]["wood:post2000"] == pytest.approx(0.75 * nagoya["wood:post2000"] / nw)


def test_build_stock_default_pref_is_mie(tmp_path):
    c, b, h, k = make_inputs(tmp_path, HH)
    a = build_stock_full(c, b, h, k, tmp_path / "a")
    bb = build_stock_full(c, b, h, k, tmp_path / "b", pref="24")
    assert a.totals == bb.totals
    assert load_all(tmp_path / "a") == load_all(tmp_path / "b")


@needs_raw
def test_parse_housing_estat_real_has_tokai_prefs():
    f = RAW / "housing" / "estat_r5_6-3-2_tokai_raw.csv"
    if not f.exists():
        pytest.skip("e-Stat 表6-3-2 がない")
    h = parse_housing_estat_csv(f)
    for name in ("岐阜県", "静岡県", "愛知県", "名古屋市", "静岡市", "浜松市", "岐阜市"):
        assert name in h
    assert not any(n.endswith("区") for n in h)


@needs_raw
def test_parse_housing_estat_real_has_wakayama():
    f = RAW / "housing" / "estat_r5_6-3-2_tokai_raw.csv"
    if not f.exists():
        pytest.skip("e-Stat 表6-3-2 がない")
    h = parse_housing_estat_csv(f)
    assert "和歌山県" in h and "和歌山市" in h
    # 白浜町は表の2001年以降が 0 の行だったため入れていない（県計の割合で代用する）
    assert "白浜町" not in h


@needs_raw
def test_build_stock_wakayama_real(tmp_path):
    """和歌山県（30）の建物が作れる: 固定資産の棟数を保存し、白浜町は県計割合で代用。"""
    p = pref_inputs("30", RAW)
    for f in (p.boundary, p.housing):
        if not f.exists():
            pytest.skip(f"{f} がない")
    kotei = RAW / "kotei" / "kotei_r06_soukatsu.xlsx"
    r = build_stock_full(RAW / "census_mesh", p.boundary, p.housing, kotei, tmp_path / "stock", pref="30")
    counts = parse_kotei(kotei, "和歌山県")
    assert len(counts) == 30 and set(r.totals) == set(counts)
    for name, (w, n) in counts.items():
        assert r.allocated[name] == pytest.approx(w + n, abs=0.5), name
    assert "白浜町" in r.fallback
    # 表6-3-2 の「美浜町」は愛知県の美浜町。和歌山県の美浜町に使わない（県のブロックの中だけで引く）
    assert "美浜町" in r.fallback
    assert "和歌山市" not in r.fallback
    mm = json.loads((tmp_path / "stock" / "municipality_meshes.json").read_text(encoding="utf-8"))
    assert latlon_to_mesh250(34.2306, 135.1708) in mm["和歌山市"]  # 和歌山市役所


def test_pref_inputs_parse_housing_is_bound_to_the_prefecture(tmp_path):
    """PrefInputs.parse_housing は県のブロックだけを読む（別の県の同名町村、美浜町を混ぜない。review M-3）。"""
    lines = (FIX / "housing_estat.csv").read_text(encoding="utf-8").splitlines()
    (tmp_path / "housing").mkdir()
    (tmp_path / "housing" / "estat_r5_6-3-2_tokai_raw.csv").write_text(
        "\n".join(lines + ["美浜町,1,2,3,4,5,6,7,8,9", "和歌山県,10,20,30,40,50,60,70,80,90", "和歌山市,1,1,1,1,1,1,1,1,1"]) + "\n", encoding="utf-8")
    w = pref_inputs("30", tmp_path)
    assert set(w.parse_housing(w.housing)) == {"和歌山県", "和歌山市"}
    a = pref_inputs("23", tmp_path)
    assert "美浜町" in a.parse_housing(a.housing)
