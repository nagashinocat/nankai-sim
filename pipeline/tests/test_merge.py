import json

import pytest

from pipeline.merge import merge_build, merge_mesh_dirs


def put(d, name, obj):
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def read(p):
    return json.loads(p.read_text(encoding="utf-8"))


ST = lambda t: {"total": t, "shares": {"wood:pre1981": 1.0}}  # noqa: E731


def two_prefs(tmp_path):
    a, b = tmp_path / "24", tmp_path / "23"
    # 県境の2次メッシュ 523656 は両方の県にある（別々の 250m メッシュ）
    put(a, "523656.json", {"5236560011": ST(1.5), "5236560012": ST(2.0)})
    put(a, "523645.json", {"5236450011": ST(3.0)})
    put(a, "municipality_meshes.json", {"木曽岬町": ["5236560011", "5236560012"], "桑名市": ["5236450011"]})
    put(b, "523656.json", {"5236560021": ST(4.0)})
    put(b, "523657.json", {"5236570011": ST(5.0)})
    put(b, "municipality_meshes.json", {"弥富市": ["5236560021"], "名古屋市": ["5236570011"]})
    return a, b


def test_union_of_mesh_files_and_municipalities(tmp_path):
    a, b = two_prefs(tmp_path)
    dst = tmp_path / "dst"
    n = merge_mesh_dirs([a, b], dst)
    assert n == 5
    assert read(dst / "523656.json") == {"5236560011": ST(1.5), "5236560012": ST(2.0), "5236560021": ST(4.0)}
    assert read(dst / "523657.json") == {"5236570011": ST(5.0)}
    mm = read(dst / "municipality_meshes.json")
    assert set(mm) == {"木曽岬町", "桑名市", "弥富市", "名古屋市"}
    assert mm["弥富市"] == ["5236560021"]


def test_result_independent_of_order(tmp_path):
    a, b = two_prefs(tmp_path)
    merge_mesh_dirs([a, b], tmp_path / "ab")
    merge_mesh_dirs([b, a], tmp_path / "ba")
    names = sorted(p.name for p in (tmp_path / "ab").iterdir())
    assert names == sorted(p.name for p in (tmp_path / "ba").iterdir())
    for name in names:
        assert (tmp_path / "ab" / name).read_bytes() == (tmp_path / "ba" / name).read_bytes()


def test_same_mesh_same_value_ok(tmp_path):
    a, b = two_prefs(tmp_path)
    put(b, "523645.json", {"5236450011": ST(3.0)})
    merge_mesh_dirs([a, b], tmp_path / "dst")
    assert read(tmp_path / "dst" / "523645.json") == {"5236450011": ST(3.0)}


