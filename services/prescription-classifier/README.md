# Prescription image classifier research scaffold

This service supports a restricted **synthetic visual-alteration demo** and a separate future research mode. No verified prescription dataset or trained authenticity model is included. An image classifier cannot establish prescription authenticity, prescriber identity, clinical appropriateness, or permission to dispense. Every result requires pharmacist review. Scores are uncalibrated model scores, not probabilities that a prescription is authentic.

The synthetic deployment accepts only the two published fictional images at `public/demo/classifier/original.png` and `altered.png`. Their exact byte hashes are allowlisted; other images return 422. Both retain identical prominent `DEMO - NOT VALID FOR DISPENSING` markings. The model predicts `original_demo` or `altered_demo`, never `real` or `fake` in this mode. `CLASSIFIER_DEPLOYMENT_MODE=synthetic_demo` is mandatory and admits only a matching synthetic artifact. The default research mode retains the original schema and rejects synthetic artifacts. Missing/incompatible artifacts return 503; geometric `pipeline_smoke_test` artifacts remain forbidden in every mode.

## Reproduce the synthetic demo

From this service directory, after installing the training dependencies:

```powershell
.venv/Scripts/python.exe synthetic_prescriptions.py .runtime/synthetic-data-v2 --public-dir ../../public/demo/classifier
.venv/Scripts/python.exe train.py --manifest .runtime/synthetic-data-v2/manifest.csv --output .runtime/synthetic-demo-v2 --purpose synthetic_demo --approval-reference synthetic-fictional-visible-edits-only --epochs 5 --patience 2 --batch-size 8
.venv/Scripts/python.exe prepare_demo_artifact.py --source .runtime/synthetic-demo-v2 --public-manifest ../../public/demo/classifier/manifest.json --output artifacts
.venv/Scripts/python.exe validate_artifact.py --model-dir artifacts --mode synthetic_demo
```

Use new dataset/artifact output directories on a rerun; existing outputs are not overwritten. Regenerating the already-published named PNGs requires the explicit generator flag `--replace-public`. Font file hashes, generator version, and seed are recorded for reproducibility; the generator requires Arial or DejaVu Sans regular/bold fonts. Training uses two CPU threads and ImageNet transfer weights already cached after the first run.

The generated set contains 384 images: eight template IDs, 24 fictional sources per template, and an original/altered pair per source. Four templates train the head, two select the epoch, and two are evaluated once after model selection. Each pair stays together; entire template IDs are disjoint across splits. The extended manifest adds `template_id`, `source_id`, `alteration_kind`, and `watermark_sha256`. The loader checks paired labels, source/group/template boundaries, duplicate hashes, generator provenance, and identical watermark pixels. Both classes receive the same paired brightness, blur, and rotation transformations.

Edits are visible strikeouts, pasted quantity blocks, overprinted quantities, and duplicated fields. Numeric values overlap the original range; rendered edits contain no literal changed/altered/edited class labels. These templates still share typography, field structure, and edit families from one generator. This is a limited visual-artifact experiment, not independent evidence about prescription authenticity or arbitrary layouts.

The public pair is fixed as template 06/source 00 **before training or prediction**. `prepare_demo_artifact.py` preserves the model bytes and narrows its deployment allowlist to this pair; it does not select samples from model scores. Offline held-out evaluation still uses all 96 test images.

