"""Validate provenance and leakage boundaries before training any model."""
import csv
import hashlib
from pathlib import Path

from preprocess import DEMO_LABELS, LABELS, MAX_BYTES, decode_image

FIELDS = {"path", "label", "group_id", "split", "verification_reference"}
DEMO_FIELDS = {"template_id", "source_id", "alteration_kind", "watermark_sha256"}


def load_manifest(path, purpose):
    if purpose not in {"research_training", "pipeline_smoke_test", "synthetic_demo"}:
        raise ValueError("Unknown training purpose.")
    fields = FIELDS | DEMO_FIELDS if purpose == "synthetic_demo" else FIELDS
    labels = DEMO_LABELS if purpose == "synthetic_demo" else LABELS
    path = Path(path).resolve()
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or []) != fields:
            raise ValueError("Manifest headers do not match the selected training purpose.")
        rows = list(reader)
    groups, hashes, pixels, seen_paths, templates, sources = {}, {}, {}, set(), {}, {}
    for number, row in enumerate(rows, 2):
        if any(not isinstance(row.get(field), str) or not row[field].strip() for field in fields):
            raise ValueError(f"Missing manifest value on row {number}.")
        row.update({field: row[field].strip() for field in fields})
        if row["label"] not in labels or row["split"] not in {"train", "val", "test"}:
            raise ValueError(f"Invalid label or split on row {number}.")
        reference = row["verification_reference"]
        synthetic = reference.startswith("synthetic://")
        if len(reference) < 8 or synthetic != (purpose in {"pipeline_smoke_test", "synthetic_demo"}):
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
        if purpose == "synthetic_demo":
            from synthetic_prescriptions import KINDS, SIZE, VERSION, watermark_hash
            if (decoded.size != SIZE or watermark_hash(decoded) != row["watermark_sha256"]
                    or row["alteration_kind"] not in KINDS or not reference.startswith(f"synthetic://{VERSION}/")):
                raise ValueError("Invalid synthetic generator provenance or watermark.")
            if templates.setdefault(row["template_id"], row["split"]) != row["split"]:
                raise ValueError("Template leakage across dataset splits.")
            sources.setdefault(row["source_id"], []).append(row)
    for split in ["train", "val", "test"]:
        if {row["label"] for row in rows if row["split"] == split} != set(labels):
            raise ValueError(f"Both labels are required in the {split} split.")
    if purpose == "synthetic_demo":
        if len({row["watermark_sha256"] for row in rows}) != 1:
            raise ValueError("All synthetic labels must use identical watermark pixels.")
        for split in ["train", "val", "test"]:
            if sum(value == split for value in templates.values()) < 2:
                raise ValueError("Each synthetic split requires at least two disjoint templates.")
        for pair in sources.values():
            identities = {(row["template_id"], row["split"], row["group_id"], row["alteration_kind"]) for row in pair}
            if len(pair) != 2 or len(identities) != 1 or {row["label"] for row in pair} != set(DEMO_LABELS):
                raise ValueError("Each synthetic source must have one original/altered pair kept together.")
    return rows