def test_same_mesh_different_value_raises(tmp_path):
    a, b = two_prefs(tmp_path)
    put(b, "523656.json", {"5236560021": ST(4.0), "5236560011": ST(1.6)})
    with pytest.raises(ValueError, match="5236560011"):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_municipality_name_collision_raises(tmp_path):
    a, b = two_prefs(tmp_path)
    put(b, "municipality_meshes.json", {"弥富市": ["5236560021"], "桑名市": ["5236570011"]})
    with pytest.raises(ValueError, match="桑名市"):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_mesh_in_two_municipalities_raises(tmp_path):
    a, b = two_prefs(tmp_path)
    put(b, "municipality_meshes.json", {"弥富市": ["5236560021", "5236560011"], "名古屋市": ["5236570011"]})
    with pytest.raises(ValueError, match="5236560011"):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_index_json_union(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    put(a, "523656.json", {"5236560011": [6.0, None, None, None, None]})
    put(a, "index.json", ["523656"])
    put(b, "533600.json", {"5336000011": [5.0, None, None, None, None]})
    put(b, "index.json", ["533600"])
    merge_mesh_dirs([b, a], tmp_path / "dst")
    assert read(tmp_path / "dst" / "index.json") == ["523656", "533600"]
    assert not (tmp_path / "dst" / "municipality_meshes.json").exists()


def test_index_must_match_written_files(tmp_path):
    a = tmp_path / "a"
    put(a, "523656.json", {"5236560011": [6.0, None, None, None, None]})
    put(a, "index.json", ["523656", "999999"])
    with pytest.raises(ValueError, match="999999"):
        merge_mesh_dirs([a], tmp_path / "dst")


def shelter(i, lat=35.05):
    return {"id": i, "name": f"場所{i}", "pos": {"lat": lat, "lon": 136.78}, "earthquake": True, "tsunami": False}


def test_shelter_lists_merged_by_id(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    put(a, "523656.json", [shelter("B2"), shelter("B1")])
    put(b, "523656.json", [shelter("B1"), shelter("C1")])
    n = merge_mesh_dirs([a, b], tmp_path / "dst")
    assert n == 3
    assert [s["id"] for s in read(tmp_path / "dst" / "523656.json")] == ["B1", "B2", "C1"]


def test_shelter_same_id_different_content_raises(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    put(a, "523656.json", [shelter("B1")])
    put(b, "523656.json", [shelter("B1", lat=35.06)])
    with pytest.raises(ValueError, match="B1"):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_list_and_dict_mixed_raises(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    put(a, "523656.json", [shelter("B1")])
    put(b, "523656.json", {"5236560011": ST(1.0)})
    with pytest.raises(ValueError):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_stale_files_removed_others_kept(tmp_path):
    a, _ = two_prefs(tmp_path)
    dst = tmp_path / "dst"
    put(dst, "999999.json", {"x": 1})
    (dst / "keep.txt").write_text("x")
    merge_mesh_dirs([a], dst)
    assert not (dst / "999999.json").exists()
    assert (dst / "keep.txt").exists()


def test_missing_src_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        merge_mesh_dirs([tmp_path / "nope"], tmp_path / "dst")


def test_merge_build_merges_each_kind(tmp_path):
    a, b = tmp_path / "build" / "24", tmp_path / "build" / "23"
    put(a / "stock", "523656.json", {"5236560011": ST(1.5)})
    put(a / "stock", "municipality_meshes.json", {"木曽岬町": ["5236560011"]})
    put(b / "stock", "523656.json", {"5236560021": ST(4.0)})
    put(b / "stock", "municipality_meshes.json", {"弥富市": ["5236560021"]})
    put(a / "shelters", "523656.json", [shelter("B1")])
    put(b / "shelters", "523656.json", [shelter("C1")])
    dst = tmp_path / "data"
    counts = merge_build([a, b], dst)
    assert counts == {"stock": 2, "shelters": 2}
    assert set(read(dst / "stock" / "municipality_meshes.json")) == {"木曽岬町", "弥富市"}
    assert len(read(dst / "shelters" / "523656.json")) == 2


# --- 県境のメッシュ: 2県が同じ 250m メッシュを割り当てたとき（Ruling: 中心を含む境界の県、両方なら小さい県コード） ---
from pipeline.merge import border_resolver  # noqa: E402


def contested(tmp_path):
    """5236560011 を 24（木曽岬町）と 23（弥富市）の両方が違う値で持つ。"""
    a, b = two_prefs(tmp_path)
    put(b, "523656.json", {"5236560021": ST(4.0), "5236560011": ST(9.0)})
    put(b, "municipality_meshes.json", {"弥富市": ["5236560011", "5236560021"], "名古屋市": ["5236570011"]})
    return a, b


def test_border_mesh_kept_by_prefecture_whose_boundary_contains_centre(tmp_path):
    a, b = contested(tmp_path)
    resolve = border_resolver(lambda pref, mesh: pref == "24")  # 中心は三重の境界の中だけ
    for order, dst in (([a, b], "ab"), ([b, a], "ba")):
        merge_mesh_dirs(order, tmp_path / dst, resolve=resolve)
        assert read(tmp_path / dst / "523656.json")["5236560011"] == ST(1.5)
        mm = read(tmp_path / dst / "municipality_meshes.json")
        assert mm["木曽岬町"] == ["5236560011", "5236560012"]
        assert mm["弥富市"] == ["5236560021"]
    for name in sorted(p.name for p in (tmp_path / "ab").iterdir()):
        assert (tmp_path / "ab" / name).read_bytes() == (tmp_path / "ba" / name).read_bytes()
    assert resolve.resolved == {"5236560011": "24"}
    assert resolve.overlap == []


def test_border_mesh_in_both_boundaries_goes_to_lower_code(tmp_path):
    a, b = contested(tmp_path)
    resolve = border_resolver(lambda pref, mesh: True)  # 境界が重なる
    merge_mesh_dirs([a, b], tmp_path / "dst", resolve=resolve)
    assert read(tmp_path / "dst" / "523656.json")["5236560011"] == ST(9.0)
    mm = read(tmp_path / "dst" / "municipality_meshes.json")
    assert mm["木曽岬町"] == ["5236560012"]
    assert mm["弥富市"] == ["5236560011", "5236560021"]
    assert resolve.overlap == ["5236560011"]


def test_border_mesh_in_neither_boundary_goes_to_lower_code(tmp_path):
    a, b = contested(tmp_path)
    resolve = border_resolver(lambda pref, mesh: False)
    merge_mesh_dirs([a, b], tmp_path / "dst", resolve=resolve)
    assert read(tmp_path / "dst" / "523656.json")["5236560011"] == ST(9.0)
    assert resolve.resolved == {"5236560011": "23"}


def test_without_resolver_border_conflict_still_raises(tmp_path):
    a, b = contested(tmp_path)
    with pytest.raises(ValueError):
        merge_mesh_dirs([a, b], tmp_path / "dst")


def test_resolver_does_not_touch_uncontested_or_list_files(tmp_path):
    a, b = two_prefs(tmp_path)
    resolve = border_resolver(lambda pref, mesh: pytest.fail("呼ばれないはず"))
    merge_mesh_dirs([a, b], tmp_path / "dst", resolve=resolve)
    assert resolve.resolved == {}
    s1, s2 = tmp_path / "s24", tmp_path / "s23"
    put(s1, "523656.json", [{"id": "x", "name": "A"}])
    put(s2, "523656.json", [{"id": "x", "name": "A"}])
    merge_mesh_dirs([s1, s2], tmp_path / "sdst", resolve=resolve)
    assert read(tmp_path / "sdst" / "523656.json") == [{"id": "x", "name": "A"}]


def test_merge_build_uses_resolver_for_stock(tmp_path):
    root = tmp_path / "build"
    a, b = root / "24" / "stock", root / "23" / "stock"
    put(a, "523656.json", {"5236560011": ST(1.5)})
    put(a, "municipality_meshes.json", {"木曽岬町": ["5236560011"]})
    put(b, "523656.json", {"5236560011": ST(9.0), "5236560021": ST(4.0)})
    put(b, "municipality_meshes.json", {"弥富市": ["5236560011", "5236560021"]})
    resolve = border_resolver(lambda pref, mesh: pref == "24")
    merge_build([root / "24", root / "23"], tmp_path / "data", resolve=resolve)
    assert read(tmp_path / "data" / "stock" / "523656.json")["5236560011"] == ST(1.5)
    assert resolve.resolved == {"5236560011": "24"}


def test_boundary_contains_reads_r2ka_shapefile(tmp_path):
    import geopandas as gpd
    from shapely.geometry import box

    from pipeline.building_stock import mesh_center
    from pipeline.merge import boundary_contains

    lat, lon = mesh_center("5236560011")
    gpd.GeoDataFrame({"CITY_NAME": ["架空町"]}, geometry=[box(lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01)], crs="EPSG:6668").to_file(tmp_path / "r2ka24.shp")
    contains = boundary_contains(tmp_path)
    assert contains("24", "5236560011") is True
    assert contains("24", "5236450011") is False
