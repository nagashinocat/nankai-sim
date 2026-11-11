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
    assert sorted(p.name for p in d.glob("*.json")) == ["513600.json", "523644.json"]


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
