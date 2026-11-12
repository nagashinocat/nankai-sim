import json

import pytest

from pipeline.tsunami_arrival import build_arrival

HEADER = "muni_code,muni_name,m030,m100,m300,m500,m1000"


def write(tmp_path, name, rows):
    p = tmp_path / name
    p.write_text("\n".join([HEADER] + rows) + "\n", encoding="utf-8")
    return p


def names(tmp_path, ns):
    p = tmp_path / "names.json"
    p.write_text(json.dumps({n: [] for n in ns}, ensure_ascii=False), encoding="utf-8")
    return p


def test_two_csvs_blank_is_null(tmp_path):
    a = write(tmp_path, "a.csv", ["24209,尾鷲市,3,3,5,7,14", "24343,朝日町,,,,,"])
    b = write(tmp_path, "b.csv", ["22203,沼津市,12,30,,,"])
    out = tmp_path / "o.json"
    n = build_arrival([a, b], out, names_path=names(tmp_path, ["尾鷲市", "朝日町", "沼津市"]), manifest=None)
    assert n == 3
    assert json.loads(out.read_text(encoding="utf-8")) == {
        "尾鷲市": {"min": 3, "cm": 30}, "朝日町": {"min": None, "cm": 30}, "沼津市": {"min": 12, "cm": 30}}


def test_duplicate_code_raises(tmp_path):
    a = write(tmp_path, "a.csv", ["24209,尾鷲市,3,3,5,7,14"])
    b = write(tmp_path, "b.csv", ["24209,尾鷲市,4,3,5,7,14"])
    with pytest.raises(ValueError):
        build_arrival([a, b], tmp_path / "o.json", names_path=names(tmp_path, ["尾鷲市"]), manifest=None)


def test_name_collision_across_files_raises(tmp_path):
    a = write(tmp_path, "a.csv", ["24100,府中市,3,3,,,"])
    b = write(tmp_path, "b.csv", ["22100,府中市,4,3,,,"])
    with pytest.raises(ValueError):
        build_arrival([a, b], tmp_path / "o.json", names_path=names(tmp_path, ["府中市"]), manifest=None)


def test_unknown_name_raises(tmp_path):
    a = write(tmp_path, "a.csv", ["24209,尾鷲巿,3,3,5,7,14"])
    with pytest.raises(ValueError):
        build_arrival([a], tmp_path / "o.json", names_path=names(tmp_path, ["尾鷲市"]), manifest=None)


def test_bad_value_raises(tmp_path):
    a = write(tmp_path, "a.csv", ["24209,尾鷲市,abc,3,5,7,14"])
    with pytest.raises(ValueError):
        build_arrival([a], tmp_path / "o.json", names_path=names(tmp_path, ["尾鷲市"]), manifest=None)


def test_real_csv_values():
    from pathlib import Path

    out = Path("/tmp/_arrival_test.json")
    build_arrival([Path("data/published/mie_tsunami_arrival.csv")], out, manifest=None)
    d = json.loads(out.read_text(encoding="utf-8"))
    assert d["尾鷲市"] == {"min": 3, "cm": 30} and d["四日市市"] == {"min": 15, "cm": 30} and d["朝日町"] == {"min": None, "cm": 30}


def test_m050_column_records_50cm(tmp_path):
    # 静岡県は +50cm が公表されている最も低い高さ（Ruling T7-c）。高い方の列は無くてよい。
    p = tmp_path / "s.csv"
    p.write_text("muni_code,muni_name,m050\n22205,熱海市,24\n22100,静岡市,\n", encoding="utf-8")
    m = tmp_path / "m.csv"
    m.write_text("muni_code,muni_name,m030\n24209,尾鷲市,3\n", encoding="utf-8")
    out = tmp_path / "o.json"
    build_arrival([m, p], out, names_path=names(tmp_path, ["熱海市", "静岡市", "尾鷲市"]), manifest=None)
    assert json.loads(out.read_text(encoding="utf-8")) == {
        "尾鷲市": {"min": 3, "cm": 30}, "熱海市": {"min": 24, "cm": 50}, "静岡市": {"min": None, "cm": 50}}


def test_needs_one_lowest_height_column(tmp_path):
    both = tmp_path / "b.csv"
    both.write_text("muni_code,muni_name,m030,m050\n24209,尾鷲市,3,4\n", encoding="utf-8")
    neither = tmp_path / "n.csv"
    neither.write_text("muni_code,muni_name,m300\n24209,尾鷲市,3\n", encoding="utf-8")
    for p in (both, neither):
        with pytest.raises(ValueError):
            build_arrival([p], tmp_path / "o.json", names_path=names(tmp_path, ["尾鷲市"]), manifest=None)


