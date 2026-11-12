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


# --- 複数 CSV・zip・重複 id ---
import zipfile

import pytest

from pipeline.shelters import parse_args, prefs_of


def write_named(tmp_path, name, rows):
    p = tmp_path / name
    p.write_bytes(("﻿" + "\r\n".join([HEADER] + rows) + "\r\n").encode("utf-8"))
    return p


def load(out):
    return {s["id"]: s for f in out.glob("??????.json") for s in json.loads(f.read_text(encoding="utf-8"))}


def test_several_csvs_and_duplicate_id_collapsed(tmp_path):
    a = write_named(tmp_path, "x_24000_2.csv", [
        "1,B1,県境の公園,三重県木曽岬町1,,,,1,1,,,,0,35.0500,136.7800,",
        "2,B2,役場,三重県木曽岬町2,,,,1,,,,,0,35.0510,136.7810,",
    ])
    b = write_named(tmp_path, "x_23000_2.csv", [
        "1,B1,県境の公園,三重県木曽岬町1,,,,1,1,,,,0,35.0500,136.7800,",  # 同じ id → 1件
        "2,C1,高台,愛知県弥富市1,,,,,1,,,,0,35.0700,136.7300,",
    ])
    out = tmp_path / "out"
    n = build_shelters([a, b], out)
    assert n == 3
    got = load(out)
    assert set(got) == {"B1", "B2", "C1"}
    assert sum(len(json.loads(f.read_text(encoding="utf-8"))) for f in out.glob("??????.json")) == 3


def test_single_path_still_accepted(tmp_path):
    a = write_named(tmp_path, "s.csv", ["1,A1,役場,x,,,,1,,,,,0,35.02,136.5072,"])
    assert build_shelters(a, tmp_path / "out") == 1


def test_zip_containing_csv(tmp_path):
    inner = write_named(tmp_path, "23000_2.csv", ["1,Z1,公園,x,,,,1,1,,,,0,35.1,136.9,"])
    z = tmp_path / "23000_2.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.write(inner, "23000_2.csv")
    inner.unlink()
    out = tmp_path / "out"
    assert build_shelters([z], out) == 1
    assert load(out)["Z1"]["tsunami"] is True


def test_zip_without_csv_raises(tmp_path):
    z = tmp_path / "e.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("readme.txt", "x")
    with pytest.raises(ValueError):
        build_shelters([z], tmp_path / "out")


def test_prefs_of_paths(tmp_path):
    assert prefs_of([Path("data/raw/shelters/gsi_hinanbasho_24000_2.csv"), Path("23000_2.zip")]) == ["23", "24"]
    with pytest.raises(ValueError):
        prefs_of([Path("unknown.csv")])


def test_cli_several_csv_and_default_mie():
    a = parse_args([])
    assert a.csv == [Path("data/raw/shelters/gsi_hinanbasho_24000_2.csv")]
    assert a.out == Path("build/data-build/24/shelters")
    assert parse_args(["--csv", "22000_2.zip"]).out == Path("build/data-build/22/shelters")
    b = parse_args(["--csv", "a_21000_2.csv", "22000_2.zip", "--out", "o"])
    assert b.csv == [Path("a_21000_2.csv"), Path("22000_2.zip")]
    assert b.out == Path("o")
    with pytest.raises(SystemExit):  # 複数の県をまとめて出すなら --out を指定
        parse_args(["--csv", "a_21000_2.csv", "22000_2.zip"])


# --- 国土地理院の最終更新日は県ごと（koukaidate.html、2026-11-12 確認） ---
from pipeline.shelters import SHELTER_UPDATED, main


def test_updated_date_per_prefecture():
    assert SHELTER_UPDATED == {"21": "2026-10-21", "22": "2026-10-27", "23": "2026-11-04", "24": "2026-11-06", "30": "2026-10-19"}
    assert parse_args(["--csv", "gsi_hinanbasho_30000_2.csv"]).updated == {"30": "2026-10-19"}
    assert parse_args(["--csv", "a_21000_2.csv", "22000_2.zip", "--out", "o"]).updated == {"21": "2026-10-21", "22": "2026-10-27"}
    # 1県のときだけ --updated で上書きできる
    assert parse_args(["--csv", "23000_2.csv", "--updated", "2027-01-01"]).updated == {"23": "2027-01-01"}
    with pytest.raises(SystemExit):
        parse_args(["--csv", "a_21000_2.csv", "22000_2.zip", "--out", "o", "--updated", "2027-01-01"])


def test_manifest_records_each_prefecture_date(tmp_path):
    hdr = "\ufeffNO,共通ID,施設・場所名,住所,洪水,崖崩れ、土石流及び地滑り,高潮,地震,津波,大規模な火事,内水氾濫,火山現象,指定避難所との住所同一,緯度,経度,備考\r\n"
    m = tmp_path / "m.json"
    for code, lat, lon in (("24", 34.07, 136.19), ("30", 33.72, 135.99)):
        c = tmp_path / f"x_{code}000_2.csv"
        c.write_text(hdr + f"1,E{code}1,場所,住所,,,,1,1,,,,,{lat},{lon},\r\n", encoding="utf-8")
        main(["--csv", str(c), "--out", str(tmp_path / code), "--manifest", str(m)])
    d = [x for x in json.loads(m.read_text(encoding="utf-8"))["datasets"] if x["id"] == "gsi-shelters"][0]
    assert d["prefNotes"] == {"24": "最終更新 2026-11-06。", "30": "最終更新 2026-10-19。"}
    assert "【三重県】最終更新 2026-11-06。【和歌山県】最終更新 2026-10-19。" in d["notes"]
    assert d["publishedDate"] == "県ごと（notes の【県名】最終更新）"
