"""建物ストックの加工。

国勢調査メッシュ（世帯総数）+ 小地域境界 + 住宅・土地統計（構造×建築時期）+
固定資産概要調書（市町の棟数）→ メッシュ別の建物棟数と構造×年代の割合。

県ごとに実行する（--pref 21/22/23/24/30）。出力は既定で build/data-build/<pref>/stock/。
5県分を pipeline.merge で public/data/stock/ に統合する。

出力: {out_dir}/{mesh2}.json = {"<mesh250>": {"total": 棟数, "shares": {"wood:pre1981": ..}}}
      {out_dir}/municipality_meshes.json = {市町名: [mesh250, ...]}
"""
import argparse
import csv
import functools
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

import geopandas as gpd
import pandas as pd

from pipeline.manifest import update_manifest, update_manifest_pref
from pipeline.prefs import PREFS

PREF = PREFS["24"]  # parse_housing_6_3（三重県の第6-3表）の県計ブロック名
ESTAT_HOUSING = "estat_r5_6-3-2_tokai_raw.csv"
ERAS = ("pre1981", "y1981_2000", "post2000")
STRUCTS = ("wood", "rc", "steel")
KEYS = [f"{s}:{e}" for s in STRUCTS for e in ERAS]

# --- 5次メッシュ（250m）: src/core/mesh.ts の移植 ---
_LAT_UNITS = 480
_LON_UNITS = 320
_LON_BASE = 100
_EPS = 1e-7


def mesh_center(code: str) -> tuple[float, float]:
    """250m メッシュコード → 中心 (lat, lon)"""
    if not re.fullmatch(r"\d{10}", code):
        raise ValueError(f"invalid mesh code: {code}")
    n = lambda i, ln=1: int(code[i : i + ln])  # noqa: E731
    p, u, q, v, r, w = n(0, 2), n(2, 2), n(4), n(5), n(6), n(7)
    d4, d5 = n(8) - 1, n(9) - 1
    lat_idx = p * 320 + q * 40 + r * 4 + (d4 >> 1) * 2 + (d5 >> 1)
    lon_idx = u * 320 + v * 40 + w * 4 + (d4 & 1) * 2 + (d5 & 1)
    return (lat_idx + 0.5) / _LAT_UNITS, _LON_BASE + (lon_idx + 0.5) / _LON_UNITS


