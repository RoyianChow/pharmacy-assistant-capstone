"""Validate provenance and leakage boundaries before training any model."""
import csv
import hashlib
from pathlib import Path

from preprocess import LABELS, MAX_BYTES, decode_image

FIELDS = {"path", "label", "group_id", "split", "verification_reference"}


def load_manifest(path, purpose):
    path = Path(path).resolve()
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or []) != FIELDS:
            raise ValueError("Manifest headers must be path,label,group_id,split,verification_reference.")
        rows = list(reader)
    groups, hashes, pixels, seen_paths = {}, {}, {}, set()
    for number, row in enumerate(rows, 2):
        if any(not isinstance(row.get(field), str) or not row[field].strip() for field in FIELDS):
            raise ValueError(f"Missing manifest value on row {number}.")
        row.update({field: row[field].strip() for field in FIELDS})
        if row["label"] not in LABELS or row["split"] not in {"train", "val", "test"}:
            raise ValueError(f"Invalid label or split on row {number}.")
        reference = row["verification_reference"]
        synthetic = reference.startswith("synthetic://")
        if len(reference) < 8 or synthetic != (purpose == "pipeline_smoke_test"):
            raise ValueError(f"Document verified provenance for the selected training purpose on row {number}.")
        image_path = (path.parent / row["path"]).resolve()
        if not image_path.is_relative_to(path.parent) or image_path in seen_paths:
            raise ValueError("Image paths must be unique and inside the manifest directory.")
        seen_paths.add(image_path)
        if image_path.stat().st_size > MAX_BYTES:
            raise ValueError("A training image exceeds the runtime image limit.")
        payload = image_path.read_bytes()
        mime = "image/png" if payload.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg"
        decoded = decode_image(payload, mime)
        digest = hashlib.sha256(payload).hexdigest()
        pixel_hash = hashlib.sha256(str(decoded.size).encode() + decoded.tobytes()).hexdigest()
        if groups.setdefault(row["group_id"], row["split"]) != row["split"]:
            raise ValueError("Group leakage across dataset splits.")
        for table, identity in [(hashes, digest), (pixels, pixel_hash)]:
            previous = table.setdefault(identity, (row["split"], row["label"]))
            if previous != (row["split"], row["label"]):
                raise ValueError("Group or duplicate image leakage across dataset splits.")
        row.update(file=image_path, mime=mime, sha256=digest)
    for split in ["train", "val", "test"]:
        if {row["label"] for row in rows if row["split"] == split} != set(LABELS):
            raise ValueError(f"Both labels are required in the {split} split.")
    return rows
