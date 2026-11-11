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