def test_optional_height_columns_still_validated(tmp_path):
    p = tmp_path / "s.csv"
    p.write_text("muni_code,muni_name,m050,m300\n22205,熱海市,24,x\n", encoding="utf-8")
    with pytest.raises(ValueError):
        build_arrival([p], tmp_path / "o.json", names_path=names(tmp_path, ["熱海市"]), manifest=None)


def test_manifest_entries_per_source_csv():
    from pathlib import Path

    from pipeline.tsunami_arrival import datasets_for

    ds = datasets_for([Path("data/published/mie_tsunami_arrival.csv"), Path("x/shizuoka_tsunami_arrival.csv"), Path("aichi_tsunami_arrival.csv")])
    assert [d["id"] for d in ds] == ["tsunami-arrival", "tsunami-arrival-22", "tsunami-arrival-23"]
    assert all(d["url"].startswith("https://") and d["processedDate"] for d in ds)
    assert "50cm" in ds[1]["notes"] and "30cm" in ds[2]["notes"]
    assert ds[1]["publishedDate"] == "2013-06-27"  # 静岡県 第4次地震被害想定（第一次報告）平成25年6月27日
    with pytest.raises(ValueError):
        datasets_for([Path("tokyo_tsunami_arrival.csv")])


def test_m100_only_records_100cm(tmp_path):
    # 和歌山県は +1m が公表されている最も低い高さ（Ruling W-b）
    p = tmp_path / "w.csv"
    p.write_text("muni_code,muni_name,m100\n30207,新宮市,5\n30428,串本町,1\n", encoding="utf-8")
    out = tmp_path / "o.json"
    build_arrival([p], out, names_path=names(tmp_path, ["新宮市", "串本町"]), manifest=None)
    assert json.loads(out.read_text(encoding="utf-8")) == {"新宮市": {"min": 5, "cm": 100}, "串本町": {"min": 1, "cm": 100}}


def test_m100_is_not_lowest_when_m030_present(tmp_path):
    # 三重県の CSV は m030 と m100 を持つ。最も低いのは m030
    p = tmp_path / "m.csv"
    p.write_text("muni_code,muni_name,m030,m100\n24209,尾鷲市,3,5\n", encoding="utf-8")
    out = tmp_path / "o.json"
    build_arrival([p], out, names_path=names(tmp_path, ["尾鷲市"]), manifest=None)
    assert json.loads(out.read_text(encoding="utf-8")) == {"尾鷲市": {"min": 3, "cm": 30}}


def test_wakayama_manifest_entry():
    from pathlib import Path

    from pipeline.tsunami_arrival import datasets_for

    [d] = datasets_for([Path("data/published/wakayama_tsunami_arrival.csv")])
    assert d["id"] == "tsunami-arrival-30"
    assert "1m" in d["notes"] and "串本町" in d["notes"]
    assert d["url"] == "https://www.pref.wakayama.lg.jp/prefg/011400/bousai/shinsui/r8sinsui_d/fil/03_jishindoutsunami.pdf"


def test_real_wakayama_csv_values(tmp_path):
    from pathlib import Path

    out = tmp_path / "o.json"
    build_arrival([Path("data/published/wakayama_tsunami_arrival.csv")], out, manifest=None)
    d = json.loads(out.read_text(encoding="utf-8"))
    assert len(d) == 18
    assert d["新宮市"] == {"min": 5, "cm": 100} and d["串本町"] == {"min": 1, "cm": 100} and d["和歌山市"] == {"min": 45, "cm": 100}


def test_name_qualified_with_prefecture_when_merged_names_are(tmp_path):
    # 統合で県名付きになった同名の町村（愛知県美浜町・和歌山県美浜町）は、市町村コードの県で引く
    a = tmp_path / "a.csv"
    a.write_text("muni_code,muni_name,m030\n23446,美浜町,30\n", encoding="utf-8")
    w = tmp_path / "w.csv"
    w.write_text("muni_code,muni_name,m100\n30381,美浜町,16\n", encoding="utf-8")
    out = tmp_path / "o.json"
    build_arrival([a, w], out, names_path=names(tmp_path, ["愛知県美浜町", "和歌山県美浜町"]), manifest=None)
    assert json.loads(out.read_text(encoding="utf-8")) == {
        "愛知県美浜町": {"min": 30, "cm": 30}, "和歌山県美浜町": {"min": 16, "cm": 100}}


def test_wakayama_note_says_offshore_not_shoreline():
    """和歌山県の表の時間は海岸線の約30m沖の地点への到達。「汀線に着く」と同時に書かない（review M-2）。"""
    from pathlib import Path

    from pipeline.tsunami_arrival import datasets_for

    [w] = datasets_for([Path("wakayama_tsunami_arrival.csv")])
    assert "約30m沖" in w["notes"]
    assert "汀線" not in w["notes"]
    [m] = datasets_for([Path("mie_tsunami_arrival.csv")])
    assert "汀線" in m["notes"]
