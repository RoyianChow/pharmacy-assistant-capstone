# Prescription image classifier research scaffold

This is a binary **research baseline** with class order `["real", "fake"]`. No verified prescription dataset or trained authenticity model is included. The default Lambda image returns **503** for valid images until a compatible trained research artifact is supplied. An image classifier cannot establish prescription authenticity, prescriber identity, clinical appropriateness, or permission to dispense. Every result requires pharmacist review. Scores are uncalibrated model scores, not probabilities that a prescription is authentic.

## Training data and provenance

Supply an authorized, de-identified dataset with independently verified labels. Do not use patient documents merely because they are available in an app or dashboard. Agree on what constitutes `real` and `fake` with the data owner and record the evidence for each label. This project neither downloads prescription datasets nor infers labels from filenames, OCR text, demo watermarks, or formatting.

The CSV manifest must have exactly these columns:

```csv
path,label,group_id,split,verification_reference
images/example.png,real,source-family-001,train,review://independent-label-review-record
```

The example is a schema illustration, not a sufficient dataset. Each of `train`, `val`, and `test` needs both labels. Paths resolve inside the manifest's directory. `verification_reference` must be a nonempty record identifier or reference (at least eight characters), with no patient details; its underlying evidence must be reviewed by the dataset owner. The loader checks reference presence, not the truth of an external record.

Use one `group_id` for all documents that could reveal shared identities, source prescriptions, issuers, acquisition batches, templates, or derived/modified versions. Keep each group in one split. File SHA-256 and decoded-pixel hashes detect exact duplicates across splits and conflicting labels; near duplicates and shared templates still need manual grouping. Preserve a genuinely held-out test split before training and do not tune from its results. Tiny or unrepresentative test sets do not establish real-world performance.

## Install and test

Use Python 3.11 or 3.12 locally. From this directory:

```powershell
py -3.11 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-test.txt
.venv/Scripts/python.exe -m pytest tests -q
```

On Linux/macOS use `python3.12` and `.venv/bin/python`. Inference requirements are separate from the heavier training dependencies. On Windows, keep the checkout path short if pip reports a long-path error while installing PyTorch; this does not require changing execution policy or machine-wide settings.

## Train and export

```powershell
.venv/Scripts/python.exe train.py --manifest data/verified/manifest.csv --output artifacts --purpose research_training --approval-reference review://dataset-rights-and-label-approval --epochs 10
.venv/Scripts/python.exe validate_artifact.py --model-dir artifacts
```

`train.py` freezes the ImageNet ResNet18 backbone and trains a new two-logit head on CPU. Its first normal run downloads the public ImageNet weights, not prescription training data. `--no-pretrained` is allowed only for offline software smoke tests. The model applies EXIF orientation, composites transparency onto white, preserves the full page with deterministic 224 x 224 letterboxing, and uses ImageNet normalization. Training and inference call the same preprocessing function. This low-resolution baseline may lose small text and forgery details.

Validation loss selects the best head and controls early stopping. After ONNX export, PyTorch/ONNX logits are compared on training/validation examples. The held-out test split is then evaluated exactly once with the exported ONNX model. Output files are:

- `model.onnx`: embedded-weight CPU artifact, input `image: float32[1,3,224,224]`, output `logits: float32[1,2]`.
- `metadata.json`: model hash/version, preprocessing, purpose, dataset approval reference, manifest hash, dataset content fingerprint, seed, best epoch, split counts, and parity error. The dataset fingerprint hashes a sorted canonical projection of each image's SHA-256, label, group, and split; it does not expose image paths or group identifiers.
- `metrics.json`: confusion matrix with actual rows/predicted columns in `[real,fake]` order, accuracy, fake recall, false-real rate, and false-fake rate.

Fake recall is correctly predicted fake / all verified fake; false-real rate is verified fake predicted real / all verified fake. False-fake rate is verified real predicted fake / all verified real. Exact score ties resolve to `fake` consistently in runtime and evaluation. Existing artifacts are not overwritten. Metrics describe the supplied test set only and do not confer clinical validation.

Keep artifacts, datasets, and private review records out of Git. Only the final reviewed `model.onnx` and `metadata.json` belong in the container's `artifacts` directory. The readiness CLI exits nonzero for missing, incompatible, corrupted, untrained, or software-smoke artifacts. It is a packaging check, not independent certification of labels or medical performance.

