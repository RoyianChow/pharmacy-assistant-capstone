# Synthetic prescription alteration demo

The browser runs the trained ResNet18 model when someone clicks **Classify demo sample** on `/prescriptions`. The model compares visual alterations in a pair of fictional documents. Verifying real prescriptions requires independent evidence and pharmacist review.

## Run the browser demo

1. Install the app dependencies following the [project README](../README.md#getting-started) and run `npm run dev:prescriptions` from the repository root (`npm.cmd run dev:prescriptions` in Windows PowerShell).
2. Open [the local page](http://localhost:3001/prescriptions). On the [Vercel site](https://pharmacy-assistant-capstone.vercel.app/prescriptions), sign in with an approved staff account. The isolated local launcher uses the development demo access mode.
3. Choose **Load original demo** or **Load altered demo** and confirm the fictional image. Follow **Go to alteration demo** and select **Classify demo sample** to see the predicted class and both scores. Selecting a different image clears the result and acknowledgement.

The first classification checks the selected image against the two [sample hashes](../public/demo/classifier/manifest.json). A matching file triggers the download of the model (44,793,317 bytes) and the ONNX Runtime WebAssembly binary (14,848,852 bytes), plus the JavaScript needed to run them. These static assets come from the same website. The trained model is downloadable by design. The browser verifies its SHA-256 hash, reuses the loaded model across predictions, and can cache the versioned assets between visits. A new browser profile or an evicted cache can require another download.

Predictions run on the device. The fictional image and scores stay in page memory. The website requires neither an AWS account nor a running Python service for classification. **Extract with PaddleOCR** is a separate action that sends the selected fictional image to the configured OCR service. Use **Load Ontario demo** to try OCR.

## Model and evaluation

Model `resnet18-caf5359a14d1` was trained using 384 fictional images across eight template IDs. Each original and its paired alteration stayed in the same split, with 192 training, 96 validation and 96 test images. The public demo pair was selected before training. Both classes have the same demo watermark. See the [training, export and evaluation guide](../services/prescription-classifier/README.md) to reproduce the model.

| Actual class in the held-out synthetic test set | Predicted original | Predicted altered |
| --- | ---: | ---: |
| Original | 47 | 1 |
| Altered | 17 | 31 |

The model achieved 81.25% accuracy and detected 31 of 48 alterations (64.58%). All examples came from the same generator. The model scores describe these visual classes and provide no evidence of prescriber authorization. The project’s dataset review found transcription labels in the [Mendeley prescription dataset](https://data.mendeley.com/datasets/tg2hm7n2bs/1), general text edits in [DocTamper](https://github.com/qcf-568/DocTamper), and structured records in a [prescription fraud study](https://pmc.ncbi.nlm.nih.gov/articles/PMC6279664/). None supplied verified prescription-image authenticity labels for this model.

Chrome and the Python/ONNX reference both predicted **Original sample** with an original score of **0.5481** and **Altered sample** with an altered score of **0.5665** for the two published images. Browser tests verified those scores to four decimal places, rejection of the Ontario OCR sample before downloading model weights, recovery from a failed download, and correct result replacement when switching samples mid-download. Classifying either image produced no upload.

## Optional server API

The separate `/api/prescriptions/classify` endpoint remains available for clients that explicitly call it. The website’s Classify button uses the browser model regardless of server configuration. The API supports a loopback Lambda emulator in local development and a private Lambda invocation using Vercel OIDC in an independently configured deployment.

- `GET` returns `{ configured, mode }`. `POST` requires staff access, a same-origin request, fictional-data acknowledgement and raw PNG/JPEG bytes up to 4 MiB. The synthetic response includes `original_demo` and `altered_demo` scores, `authenticityAssessed: false` and `reviewRequired: true`.
- To test the API locally, follow the [Python service guide](../services/prescription-classifier/README.md) to start the emulator. Set `PRESCRIPTION_CLASSIFIER_LOCAL_URL=http://127.0.0.1:8003/2015-03-31/functions/function/invocations` in the process environment before starting the development app. The API rejects unrelated images with HTTP 422.
- For a private AWS deployment, the [registry template](../infra/aws/classifier-registry.json) creates ECR storage. Build and push the reviewed Linux/amd64 image, then deploy the [inference stack](../infra/aws/classifier-stack.json) with the immutable image digest, Vercel team slug and project name. The stack supports reuse of an existing team OIDC provider and grants the production project access to invoke the named function. Its outputs supply the server-only variables `PRESCRIPTION_CLASSIFIER_AWS_REGION`, `PRESCRIPTION_CLASSIFIER_FUNCTION_NAME` and `PRESCRIPTION_CLASSIFIER_AWS_ROLE_ARN`. See [Vercel’s AWS OIDC instructions](https://vercel.com/docs/oidc/aws).
- The optional stack reserves up to 500 inference attempts per function per UTC month using an atomic DynamoDB update. Failed attempts after reservation count. The guard returns 429 at the limit and 503 if the counter is unavailable. The US$5/month demo budget is a planning target. Storage, logs and other requests can still accrue charges. The browser workflow has no AWS inference charge.

Earlier local testing of the Python service and optional Lambda API passed 86 Python tests, including 42 for the monthly counter. The Docker emulator returned both reference predictions and rejected the Ontario OCR sample. Those checks cover the server implementation.
