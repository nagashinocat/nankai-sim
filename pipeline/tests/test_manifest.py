import json

import pytest

from pipeline.manifest import update_manifest, update_manifest_pref
from pipeline.prefs import pref_label

DS = {
    "id": "x",
    "name": "データ（{prefs}）",
    "source": "境界（r2ka{codes}）",
    "notes": "共通の注記。",
}


def entries(p):
    return json.loads(p.read_text(encoding="utf-8"))["datasets"]


def test_pref_label_order_and_unknown():
    assert pref_label(["24", "21", "23", "22"]) == "静岡県・愛知県・岐阜県・三重県"
    assert pref_label(["24"]) == "三重県"
    with pytest.raises(ValueError):
        pref_label(["13"])


def test_update_manifest_pref_single_pref(tmp_path):
    p = tmp_path / "m.json"
    update_manifest_pref(p, DS, "24", "代用: 朝日町。")
    [d] = entries(p)
    assert d["name"] == "データ（三重県）"
    assert d["source"] == "境界（r2ka24）"
    assert d["notes"] == "共通の注記。【三重県】代用: 朝日町。"
    assert d["prefs"] == ["24"]


def test_update_manifest_pref_accumulates_and_replaces(tmp_path):
    p = tmp_path / "m.json"
    update_manifest(p, {"id": "other", "notes": "keep"})
    update_manifest_pref(p, DS, "24", "三重の注記。")
    update_manifest_pref(p, DS, "23", "愛知の注記。")
    update_manifest_pref(p, DS, "24", "三重の新しい注記。")  # 同じ県を再実行すると置き換え
    update_manifest_pref(p, DS, "22")  # 県別注記なし
    other, d = entries(p)
    assert other == {"id": "other", "notes": "keep"}
    assert d["name"] == "データ（静岡県・愛知県・三重県）"
    assert d["source"] == "境界（r2ka22・23・24）"
    assert d["notes"] == "共通の注記。【愛知県】愛知の注記。【三重県】三重の新しい注記。"
    assert d["prefs"] == ["22", "23", "24"]


def test_update_manifest_pref_unknown_code(tmp_path):
    with pytest.raises(ValueError):
        update_manifest_pref(tmp_path / "m.json", DS, "13")
