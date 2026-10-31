# PaddleOCR service

This Python service performs **real PaddleOCR inference** on one PNG or JPEG image. It extracts text and recognition confidence only. It does not verify a prescriber's identity, prescription authenticity, legal validity, dose, interactions, or suitability for dispensing.

The Next.js staff API sends the image here from the server. Uploaded documents are decoded in memory and are not saved, logged, or sent to a model provider. The first startup downloads the two public PaddleOCR model weights; later inference runs locally. Use fictional documents in this capstone demonstration.

## Local setup (Windows PowerShell)

From the repository root, with Python 3.11 installed:

```powershell
py -3.11 -m venv services/paddleocr/.venv
services/paddleocr/.venv/Scripts/python.exe -m pip install -r services/paddleocr/requirements.txt
services/paddleocr/.venv/Scripts/python.exe services/paddleocr/app.py
```

The service binds only `127.0.0.1:8001` by default. Model download/warmup finishes before `/health` returns ready. Keep this terminal running while using the app. No API key is needed for local inference. The virtual environment and runtime artifacts are ignored by the service's `.gitignore`.

On macOS/Linux use `python3.11 -m venv services/paddleocr/.venv`, then `.venv/bin/python` instead of `.venv/Scripts/python.exe`.

Configure the **Next.js server**, not the browser, with `PADDLEOCR_SERVICE_URL=http://127.0.0.1:8001`. Check the app's `.env.example` for the exact app-side configuration. Do not expose the service URL or bearer token with `NEXT_PUBLIC_` variables.

## Service contract

- `GET /health`: `{ "status": "ready", "engine": "PaddleOCR" }` after the models have initialized.
- `POST /ocr`: raw image bytes, with `Content-Type: image/png` or `image/jpeg`. It is not multipart/form-data.
- If configured, use `Authorization: Bearer <PADDLEOCR_SERVICE_TOKEN>`.
- Success returns `{ engine, model, lines: [{ text, confidence, box }], durationMs, image: { width, height } }`.
- Confidence is the model's recognition score in `[0,1]`, **not** a clinical or authenticity probability. Boxes are four `[x,y]` coordinates in the returned image's pixel space.
- Maximum upload: 4 MiB. Images are limited to 16 million pixels, 8,000 pixels per side, one frame, 500 recognized lines, and 60,000 text characters. Box coordinates are clamped to image bounds. EXIF orientation is applied, and transparent backgrounds are composited onto white.
- One image is processed at a time. Busy requests return 429; malformed/unsupported/oversized images return 400/415/413/422. Errors never include recognized text or underlying exception details.
- All responses use `Cache-Control: no-store`; HTTP access logs and interactive API docs are disabled.

`PADDLEOCR_PORT` overrides port 8001. `PADDLEOCR_HOST` overrides the loopback bind. Any non-loopback bind requires `PADDLEOCR_SERVICE_TOKEN` with at least 32 characters. Even if a custom launcher binds publicly, unauthenticated requests from non-loopback clients are rejected. The token is a server secret, never an upload form value.

## Test the local service

```powershell
services/paddleocr/.venv/Scripts/python.exe -m pip install -r services/paddleocr/requirements-test.txt
services/paddleocr/.venv/Scripts/python.exe -m pytest services/paddleocr/test_app.py -q
services/paddleocr/.venv/Scripts/python.exe services/paddleocr/smoke_test.py
```

The unit tests inject a small fake engine to exercise HTTP, image decoding, and concurrency boundaries. The smoke test sends the included fictional Ontario prescription to the **running real engine**, checks response structure and key extracted fields, and prints only a compact result. It does not create or change a pharmacy case. Its optional `--save` path writes the fictional OCR output for development evidence; the running service itself never writes uploads or responses to disk.

## Container deployment

Vercel hosts the Next.js page, but the Python inference service needs its own container or VM with sufficient memory for PaddlePaddle. Do not add the Python environment or model weights to the Next.js deployment.

```text
docker build -t pharmacy-paddleocr services/paddleocr
docker run --rm -p 127.0.0.1:8001:8001 --env PADDLEOCR_SERVICE_TOKEN pharmacy-paddleocr
```

The image predownloads the pinned model pair during build and runs as the non-root `ocr` user (UID 10001). Its home and application directory are created with the correct ownership before model initialization. Runtime model-host connectivity checks are disabled because the weights are already bundled; rebuilding still needs access to the package and model hosts.

Set `PADDLEOCR_SERVICE_TOKEN` in the calling shell before `docker run`; the `--env` option above passes its value without including it in the command arguments. For hosted deployments use the platform's secret manager, supply the same value to the Next.js server, and expose the container only through an authenticated HTTPS endpoint. Set request/body/time limits at the reverse proxy as well. Do not publish an unauthenticated OCR service.

To test alongside a local service already using port 8001, publish `127.0.0.1:8002:8001` instead and run the existing smoke test with `--url http://127.0.0.1:8002`. The smoke test must inherit the same service token. `/health` intentionally needs no token so container health checks can run; `/ocr` requires the token for the container's non-loopback bind.

Local container validation passed on Docker Desktop Linux/amd64 with `--cpus 2 --memory 2g --cap-drop ALL --security-opt no-new-privileges`: the health endpoint became ready in 6.02 seconds, Docker reported `healthy`, and the fictional 1700 x 2200 Ontario PNG produced 30 OCR lines in 13,915 ms with every expected demo label found. Missing and incorrect tokens returned 401. The process ran as UID 10001, `pip check` found no broken requirements, and memory after inference was 424.9 MiB. These are single-document local observations, not peak-memory or hosted-performance guarantees. The tested image occupied 1,663,184,572 bytes (about 1.55 GiB); the temporary test containers were stopped and removed after validation.

## Versions and model choice

The direct dependencies are pinned in `requirements.txt`. The runtime uses PaddlePaddle 3.2.0 and PaddleOCR 3.3.2, with `PP-OCRv5_mobile_det` and `en_PP-OCRv5_mobile_rec`. Document orientation classification, unwarping, and text-line orientation are disabled. MKL-DNN is disabled for predictable CPU behavior across Windows and Linux.

Official references:

- [PaddleOCR installation and Python quick start](https://www.paddleocr.ai/latest/en/quick_start.html)
- [OCR pipeline parameters, result arrays, and model choices](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html)
