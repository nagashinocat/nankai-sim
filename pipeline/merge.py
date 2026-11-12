"""県ごとの出力（build/data-build/<県コード>/{stock,shelters,hazard/<case>}）を public/data に統合する。

2次メッシュ JSON（??????.json）:
  - 辞書（建物・ハザード）: 250m メッシュのキーの和。同じキーが複数の県にあれば値が一致すること（不一致は ValueError）。
  - リスト（避難場所）: id の和。同じ id は内容が一致すれば1件、違えば ValueError。
index.json（対応範囲）は和、municipality_meshes.json は市町村名の和。同じ名前が複数の県にあれば（愛知県・和歌山県の美浜町など）、
その名前はどの県の分も県名を付けた名前（「愛知県美浜町」「和歌山県美浜町」）にする。入力から県コードが分からなければ ValueError。
結果は入力の順に依らない（キー・id・市町村名の順に並べて書く）。
"""
import argparse
import json
import re
from pathlib import Path
from typing import Callable

from pipeline.prefs import PREFS

MESH_GLOB = "??????.json"
KINDS = ("stock", "shelters")


def _read(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _write(p: Path, obj) -> None:
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _merge_dict(acc: dict, src: dict, where: str) -> None:
    for k, v in src.items():
        if k in acc and acc[k] != v:
            raise ValueError(f"メッシュ {k} の値が違う: {acc[k]} / {v}（{where}）")
        acc[k] = v


def _merge_list(acc: dict, src: list, where: str) -> None:
    for item in src:
        i = item["id"]
        if i in acc and acc[i] != item:
            raise ValueError(f"id {i} の内容が違う: {acc[i]} / {item}（{where}）")
        acc[i] = item


def _pref_of(src: Path) -> str:
    """入力ディレクトリ（…/<県コード> または …/<県コード>/stock）→ 県コード。"""
    for part in (src.name, src.parent.name):
        if re.fullmatch(r"\d{2}", part):
            return part
    raise ValueError(f"入力ディレクトリから県コードが分からない: {src}")


class border_resolver:  # noqa: N801（関数のように使う）
    """県境のメッシュを2県以上が割り当てたときの決め方（Ruling: 境界メッシュ）。

    contains(県コード, mesh) はその県の境界ポリゴンがメッシュ中心を含むか。含む県が1つならその県、
    複数（境界の重なり）または0なら県コードの小さい方。入力の順に依らない。
    resolved（mesh → 採った県コード）と overlap（複数の県の境界が含んだ mesh）を記録する。
    """

    def __init__(self, contains: Callable[[str, str], bool]):
        self.contains = contains
        self.resolved: dict[str, str] = {}
        self.overlap: list[str] = []

    def __call__(self, mesh: str, srcs: list[Path]) -> Path:
        by_pref = {_pref_of(s): s for s in srcs}
        if len(by_pref) != len(srcs):
            raise ValueError(f"メッシュ {mesh}: 同じ県の入力が複数ある: {srcs}")
        inside = sorted(p for p in by_pref if self.contains(p, mesh))
        if len(inside) > 1:
            self.overlap.append(mesh)
        pref = inside[0] if len(inside) == 1 else min(inside or by_pref)
        self.resolved[mesh] = pref
        return by_pref[pref]


def merge_mesh_dirs(srcs: list[Path], dst: Path, resolve: Callable[[str, list[Path]], Path] | None = None) -> int:
    """srcs の2次メッシュ JSON・index.json・municipality_meshes.json を dst に統合する。

    戻り値は書き出したエントリ数（辞書はキー数、リストは件数の合計）。dst の古い ??????.json は消す。
    resolve を渡すと、複数の入力にある辞書のキー（250m メッシュ）は resolve(mesh, 持っている入力) が返す入力の値と
    市町村だけを残す（ほかの入力の値・市町村の所属は捨てる）。渡さなければ値が違うとき・2つの市町村にあるときは ValueError。
    """
    srcs = sorted((Path(s) for s in srcs), key=str)
    for s in srcs:
        if not s.is_dir():
            raise FileNotFoundError(f"入力ディレクトリがない: {s}")
    loaded = {s: [(f, _read(f)) for f in sorted(s.glob(MESH_GLOB))] for s in srcs}
    mm_in = {s: _read(s / "municipality_meshes.json") for s in srcs if (s / "municipality_meshes.json").exists()}

    skip: set[tuple[Path, str]] = set()  # (入力, mesh) 県境の決め方で捨てる分
    if resolve is not None:
        holders: dict[str, set[Path]] = {}
        for s in srcs:
            keys = {k for _, d in loaded[s] if isinstance(d, dict) for k in d}
            keys |= {m for ms in mm_in.get(s, {}).values() for m in ms}
            for k in keys:
                holders.setdefault(k, set()).add(s)
        for mesh in sorted(holders):
            if len(holders[mesh]) > 1:
                cands = sorted(holders[mesh], key=str)
                win = resolve(mesh, cands)
                skip |= {(s, mesh) for s in cands if s != win}

    # 複数の入力にある市町村名は県名を付ける（どの県の分も）
    seen: dict[str, int] = {}
    for s in mm_in:
        for name in mm_in[s]:
            seen[name] = seen.get(name, 0) + 1
    shared = {n for n, c in seen.items() if c > 1}

    def muni_key(s: Path, name: str) -> str:
        if name not in shared:
            return name
        try:
            pref = PREFS[_pref_of(s)]
        except (ValueError, KeyError):
            raise ValueError(f"市町村名 {name} が複数の入力にあり、{s} の県が分からない（県名を付けられない）")
        return pref + name

    files: dict[str, tuple[type, dict]] = {}
    index: set[str] | None = None
    munis: dict[str, list[str]] | None = None
    owner: dict[str, str] = {}  # mesh → 市町村名
    for s in srcs:
        for f, data in loaded[s]:
            if not isinstance(data, (dict, list)):
                raise ValueError(f"{f}: 辞書でもリストでもない")
            kind, acc = files.setdefault(f.stem, (type(data), {}))
            if kind is not type(data):
                raise ValueError(f"{f}: 他の入力と形が違う（辞書とリスト）")
            if kind is dict:
                _merge_dict(acc, {k: v for k, v in data.items() if (s, k) not in skip}, str(f))
            else:
                _merge_list(acc, data, str(f))
        if (s / "index.json").exists():
            index = (index or set()) | set(_read(s / "index.json"))
        if s in mm_in:
            munis = {} if munis is None else munis
            for name, meshes in mm_in[s].items():
                name = muni_key(s, name)
                if name in munis:
                    raise ValueError(f"市町村名 {name} が複数の入力にある（{s}）")
                meshes = [m for m in meshes if (s, m) not in skip]
                for m in meshes:
                    if m in owner:
                        raise ValueError(f"メッシュ {m} が {owner[m]} と {name} の両方にある")
                    owner[m] = name
                munis[name] = sorted(meshes)
    if index is not None and index != set(files):
        raise ValueError(f"index.json と2次メッシュファイルが合わない: {sorted(index ^ set(files))}")

    dst = Path(dst)
    dst.mkdir(parents=True, exist_ok=True)
    for old in dst.glob(MESH_GLOB):
        old.unlink()
    count = 0
    for mesh2 in sorted(files):
        kind, acc = files[mesh2]
        out = {k: acc[k] for k in sorted(acc)} if kind is dict else [acc[i] for i in sorted(acc)]
        _write(dst / f"{mesh2}.json", out)
        count += len(acc)
    if index is not None:
        _write(dst / "index.json", sorted(index))
    if munis is not None:
        _write(dst / "municipality_meshes.json", {k: munis[k] for k in sorted(munis)})
    return count


def merge_build(pref_dirs: list[Path], dst_root: Path, resolve: Callable[[str, list[Path]], Path] | None = None) -> dict[str, int]:
    """県ごとの出力ディレクトリ（…/data-build/<県コード>）の stock・shelters・hazard/<case> をそれぞれ統合する。

    ある種類を持たない県は、その種類では飛ばす。戻り値は種類 → エントリ数。
    resolve（県境のメッシュの決め方、border_resolver）は stock にだけ使う。
    """
    pref_dirs = [Path(p) for p in pref_dirs]
    kinds = [k for k in KINDS if any((p / k).is_dir() for p in pref_dirs)]
    cases = sorted({c.name for p in pref_dirs if (p / "hazard").is_dir() for c in (p / "hazard").iterdir() if c.is_dir()})
    kinds += [f"hazard/{c}" for c in cases]
    out = {}
    for k in kinds:
        srcs = [p / k for p in pref_dirs if (p / k).is_dir()]
        out[k] = merge_mesh_dirs(srcs, Path(dst_root) / k, resolve=resolve if k == "stock" else None)
        print(f"{k}: {out[k]} 件（{', '.join(str(s) for s in srcs)}）")
    return out


def boundary_contains(boundary_dir: Path) -> Callable[[str, str], bool]:
    """県コード・250m メッシュ → r2ka<県コード>.shp（小地域境界）の和がメッシュ中心を含むか。境界は必要になったときに読む。"""
    cache: dict = {}

    def contains(pref: str, mesh: str) -> bool:
        import geopandas as gpd
        from shapely.geometry import Point

        from pipeline.building_stock import mesh_center

        if pref not in cache:
            shp = Path(boundary_dir) / f"r2ka{pref}.shp"
            cache[pref] = gpd.read_file(shp).to_crs("EPSG:6668").union_all()
        lat, lon = mesh_center(mesh)
        return cache[pref].contains(Point(lon, lat))

    return contains


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", nargs="+", required=True, type=Path, help="県ごとの出力（例: build/data-build/24）")
    ap.add_argument("--dst", default="public/data", type=Path)
    ap.add_argument("--boundary-dir", default="data/raw/boundary", type=Path, help="県境のメッシュの判定に使う r2ka<県コード>.shp の場所")
    a = ap.parse_args(argv)
    resolve = border_resolver(boundary_contains(a.boundary_dir))
    merge_build(a.src, a.dst, resolve=resolve)
    print(f"県境のメッシュ（2県が割り当て）: {len(resolve.resolved)} 件、うち両県の境界が中心を含む（小さい県コードを採用）: {len(resolve.overlap)} 件")
    for mesh, pref in sorted(resolve.resolved.items()):
        print(f"  {mesh} → {pref}{'（重なり）' if mesh in resolve.overlap else ''}")


if __name__ == "__main__":
    main()
