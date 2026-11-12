"""三重県の出力が県コード対応の前後で変わらないこと（実データがある環境でのみ実行）。

基準: 県コード対応の前に public/data/{hazard,stock,shelters} をコピーしたもの
（既定 data/raw/baseline_mie_public_data。環境変数 MIE_BASELINE で変えられる）。
- 建物: --pref 24 で作り pipeline.merge で統合した結果が、全メッシュ・市町対応表とも一致。
- 避難場所: 同様に、2次メッシュごとの id の集合と内容が一致（統合後は id 順に並ぶ）。
- ハザード: 4県の抽出（tokai_*.csv.gz）から作り直し、基準にある全メッシュの値が一致（Ruling T6-a）。
"""
import json
import os
from pathlib import Path

import pytest

from pipeline.building_stock import build_stock_full, pref_inputs
from pipeline.merge import merge_build
from pipeline.naikaku_hazard import CASES, build_hazard
from pipeline.shelters import build_shelters

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
BASE = Path(os.environ.get("MIE_BASELINE", RAW / "baseline_mie_public_data"))
P24 = pref_inputs("24", RAW)
KOTEI = RAW / "kotei" / "kotei_r06_soukatsu.xlsx"
SHELTER_CSV = RAW / "shelters" / "gsi_hinanbasho_24000_2.csv"
TOKAI = RAW / "naikaku_tokai"

needs = [BASE / "stock", BASE / "shelters", BASE / "hazard", P24.boundary, P24.housing, KOTEI, SHELTER_CSV, RAW / "census_mesh"]
pytestmark = pytest.mark.skipif(
    not all(p.exists() for p in needs), reason="三重の基準コピーまたは実データがない"
)


def _read(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def merged(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("mie")
    build = tmp / "build" / "24"
    build_stock_full(RAW / "census_mesh", P24.boundary, P24.housing, KOTEI, build / "stock", "24")
    build_shelters([SHELTER_CSV], build / "shelters")
    merge_build([build], tmp / "data")
    return tmp / "data"


def test_stock_unchanged(merged):
    base, new = BASE / "stock", merged / "stock"
    assert sorted(p.name for p in new.glob("*.json")) == sorted(p.name for p in base.glob("*.json"))
    compared = differing = 0
    for f in base.glob("??????.json"):
        a, b = _read(f), _read(new / f.name)
        assert set(a) == set(b), f.name
        for k in a:
            compared += 1
            differing += a[k] != b[k]
    print(f"\n建物: {compared} メッシュを比較、違い {differing}")
    assert compared > 0 and differing == 0
    assert _read(new / "municipality_meshes.json") == _read(base / "municipality_meshes.json")


def test_shelters_unchanged(merged):
    base, new = BASE / "shelters", merged / "shelters"
    assert sorted(p.name for p in new.glob("*.json")) == sorted(p.name for p in base.glob("*.json"))
    compared = 0
    for f in base.glob("??????.json"):
        a, b = _read(f), _read(new / f.name)
        assert len(a) == len(b), f.name
        assert {s["id"]: s for s in a} == {s["id"]: s for s in b}, f.name
        compared += len(a)
    print(f"\n避難場所: {compared} 件を比較、違い 0")
    assert compared > 0


@pytest.mark.skipif(not TOKAI.exists(), reason="4県の内閣府抽出がない")
@pytest.mark.parametrize("case", [c for c in CASES if c != "L2_KIHON"])  # 基準に無いケース（T7 で追加）は除く
def test_hazard_unchanged_from_tokai_extract(tmp_path, case):
    suffix = CASES[case]
    build_hazard([TOKAI / f"tokai_Eq_{suffix}.csv.gz"], [TOKAI / f"tokai_Liq_{suffix}.csv.gz"], case, tmp_path)
    base, new = BASE / "hazard" / case, tmp_path / case
    compared = differing = 0
    for f in base.glob("??????.json"):
        a = _read(f)
        b = _read(new / f.name) if (new / f.name).exists() else {}
        for k, v in a.items():
            compared += 1
            differing += b.get(k) != v
    assert set(_read(base / "index.json")) <= set(_read(new / "index.json"))
    print(f"\nハザード {case}: {compared} メッシュを比較、違い {differing}")
    assert compared > 0 and differing == 0