The final five-epoch run produced model `resnet18-caf5359a14d1`. The held-out matrix (actual rows, predicted columns in `[original_demo, altered_demo]` order) is `[[47,1],[17,31]]`: **81.25% balanced accuracy**, **64.58% alteration recall**, and **2.08% original false-alarm rate**. It missed **17 of 48 alterations**, particularly overprints and duplicate fields. The test set was not used for further tuning. Per-template/per-edit results, paired-score ordering, metadata, and the full training log remain in ignored `.runtime/synthetic-demo-v2/` and `.runtime/synthetic-training-v2.log`. PyTorch/ONNX maximum logit difference was `1.46e-6`. These numbers describe generated documents only.

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
.venv/Scripts/python.exe train.py --manifest data/verified/manifest.csv --output .runtime/research-v1 --purpose research_training --approval-reference review://dataset-rights-and-label-approval --epochs 10
.venv/Scripts/python.exe validate_artifact.py --model-dir .runtime/research-v1 --mode research_training
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
docker build --platform linux/amd64 -t pharmacy-prescription-classifier:synthetic-demo-v2 services/prescription-classifier
docker run --rm -p 127.0.0.1:8003:8080 --env CLASSIFIER_DEPLOYMENT_MODE=synthetic_demo --env CLASSIFIER_LOCAL_EMULATOR=1 pharmacy-prescription-classifier:synthetic-demo-v2
```

Build from the repository root after preparing the artifact. From this service directory run `.venv/Scripts/python.exe smoke_synthetic.py --save .runtime/synthetic-rie-predictions.json` against the local Lambda Runtime Interface Emulator; it checks both fixed samples and rejection of another fictional image. To test missing-artifact or forbidden-smoke rejection, mount an empty directory or `.runtime/smoke-artifact` at `/var/task/model` **read-only** and run `smoke_unavailable.py`. Stop only the test container you created. The local-emulator flag is constrained by runtime environment checks and does not bypass the counter in real Lambda.

For a readiness check inside the container, use `python validate_artifact.py --model-dir /var/task/model --mode synthetic_demo`; the CLI's default `artifacts` directory is intended for the local checkout.

The image uses AWS Python 3.12 (Amazon Linux 2023) and ONNX Runtime CPU, without PyTorch or a web framework. Artifacts copied into the image have write permissions removed. Python 3.12 permits current ONNX Runtime Linux wheels; the older AWS Python 3.11 base uses an older glibc. No AWS resource is created by these scripts.

Use private, authenticated AWS SDK `Invoke` from the Next.js server in a future deployment; do not expose an unauthenticated Function URL. The direct event is:

```json
{"schemaVersion":1,"contentType":"image/png","imageBase64":"<strict canonical base64>"}
```

Synthetic success is `{statusCode:200,body:{schemaVersion:2,mode:"synthetic_demo",modelVersion,predictedLabel,scores:{original_demo,altered_demo},reviewRequired:true,authenticityAssessed:false,validationStatus:"synthetic_demo_only",durationMs}}`. The request remains schema version 1. Future research-mode success retains schema version 1 with `real`/`fake` and `research_only`. Errors use `{statusCode:400|413|415|422|429|503,body:{error}}`. `body` is an object for SDK invocation, not an API Gateway JSON string. The local emulator's transport HTTP 200 can contain an application error. Handle both transport and application failures in the caller.

For hosted synthetic inference the cost guard requires `CLASSIFIER_USAGE_TABLE` and `CLASSIFIER_MONTHLY_MAX_CALLS` (at most 500). An atomic DynamoDB reservation happens after input/hash validation and before model loading/inference. Exhaustion returns 429; missing configuration or unavailable counter returns 503 without inference. This bounds admitted model attempts, not the total AWS bill. Deployment, IAM, account budget alerts, and storage costs are handled separately in the repository's AWS guide. No AWS resources are created by these service scripts.

PNG/JPEG only, 4 MiB decoded bytes, at most 16 megapixels/8,000 pixels per side, and one frame. Base64 expansion stays below Lambda's synchronous invocation payload limit. Images are decoded and processed in memory; the handler never stores or logs uploads, labels, scores, or underlying exception details. AWS runtime invocation metadata may still appear in platform logs. Model sessions are cached between invocations.

## Validation completed locally

The unit suite passed 86 tests, including the cost guard tests, preprocessing, strict input validation, mode/artifact rejection, score/tie handling, source/template boundaries, and metric denominators. Handler tests verify budget denial never loads the model. A two-epoch geometric smoke also exercised training/export/parity and remained non-deployable. No prescription-authenticity performance has been established.

The final Linux/amd64 Lambda image built successfully (769,821,586 bytes including the synthetic model). Actual Runtime Interface Emulator checks under a 1-CPU/1-GiB Docker limit returned `original_demo` for the fixed original (score 0.5481) and `altered_demo` for the fixed altered image (score 0.5665). These modest scores are uncalibrated. Another fictional image was rejected with 422. The measured first valid model call took 245 ms and the following call 82 ms, with 223.2 MiB resident container memory after requests; these local measurements are not hosted Lambda latency or peak-memory guarantees. Readiness and dependency checks passed. Full evidence is in ignored `.runtime/synthetic-rie-results.json` and `.runtime/synthetic-pytest.log`.

Earlier actual emulator tests verified absent/smoke artifact 503, bad schema/base64 400, unsupported type 415, and corrupt image 422. The local guard handles RIE's empty credential placeholders while nonempty AWS role credentials and container credential URI variables force the hosted counter path. No AWS resource is created or contacted by the local smoke workflow.

Verified prescription data and an authenticity research artifact remain outstanding. Only the restricted fictional demo can return synthetic predictions; these must never be presented as authenticity validation.

## References

- [Torchvision ResNet18 weights and normalization](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.resnet18.html)
- [PyTorch transfer learning](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html)
- [PyTorch ONNX export](https://docs.pytorch.org/docs/2.15/onnx.html)
- [ONNX Runtime CPU Python usage](https://onnxruntime.ai/docs/get-started/with-python.html)
- [AWS Lambda Python images and local invocation](https://docs.aws.amazon.com/lambda/latest/dg/python-image.html)
