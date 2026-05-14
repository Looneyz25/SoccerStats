#!/usr/bin/env python3
"""Prepare static JSON assets for the Next.js dashboard."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DATA = ROOT / "public" / "data"


def copy_json(src: Path, dest: Path):
    if not src.exists():
        return False
    data = json.loads(src.read_text(encoding="utf-8"))
    dest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return True


def main():
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    copied = []
    if copy_json(ROOT / "match_data.json", PUBLIC_DATA / "match_data.json"):
        copied.append("match_data.json")

    for path in ROOT.glob("predictions_*.json"):
        target = PUBLIC_DATA / path.name
        shutil.copyfile(path, target)
        copied.append(path.name)

    latest = sorted(ROOT.glob("predictions_*.json"))
    if latest:
        shutil.copyfile(latest[-1], PUBLIC_DATA / "latest_predictions.json")
        copied.append("latest_predictions.json")

    print("Prepared Next.js data:", ", ".join(copied) if copied else "none")


if __name__ == "__main__":
    main()