## Software smoke only

```powershell
.venv/Scripts/python.exe synthetic_fixture.py .runtime/geometric
.venv/Scripts/python.exe train.py --manifest .runtime/geometric/manifest.csv --output .runtime/smoke-artifact --purpose pipeline_smoke_test --approval-reference synthetic-software-test-only --epochs 2 --batch-size 2
.venv/Scripts/python.exe validate_artifact.py --model-dir .runtime/smoke-artifact
```

The fixture contains colored rectangles and ellipses, not prescriptions. Its arbitrary `real`/`fake` strings exercise class ordering only. A successful training/export/parity run proves software behavior; its metrics say nothing about authenticity. The final readiness command **must fail** because the runtime refuses `trainingPurpose: pipeline_smoke_test`. Never relabel smoke metadata to make it deployable.

## Lambda packaging and local emulator

```text
docker build --platform linux/amd64 -t pharmacy-prescription-classifier:local-qa services/prescription-classifier
docker run --rm -p 127.0.0.1:8003:8080 pharmacy-prescription-classifier:local-qa
```

Build from the repository root. In another terminal, run the service's `smoke_unavailable.py` with its virtual-environment Python. It invokes the actual Lambda Runtime Interface Emulator and expects sanitized unavailable/invalid-input responses. The default image deliberately has no trained model. To test smoke-artifact rejection, mount `.runtime/smoke-artifact` at `/var/task/model` **read-only** and run the same checks. Stop only the test container you created.

The image uses AWS Python 3.12 (Amazon Linux 2023) and ONNX Runtime CPU, without PyTorch or a web framework. Artifacts copied into the image have write permissions removed. Python 3.12 permits current ONNX Runtime Linux wheels; the older AWS Python 3.11 base uses an older glibc. No AWS resource is created by these scripts.

Use private, authenticated AWS SDK `Invoke` from the Next.js server in a future deployment; do not expose an unauthenticated Function URL. The direct event is:

```json
{"schemaVersion":1,"contentType":"image/png","imageBase64":"<strict canonical base64>"}
```

Success is `{statusCode:200,body:{schemaVersion:1,modelVersion,predictedLabel,scores:{real,fake},reviewRequired:true,validationStatus:"research_only",durationMs}}`. Errors use `{statusCode:400|413|415|422|503,body:{error}}`. `body` is an object for SDK invocation, not an API Gateway JSON string. The local emulator's transport HTTP 200 can contain an application `statusCode` of 503. Handle both transport and application failures in the caller.

PNG/JPEG only, 4 MiB decoded bytes, at most 16 megapixels/8,000 pixels per side, and one frame. Base64 expansion stays below Lambda's synchronous invocation payload limit. Images are decoded and processed in memory; the handler never stores or logs uploads, labels, scores, or underlying exception details. AWS runtime invocation metadata may still appear in platform logs. Model sessions are cached between invocations.

## Validation completed locally

The unit suite passed 33 tests covering preprocessing, strict input validation, artifact rejection, score/tie handling, dataset leakage, and metric denominators. A two-epoch run with the geometric fixture exercised actual ImageNet transfer training, ONNX export, held-out evaluation, and PyTorch/ONNX parity. This is software validation only; no prescription-authenticity performance has been established.

The Linux/amd64 Lambda image built successfully (680,213,872 bytes without model weights). Actual local Runtime Interface Emulator checks passed with both an absent artifact and the read-only software-smoke artifact: valid input returned 503, bad schema/base64 returned 400, unsupported content type returned 415, and undecodable image bytes returned 422. The synthetic ONNX graph also executed with finite two-logit output on Linux CPU. Both temporary containers were removed, and dependency checks passed.

Verified prescription data, a reviewed research artifact, and an authorized AWS deployment remain outstanding. The website must keep classifier predictions unavailable until those dependencies are supplied; synthetic results must never be presented as authenticity validation.

## References

- [Torchvision ResNet18 weights and normalization](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.resnet18.html)
- [PyTorch transfer learning](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html)
- [PyTorch ONNX export](https://docs.pytorch.org/docs/2.15/onnx.html)
- [ONNX Runtime CPU Python usage](https://onnxruntime.ai/docs/get-started/with-python.html)
- [AWS Lambda Python images and local invocation](https://docs.aws.amazon.com/lambda/latest/dg/python-image.html)
