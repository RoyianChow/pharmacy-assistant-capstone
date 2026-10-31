"""Publish an unchanged synthetic model, restricting inference to its fixed demo pair."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from preprocess import DEMO_LABELS


def prepare(source, public_manifest, output):
    metadata = json.loads((source / "metadata.json").read_text(encoding="utf-8"))
    published = json.loads(public_manifest.read_text(encoding="utf-8"))
    if (metadata["trainingPurpose"] != "synthetic_demo" or metadata["labels"] != DEMO_LABELS
            or published["mode"] != "synthetic_demo" or set(published["samples"]) != set(DEMO_LABELS)
            or published["sourceId"] != metadata["generator"]["publicSourceSelectedBeforeInference"]):
        raise ValueError("The artifact and fixed public demo selection must agree.")
    allowed = []
    for label in DEMO_LABELS:
        record = published["samples"][label]
        filename = public_manifest.parent / record["file"]
        if filename.resolve().parent != public_manifest.parent.resolve():
            raise ValueError("Public sample must be next to its manifest.")
        digest = hashlib.sha256(filename.read_bytes()).hexdigest()
        if digest != record["sha256"] or digest not in metadata["allowedImageSha256"]:
            raise ValueError("Public sample content does not match the trained dataset provenance.")
        allowed.append(digest)
    model = source / "model.onnx"
    if hashlib.sha256(model.read_bytes()).hexdigest() != metadata["modelSha256"]:
        raise ValueError("Model integrity check failed.")
    if any((output / name).exists() for name in ["model.onnx", "metadata.json"]):
        raise ValueError("Choose an empty artifact output; existing artifacts are never overwritten.")
    metadata.update(allowedImageSha256=sorted(allowed), publishedSourceId=published["sourceId"],
                    deploymentInputScope="two_preselected_generated_fixtures",
                    publicSampleManifestSha256=hashlib.sha256(public_manifest.read_bytes()).hexdigest())
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(model, output / "model.onnx")
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"modelVersion": metadata["modelVersion"], "allowedFixtureCount": len(allowed),
                      "mode": "synthetic_demo", "authenticityAssessed": False}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--public-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    prepare(args.source, args.public_manifest, args.output)
