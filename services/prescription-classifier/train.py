"""CPU ResNet18 transfer baseline; test split is evaluated once after selection."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import random

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch.utils.data import DataLoader, Dataset
from torchvision.models import ResNet18_Weights, resnet18

from manifest import load_manifest
from preprocess import LABELS, PREPROCESSING, preprocess


class Images(Dataset):
    def __init__(self, records):
        self.records = records

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        payload = record["file"].read_bytes()
        if hashlib.sha256(payload).hexdigest() != record["sha256"]:
            raise ValueError("A dataset image changed after validation.")
        return torch.from_numpy(preprocess(payload, record["mime"])), LABELS.index(record["label"])


def metrics(truth, predictions):
    matrix = [[0, 0], [0, 0]]
    for actual, predicted in zip(truth, predictions):
        matrix[int(actual)][int(predicted)] += 1
    fake_count = sum(matrix[1])
    return {"labels": LABELS, "matrixRowsActualColumnsPredicted": matrix, "sampleCount": len(truth),
            "fakeRecall": matrix[1][1] / fake_count, "falseRealRate": matrix[1][0] / fake_count,
            "falseFakeRate": matrix[0][1] / sum(matrix[0]),
            "accuracy": (matrix[0][0] + matrix[1][1]) / len(truth)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--purpose", choices=["research_training", "pipeline_smoke_test"], required=True)
    parser.add_argument("--approval-reference", required=True, help="Dataset rights/label-review record; never patient details")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-pretrained", action="store_true", help="Offline software smoke only")
    args = parser.parse_args()
    if min(args.epochs, args.patience, args.batch_size) < 1 or len(args.approval_reference.strip()) < 8:
        parser.error("Positive training settings and a documented approval reference are required.")
    if args.no_pretrained and args.purpose != "pipeline_smoke_test":
        parser.error("Research training requires ImageNet transfer weights.")
    if any((args.output / name).exists() for name in ["model.onnx", "metadata.json", "metrics.json"]):
        parser.error("Use a new output location; existing artifacts are never overwritten.")
    rows = load_manifest(args.manifest, args.purpose)
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(2)
    torch.use_deterministic_algorithms(True)
    datasets = {split: Images([row for row in rows if row["split"] == split]) for split in ["train", "val", "test"]}
    generator = torch.Generator().manual_seed(args.seed)
    loaders = {split: DataLoader(data, batch_size=args.batch_size, shuffle=split == "train", num_workers=0,
                                generator=generator if split == "train" else None) for split, data in datasets.items()}
    model = resnet18(weights=None if args.no_pretrained else ResNet18_Weights.IMAGENET1K_V1)
    for parameter in model.parameters():
        parameter.requires_grad = False
    model.fc = torch.nn.Linear(model.fc.in_features, 2)
    optimizer = torch.optim.AdamW(model.fc.parameters(), lr=1e-3)
    counts = [sum(row["label"] == label and row["split"] == "train" for row in rows) for label in LABELS]
    class_weights = torch.tensor([sum(counts) / (2 * count) for count in counts])
    loss_function = torch.nn.CrossEntropyLoss(weight=class_weights)
    validation_loss_function = torch.nn.CrossEntropyLoss(weight=class_weights, reduction="sum")
    best_loss, best_epoch, stale, best_weights = float("inf"), 0, 0, None
    for epoch in range(1, args.epochs + 1):
        model.eval()  # Frozen backbone BatchNorm statistics must stay unchanged.
        model.fc.train()
        for images, labels in loaders["train"]:
            optimizer.zero_grad()
            loss = loss_function(model(images), labels)
            loss.backward()
            optimizer.step()
        model.eval()
        with torch.inference_mode():
            weighted_loss, weight_sum = 0.0, 0.0
            for images, labels in loaders["val"]:
                weighted_loss += float(validation_loss_function(model(images), labels))
                weight_sum += float(class_weights[labels].sum())
            validation_loss = weighted_loss / weight_sum
        if not np.isfinite(validation_loss):
            raise ValueError("Non-finite validation loss.")
        print(json.dumps({"epoch": epoch, "validationLoss": validation_loss}), flush=True)
        if validation_loss < best_loss:
            best_loss, best_epoch, stale = validation_loss, epoch, 0
            best_weights = copy.deepcopy(model.fc.state_dict())
        else:
            stale += 1
        if stale >= args.patience:
            break
    model.fc.load_state_dict(best_weights)
    model.eval()
    args.output.mkdir(parents=True, exist_ok=True)
    model_path = args.output / "model.onnx"
    sample = datasets["train"][0][0].unsqueeze(0)
    torch.onnx.export(model, (sample,), str(model_path), input_names=["image"], output_names=["logits"],
                      opset_version=18, dynamo=True, external_data=False, verbose=False)
    onnx.checker.check_model(str(model_path))
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    parity_error = 0.0
    # Compare only train/validation images before touching the held-out test split.
    for split in ["train", "val"]:
        for index in range(min(2, len(datasets[split]))):
            image = datasets[split][index][0].unsqueeze(0)
            with torch.inference_mode():
                expected = model(image).numpy()
            actual = session.run(["logits"], {"image": image.numpy()})[0]
            np.testing.assert_allclose(actual, expected, rtol=1e-4, atol=1e-4)
            parity_error = max(parity_error, float(np.abs(actual - expected).max()))
    truth, predictions = [], []
    for image, label in datasets["test"]:  # Exactly one final pass using the exported artifact.
        logits = session.run(["logits"], {"image": image.unsqueeze(0).numpy()})[0]
        if not np.isfinite(logits).all():
            raise ValueError("Non-finite test logits.")
        truth.append(label)
        predictions.append(0 if logits[0, 0] > logits[0, 1] else 1)
    report = metrics(truth, predictions)
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    metadata = {"schemaVersion": 1, "architecture": "resnet18", "labels": LABELS,
                "preprocessing": PREPROCESSING, "modelSha256": digest, "modelVersion": f"resnet18-{digest[:12]}",
                "trainingCompleted": True, "trainingPurpose": args.purpose, "validationStatus": "research_only",
                "initialWeights": "none" if args.no_pretrained else "ResNet18_Weights.IMAGENET1K_V1",
                "datasetApprovalReference": args.approval_reference,
                "manifestSha256": hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
                "datasetSha256": hashlib.sha256(json.dumps(sorted(
                    (row["sha256"], row["label"], row["group_id"], row["split"]) for row in rows
                ), separators=(",", ":")).encode("utf-8")).hexdigest(),
                "seed": args.seed, "epochsRun": epoch, "bestEpoch": best_epoch, "bestValidationLoss": best_loss,
                "splitCounts": {split: len(data) for split, data in datasets.items()}, "heldOutMetrics": report,
                "onnxParityMaxAbsoluteError": parity_error, "completedAt": datetime.now(timezone.utc).isoformat()}
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    (args.output / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"modelVersion": metadata["modelVersion"], "trainingPurpose": args.purpose,
                      "onnxParityMaxAbsoluteError": parity_error, "heldOutMetrics": report}))


if __name__ == "__main__":
    main()
