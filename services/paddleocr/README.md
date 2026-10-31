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

The image predownloads the pinned model pair during build and runs as a non-root user. Set a strong service token in the hosting platform's secret manager, supply the same value to the Next.js server, and expose the container only through an authenticated HTTPS endpoint. Keep model downloads permitted while building the image. Set request/body/time limits at the reverse proxy as well. Do not publish an unauthenticated OCR service.

## Versions and model choice

The direct dependencies are pinned in `requirements.txt`. The runtime uses PaddlePaddle 3.2.0 and PaddleOCR 3.3.2, with `PP-OCRv5_mobile_det` and `en_PP-OCRv5_mobile_rec`. Document orientation classification, unwarping, and text-line orientation are disabled. MKL-DNN is disabled for predictable CPU behavior across Windows and Linux.

Official references:

- [PaddleOCR installation and Python quick start](https://www.paddleocr.ai/latest/en/quick_start.html)
- [OCR pipeline parameters, result arrays, and model choices](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html)
