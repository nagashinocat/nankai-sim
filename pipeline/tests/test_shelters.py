import json
from pathlib import Path

from pipeline.shelters import build_shelters

HEADER = "NO,共通ID,施設・場所名,住所,洪水,崖崩れ、土石流及び地滑り,高潮,地震,津波,大規模な火事,内水氾濫,火山現象,指定避難所との住所同一,緯度,経度,備考"


def write(tmp_path, rows):
    p = tmp_path / "s.csv"
    # UTF-8 BOM + CRLF（国土地理院の形式）
    p.write_bytes(("﻿" + "\r\n".join([HEADER] + rows) + "\r\n").encode("utf-8"))
    return p


def test_flags_split_and_drop(tmp_path, capsys):
    rows = [
        "1,A1,役場,三重県菰野町1,1,,,1,,1,,,1,35.0200,136.5072,",
        "2,A2,高台公園,三重県菰野町2,,,,,1,,,,0,35.0210,136.5080,",
        "3,A3,緯度なし,三重県菰野町3,,,,1,1,,,,0,,136.5,",
        "4,A4,別メッシュ,三重県四日市市,,,,1,1,,,,0,34.9,136.6,",
    ]
    out = tmp_path / "out"
    n = build_shelters(write(tmp_path, rows), out)
    assert n == 3
    assert "1" in capsys.readouterr().out  # 捨てた件数を表示
    files = sorted(p.name for p in out.glob("*.json"))
    assert len(files) == 2
    all_ = {s["id"]: s for f in out.glob("*.json") for s in json.loads(f.read_text(encoding="utf-8"))}
    assert set(all_) == {"A1", "A2", "A4"}
    assert all_["A1"] == {
        "id": "A1", "name": "役場", "pos": {"lat": 35.02, "lon": 136.5072},
        "earthquake": True, "tsunami": False,
    }
    assert all_["A2"]["tsunami"] is True and all_["A2"]["earthquake"] is False
    # 菰野町の2点は同じ2次メッシュのファイル
    same = [f for f in out.glob("*.json") if len(json.loads(f.read_text(encoding="utf-8"))) == 2]
    assert len(same) == 1