def latlon_to_mesh250(lat: float, lon: float) -> str:
    import math

    lat_idx = math.floor(lat * _LAT_UNITS + _EPS)
    lon_idx = math.floor((lon - _LON_BASE) * _LON_UNITS + _EPS)
    p, u = lat_idx // 320, lon_idx // 320
    lat_r, lon_r = lat_idx % 320, lon_idx % 320
    q, v = lat_r // 40, lon_r // 40
    r, w = (lat_r % 40) // 4, (lon_r % 40) // 4
    la, lo = lat_r % 4, lon_r % 4
    d4 = (la // 2) * 2 + (lo // 2) + 1
    d5 = (la % 2) * 2 + (lo % 2) + 1
    return f"{p}{u}{q}{v}{r}{w}{d4}{d5}"


# --- 住宅・土地統計 ---
_SECTION = re.compile(r"^\s*第(\d+(?:-\d+)?)表")
_BLOCK_HEAD = re.compile(r"^\s*(\d{2,3})\s+([^\d,\s][^\d,]*?)\s*$")
_YEAR = re.compile(r"(?<!\d)(\d{4})年")
_NUM = re.compile(r"^(?:\d{1,3}(?:,\d{3})*|\d+|-)$")


def _num(tok: str) -> float:
    return 0.0 if tok == "-" else float(tok.replace(",", ""))


def _era(start_year: int) -> str:
    if start_year <= 1980:
        return "pre1981"
    if start_year <= 2000:
        return "y1981_2000"
    return "post2000"


def _empty() -> dict[str, float]:
    return {k: 0.0 for k in KEYS}


def parse_housing_6_3(txt: Path) -> dict[str, dict[str, float]]:
    """第6-3表（市町、建築時期7区分）と第6-1表の県計ブロックを読む。

    戻り値: 市町名 → {"wood:pre1981": 住宅数, ...}。県計は "三重県"。
    構造は 木造・鉄筋鉄骨コンクリート造・鉄骨造（その他は除外）。
    列: 6-3 = 総数,専用,併用,木造,非木造,RC,鉄骨,その他 / 6-1 = 総数,木造,非木造,RC,鉄骨,その他。
    """
    out: dict[str, dict[str, float]] = {}
    section = None
    current = None
    for line in Path(txt).read_text(encoding="utf-8").splitlines():
        m = _SECTION.match(line)
        if m:
            section = m.group(1)
            current = None
            continue
        if section not in ("6-3", "6-1"):
            continue
        m = _BLOCK_HEAD.match(line)
        if m and "住宅総数" not in line:
            name = re.sub(r"\s+", "", m.group(2))
            if section == "6-3" and len(m.group(1)) == 3:
                current = out.setdefault(name, _empty())
            elif section == "6-1" and m.group(1) == "24" and name == PREF:
                current = out.setdefault(PREF, _empty())
            else:
                current = None
            continue
        if current is None:
            continue
        if re.match(r"^\s*(専用住宅|店舗)", line):
            current = None  # 6-1 の県計ブロックはここまで
            continue
        y = _YEAR.search(line)
        if not y:
            continue  # 住宅総数・不詳など
        toks = line.split()
        nums = []
        for t in reversed(toks):
            if not _NUM.match(t):
                break
            nums.append(t)
        nums.reverse()
        # ラベル末尾の数字と数値列が連結していない前提（逆走査で数値トークンのみ採る）
        want = 8 if section == "6-3" else 6
        if len(nums) < want:
            raise ValueError(f"数値列が足りない（{section}）: {line!r}")
        v = [_num(t) for t in nums[-want:]]
        wood, rc, steel = (v[3], v[5], v[6]) if section == "6-3" else (v[1], v[3], v[4])
        era = _era(int(y.group(1)))
        current[f"wood:{era}"] += wood
        current[f"rc:{era}"] += rc
        current[f"steel:{era}"] += steel
    return out


_ESTAT_COLS = ["name"] + [f"{s}_{e.removeprefix('y')}" for s in STRUCTS for e in ERAS]


def _is_pref_row(name: str) -> bool:
    """表6-3-2 の県計の行（「〇〇県」など）。市町村名が都・道・府・県で終わることはない。"""
    return name.endswith(("都", "道", "府", "県"))


def parse_housing_estat_csv(path: Path, pref: str | None = None) -> dict[str, dict[str, float]]:
    """e-Stat 令和5年住宅・土地統計調査 表6-3-2 を構造3区分×年代3区分に集計済みの CSV を読む。

    列: name,wood_pre1981,wood_1981_2000,wood_post2000,rc_...,steel_...。行は県計と、その後に続くその県の市町村（政令市は市全体）。
    戻り値は parse_housing_6_3 と同じ形（名前 → {"wood:pre1981": 住宅数, ...}）。"-" は 0。
    pref（県名）を渡すと、その県計の行から次の県計の行までのブロックだけを返す（別の県の同名町村、例: 愛知県・和歌山県の美浜町を混ぜない）。
    その県が無ければ ValueError。名前の重複は、pref を渡したときはブロックの中、渡さないときはファイル全体で ValueError。
    """
    blocks: dict[str, dict[str, dict[str, float]]] = {}
    flat: dict[str, dict[str, float]] = {}
    current: dict[str, dict[str, float]] | None = None
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        if header != _ESTAT_COLS:
            raise ValueError(f"{path}: 列が想定と違う: {header}")
        for i, row in enumerate(reader, start=2):
            if not row or not row[0].strip():
                continue
            name = row[0].strip()
            if _is_pref_row(name):
                if name in blocks:
                    raise ValueError(f"{path}:{i}: 県 {name} が重複")
                current = blocks[name] = {}
            if current is None:
                raise ValueError(f"{path}:{i}: 県計の行より前に市町村の行がある: {name}")
            scope = current if pref is not None else flat
            if name in scope:
                raise ValueError(f"{path}:{i}: 名前 {name} が重複")
            if len(row) != len(_ESTAT_COLS):
                raise ValueError(f"{path}:{i}: 列数が違う: {row}")
            vals = {}
            for col, tok in zip(_ESTAT_COLS[1:], row[1:]):
                tok = tok.strip()
                if not _NUM.match(tok):
                    raise ValueError(f"{path}:{i}: 数値でない: {tok!r}")
                s_, e_ = col.split("_", 1)
                vals[f"{s_}:{e_ if e_ in ERAS else 'y' + e_}"] = _num(tok)
            current[name] = vals
            flat.setdefault(name, vals)
    if pref is None:
        return flat
    if pref not in blocks:
        raise ValueError(f"{path}: 県計 {pref} がない")
    return blocks[pref]


@dataclass(frozen=True)
class PrefInputs:
    code: str
    name: str
    boundary: Path
    housing: Path
    parse_housing: Callable[[Path], dict[str, dict[str, float]]]


def pref_inputs(code: str, raw: Path) -> PrefInputs:
    """県コード → 県名・境界ファイル・住宅統計ファイルとその読み方。"""
    if code not in PREFS:
        raise ValueError(f"未対応の県コード: {code}（{', '.join(PREFS)}）")
    raw = Path(raw)
    if code == "24":
        housing, parser = raw / "housing" / "mie_housing_r5.txt", parse_housing_6_3
    else:
        # 県のブロックだけを読む（別の県の同名町村を混ぜない）。県を渡さない呼び方はできないようにする
        housing, parser = raw / "housing" / ESTAT_HOUSING, functools.partial(parse_housing_estat_csv, pref=PREFS[code])
    return PrefInputs(code, PREFS[code], raw / "boundary" / f"r2ka{code}.shp", housing, parser)


_WARD = re.compile(r"^(.+?市).+区$")


def municipality_name(city_name: str) -> str:
    """境界の CITY_NAME → 市町村名。政令指定都市の区は市にまとめる（例: 名古屋市千種区 → 名古屋市）。"""
    m = _WARD.match(city_name)
    return m.group(1) if m else city_name


# --- 固定資産概要調書 ---
def parse_kotei(xlsx: Path, pref: str) -> dict[str, tuple[int, int]]:
    """市町名 → (木造棟数, 木造以外棟数)"""
    df = pd.read_excel(xlsx, header=2)
    df = df[(df["都道府県名"] == pref) & df["表側"].isin(["木造・総数", "木造以外・総数"])]
    out: dict[str, list[int]] = {}
    for _, r in df.iterrows():
        pair = out.setdefault(r["市町村名"], [0, 0])
        pair[0 if r["表側"] == "木造・総数" else 1] = int(r["棟数"])
    return {k: (v[0], v[1]) for k, v in out.items()}


# --- 国勢調査メッシュ ---
def read_households(census_dir: Path) -> dict[str, float]:
    """mesh250 → 世帯総数（"*"・空欄は 0）"""
    hh: dict[str, float] = {}
    for f in sorted(Path(census_dir).glob("tblT001142Q*.txt")):
        df = pd.read_csv(f, encoding="cp932", header=None, dtype=str, skiprows=1, keep_default_na=False)
        labels = df.iloc[0]
        cols = [i for i, v in enumerate(labels) if str(v).replace("　", "").strip() == "世帯総数"]
        if len(cols) != 1:
            raise ValueError(f"世帯総数列が特定できない: {f}")
        body = df.iloc[1:]
        for code, val in zip(body[0], body[cols[0]]):
            code = str(code).strip()
            if not re.fullmatch(r"\d{10}", code):
                continue
            val = str(val).strip()
            hh[code] = float(val) if re.fullmatch(r"\d+(\.\d+)?", val) else 0.0
    return hh


@dataclass
class StockResult:
    totals: dict[str, int]
    fallback: list[str]
    municipality_meshes: dict[str, list[str]]
    notes: str = ""
    allocated: dict[str, float] = field(default_factory=dict)


def _shares(housing: dict[str, float], wood_n: int, non_n: int) -> dict[str, float]:
    wood_tot = sum(housing[f"wood:{e}"] for e in ERAS)
    non_tot = sum(housing[f"{s}:{e}"] for s in ("rc", "steel") for e in ERAS)
    if wood_tot <= 0 or non_tot <= 0:
        raise ValueError("構造別の住宅数が 0")
    w = wood_n / (wood_n + non_n)
    shares = {}
    for k in KEYS:
        if k.startswith("wood"):
            shares[k] = w * housing[k] / wood_tot
        else:
            shares[k] = (1 - w) * housing[k] / non_tot
    s = sum(shares.values())
    return {k: v / s for k, v in shares.items()}


def build_stock_full(census_dir, boundary_shp, housing, kotei, out_dir, pref: str = "24") -> StockResult:
    if pref not in PREFS:
        raise ValueError(f"未対応の県コード: {pref}")
    pref_name = PREFS[pref]
    out_dir = Path(out_dir)
    hh = {m: v for m, v in read_households(census_dir).items() if v > 0}
    stock_h = parse_housing_6_3(housing) if pref == "24" else parse_housing_estat_csv(housing, pref_name)
    if pref_name not in stock_h:
        raise ValueError(f"{housing}: 県計 {pref_name} がない")
    pref_h = stock_h[pref_name]
    counts = parse_kotei(kotei, pref_name)

    bnd = gpd.read_file(boundary_shp).to_crs("EPSG:6668")
    bnd["CITY_NAME"] = bnd["CITY_NAME"].map(municipality_name)
    munis = bnd[["CITY_NAME", "geometry"]].dissolve(by="CITY_NAME").reset_index()
    centers = [mesh_center(m) for m in hh]
    pts = gpd.GeoDataFrame(
        {"mesh": list(hh)},
        geometry=gpd.points_from_xy([c[1] for c in centers], [c[0] for c in centers]),
        crs="EPSG:6668",
    )
    joined = gpd.sjoin(pts, munis, how="inner", predicate="within").drop_duplicates("mesh")

    by_muni: dict[str, list[str]] = {}
    for mesh, name in zip(joined["mesh"], joined["CITY_NAME"]):
        by_muni.setdefault(name, []).append(mesh)

    groups: dict[str, dict] = {}
    totals: dict[str, int] = {}
    allocated: dict[str, float] = {}
    muni_meshes: dict[str, list[str]] = {}
    fallback: list[str] = []
    for name, (wood_n, non_n) in counts.items():
        meshes = sorted(by_muni.get(name, []))
        hsum = sum(hh[m] for m in meshes)
        if hsum <= 0:
            raise ValueError(f"{name}: 世帯のあるメッシュがない（全メッシュの世帯が 0）")
        src = stock_h.get(name)
        try:
            if src is None:
                raise ValueError
            shares = _shares(src, wood_n, non_n)
        except ValueError:
            fallback.append(name)
            shares = _shares(pref_h, wood_n, non_n)
        n_total = wood_n + non_n
        for m in meshes:
            groups.setdefault(m[:6], {})[m] = {
                "total": n_total * hh[m] / hsum,
                "shares": shares,
            }
        muni_meshes[name] = meshes
        allocated[name] = sum(n_total * hh[m] / hsum for m in meshes)
        totals[name] = int(round(allocated[name]))

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("??????.json"):
        old.unlink()
    for mesh2, data in groups.items():
        (out_dir / f"{mesh2}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    (out_dir / "municipality_meshes.json").write_text(
        json.dumps(muni_meshes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    table = "第6-3表" if pref == "24" else "表6-3-2"
    notes = (
        "メッシュ中心点を含む市町に割り当て、固定資産の棟数（木造・木造以外）を世帯総数で按分。"
        f"構造×年代の割合は住宅・土地統計 {table}（建築時期は1970以前+1971-80=pre1981、1981-2000、2001以降=post2000。構造は木造・RC・鉄骨、その他は除外）を木造/非木造の棟数比で重み付け。"
    )
    if fallback:
        notes += f"住宅・土地統計に市町の値がなく県計（{pref_name}）の割合で代用: " + "、".join(fallback) + "。"
    else:
        notes += f"県計（{pref_name}）割合での代用なし。"
    return StockResult(totals, fallback, muni_meshes, notes, allocated)


def build_stock(census_dir, boundary_shp, housing, kotei, out_dir, pref: str = "24") -> dict[str, int]:
    return build_stock_full(census_dir, boundary_shp, housing, kotei, out_dir, pref).totals


# 県別の補足（manifest の prefNotes に付ける）
HOUSING_PREF_NOTES = {
    "30": "白浜町は表6-3-2 の行の2001年以降が 0 で使えないため入れていない。表の美浜町は愛知県の町のため、和歌山県の美浜町には使わない。",
}


def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pref", required=True, choices=sorted(PREFS), help="県コード（2桁）")
    ap.add_argument("--raw", default="data/raw", type=Path)
    ap.add_argument("--out", type=Path, help="既定 build/data-build/<pref>/stock")
    ap.add_argument("--manifest", default="public/data/manifest.json", type=Path)
    a = ap.parse_args(argv)
    if a.out is None:
        a.out = Path("build/data-build") / a.pref / "stock"
    return a


def main(argv=None) -> None:
    a = parse_args(argv)
    raw = a.raw
    p = pref_inputs(a.pref, raw)
    kotei = raw / "kotei" / "kotei_r06_soukatsu.xlsx"
    r = build_stock_full(raw / "census_mesh", p.boundary, p.housing, kotei, a.out, a.pref)
    counts = parse_kotei(kotei, p.name)
    print(f"{'市町':<8}{'メッシュ数':>8}{'割当棟数':>12}{'固定資産':>12}{'差':>8}")
    bad = 0
    for name, (w, n) in counts.items():
        diff = r.allocated[name] - (w + n)
        bad += abs(diff) > 0.5
        print(f"{name:<8}{len(r.municipality_meshes[name]):>8}{r.allocated[name]:>12.1f}{w + n:>12}{diff:>8.2f}")
    print(f"市町数 {len(counts)} / 割当棟数合計 {sum(r.allocated.values()):.1f} / 固定資産合計 {sum(w + n for w, n in counts.values())} / 不一致 {bad}")
    print("県計割合で代用:", "、".join(r.fallback) or "なし")
    today = date.today().isoformat()
    fallback_note = ("県計割合で代用: " + "、".join(r.fallback) + "。") if r.fallback else "県計割合での代用なし。"
    fallback_note += HOUSING_PREF_NOTES.get(a.pref, "")
    update_manifest_pref(
        a.manifest,
        {
            "id": "census-mesh",
            "name": "令和2年国勢調査 4分の1地域メッシュ（世帯総数）と小地域境界（{prefs}）",
            "source": "総務省統計局 令和2年国勢調査 地域メッシュ統計（T001142）・境界データ（r2ka{codes}）",
            "url": "https://www.e-stat.go.jp/gis",
            "publishedDate": "令和2年（2020）",
            "license": "政府統計の総合窓口の利用規約（出典明記で二次利用可）",
            "processedDate": today,
            "notes": "世帯総数の按分に使用。\"*\"・空欄は 0。メッシュ中心点を含む市町に割当（境界は小地域を市町ごとに併合。政令指定都市の区は市にまとめる）。",
        },
        a.pref,
    )
    if a.pref == "24":
        update_manifest(
            a.manifest,
            {
                "id": "housing-land-survey",
                "name": "令和5年住宅・土地統計調査 三重県 第6-3表（構造×建築時期）",
                "source": "総務省統計局 令和5年住宅・土地統計調査 三重県結果",
                "url": "https://www.pref.mie.lg.jp/common/content/001214590.pdf",
                "publishedDate": "令和5年（2023）調査",
                "license": "政府統計の総合窓口の利用規約（出典明記で二次利用可）",
                "processedDate": today,
                "notes": r.notes + "県計は第6-1表（建築時期14区分）から2001年以降を合算。不詳は除外。",
            },
        )
    else:
        update_manifest_pref(
            a.manifest,
            {
                "id": "housing-land-survey-estat",
                "name": "令和5年住宅・土地統計調査 表6-3-2 住宅の構造(4区分)、建築の時期(7区分)別住宅数（{prefs}）",
                "source": "総務省統計局 令和5年住宅・土地統計調査 住宅及び世帯に関する基本集計（e-Stat 表6-3-2）",
                "url": "https://www.e-stat.go.jp/dbview?sid=0004021696",
                "publishedDate": "令和5年（2023）調査",
                "license": "政府統計の総合窓口の利用規約（出典明記で二次利用可）",
                "processedDate": today,
                "notes": (
                    "メッシュ中心点を含む市町村に割り当て、固定資産の棟数（木造・木造以外）を世帯総数で按分。"
                    "構造×年代の割合は表6-3-2（建築時期は1970以前+1971-80=pre1981、1981-90+1991-2000=1981-2000、2001-2023=post2000。"
                    "構造は木造・鉄筋鉄骨コンクリート造・鉄骨造、その他は除外。「-」は 0）を木造/非木造の棟数比で重み付け。"
                    "政令指定都市は市全体の値。市町村の値は同じ県のブロックの中だけで引き（別の県の同名町村は使わない）、なければ県計の割合で代用。"
                ),
            },
            a.pref,
            fallback_note,
        )
    update_manifest(
        a.manifest,
        {
            "id": "kotei-shisan",
            "name": "固定資産の価格等の概要調書（家屋）令和6年度 総括表",
            "source": "総務省 令和6年度 固定資産の価格等の概要調書",
            "url": "https://www.soumu.go.jp/main_content/001021847.xlsx",
            "publishedDate": "令和6年度",
            "license": "政府機関の公表資料（出典明記）",
            "processedDate": today,
            "notes": "表側「木造・総数」「木造以外・総数」の棟数を市町村の建物棟数として使用（政令指定都市は市全体）。",
        },
    )

if __name__ == "__main__":
    main()
