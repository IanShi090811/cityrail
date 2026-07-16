#!/usr/bin/env python3
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "releases" / "latest.json"
VALID_STATUS = {"available", "preparing", "app-store-required"}


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def human_size(path):
    size = path.stat().st_size
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


def main():
    errors = []
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != 2:
        errors.append("release manifest schemaVersion must be 2")
    if not data.get("webVersion"):
        errors.append("release manifest missing webVersion")
    platforms = data.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        errors.append("release manifest missing platforms")
        platforms = {}

    for platform_key, platform in platforms.items():
        if not isinstance(platform, dict):
            errors.append(f"{platform_key} platform must be an object")
            continue
        for kind in ("installer", "portable"):
            item = platform.get(kind)
            if item is None:
                continue
            status = item.get("status")
            if status not in VALID_STATUS:
                errors.append(f"{platform_key}.{kind} has invalid status {status!r}")
            url = item.get("url") or ""
            if status == "available":
                if not url.startswith("/releases/"):
                    errors.append(f"{platform_key}.{kind} available item must use /releases/ url")
                    continue
                path = ROOT / url.lstrip("/")
                if not path.exists():
                    errors.append(f"{platform_key}.{kind} file does not exist: {url}")
                    continue
                digest = sha256(path)
                if item.get("sha256") != digest:
                    errors.append(f"{platform_key}.{kind} sha256 mismatch: {digest}")
                expected_size = human_size(path)
                if item.get("size") != expected_size:
                    errors.append(f"{platform_key}.{kind} size mismatch: {expected_size}")
            elif url:
                errors.append(f"{platform_key}.{kind} must not have url while status is {status}")

    print(json.dumps({
        "releaseManifestCheck": "pass" if not errors else "fail",
        "errors": errors
    }, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
