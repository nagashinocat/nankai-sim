"""manifest.json への追記（id が同じデータセットは置き換える）。"""
import json
from pathlib import Path


def update_manifest(path: Path, dataset: dict) -> None:
    path = Path(path)
    if path.exists():
        manifest = json.loads(path.read_text(encoding="utf-8"))
    else:
        manifest = {"datasets": []}
    datasets = manifest.setdefault("datasets", [])
    for i, d in enumerate(datasets):
        if d.get("id") == dataset["id"]:
            datasets[i] = dataset
            break
    else:
        datasets.append(dataset)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def update_manifest_pref(path: Path, dataset: dict, pref: str, pref_note: str | None = None) -> None:
    """県ごとに実行するデータセットの追記。

    既存エントリ（同じ id）の prefs（県コード）・prefNotes（県別注記）に今回の県を加えて置き換える。
    dataset の文字列の "{prefs}" は県名一覧（表記順、「・」区切り）、"{codes}" は県コード一覧に置き換え、
    notes の後ろに「【県名】県別注記」を表記順に付ける。
    """
    from pipeline.prefs import PREF_ORDER, PREFS, pref_label

    if pref not in PREFS:
        raise ValueError(f"未対応の県コード: {pref}")
    path = Path(path)
    old = {}
    if path.exists():
        for d in json.loads(path.read_text(encoding="utf-8")).get("datasets", []):
            if d.get("id") == dataset["id"]:
                old = d
    prefs = set(old.get("prefs", [])) | {pref}
    pref_notes = dict(old.get("prefNotes", {}))
    if pref_note:
        pref_notes[pref] = pref_note
    else:
        pref_notes.pop(pref, None)
    codes = [c for c in PREF_ORDER if c in prefs]
    label = pref_label(prefs)
    code_label = "・".join(sorted(prefs))
    out = {
        k: (v.replace("{prefs}", label).replace("{codes}", code_label) if isinstance(v, str) else v)
        for k, v in dataset.items()
    }
    out["notes"] = out.get("notes", "") + "".join(f"【{PREFS[c]}】{pref_notes[c]}" for c in codes if c in pref_notes)
    out["prefs"] = sorted(prefs)
    out["prefNotes"] = {c: pref_notes[c] for c in sorted(pref_notes)}
    update_manifest(path, out)
