# Prescription verification demonstration

The staff page at `/prescriptions` supports text extraction and manual comparison of **fictional typed prescriptions**. It does not decide whether a prescription is valid, authentic, appropriate, or safe to dispense. A pharmacist's authenticity and appropriateness checks remain separate from document recognition; see the [Ontario College of Pharmacists guidance on electronically generated prescriptions](https://www.ocpinfo.com/wp-content/uploads/documents/Navigating_Electronically_Generated_Prescriptions.pdf).

## Run locally

1. Follow the Python 3.11 virtual-environment and package installation steps in [the service README](../services/paddleocr/README.md).
2. In one terminal at the repository root, run `npm.cmd run ocr:serve`.
3. In another terminal, run `npm.cmd run dev:prescriptions`.
4. Visit `http://localhost:3001/prescriptions` (use `localhost`, which matches Next.js development request origins). Load the Ontario demo, acknowledge that its details are fictional, then choose **Extract with PaddleOCR**.
5. Compare the extracted patient, date, prescriber, medication, and other fields against the image. Open **Original OCR text** to inspect the full recognition result. Comparison checkboxes are temporary UI marks, not a saved pharmacist decision.
6. Return to **Pharmacy dashboard** in the same tab. Its prescription verification section links back to this page and shows the number of successful extractions, the latest extracted/total fields, fields flagged or missing, and the last scan time/duration. The OCR badge reports configuration, not live model health.

Only aggregate counts and timing are stored in this tab's `sessionStorage`; no image, file name, OCR text, patient/prescriber identity, or field values are stored there. These are local activity totals, not shared pharmacy records or a clinical audit log. They survive a same-tab reload, remain separate from assessment counts, and end with the browser session. If browser storage is unavailable, OCR still works but the overview cannot retain activity. A scan contributes only after a successful, validated response; retries that fail do not increment the count.

The local launcher binds Next.js to loopback, clears remote database/Auth variables in its child process, and chooses a separate local SQLite path. It uses the application's existing local demo access rule. It does not edit `.env.local`, modify hosted access, or contact the hosted database. The Python service also binds to loopback. Neither service persists prescription uploads or results.

For normal `npm run dev` with staff sign-in, add `PADDLEOCR_SERVICE_URL=http://127.0.0.1:8001` to the existing `.env.local` without replacing its other settings, then restart Next.js. An optional `PADDLEOCR_SERVICE_TOKEN` must match in both processes; the Python launcher reads process environment variables, not Next.js dotenv files.

## Demo files

- [Ontario-style demo PNG](../public/demo/ontario-demo-prescription.png): 1700 × 2200 pixels, used for real inference.
- [Ontario-style demo PDF](../public/demo/ontario-demo-prescription.pdf): printable Letter page; PDF upload is not supported.
- [Generator](../scripts/generate-prescription-demo.py): recreates both artifacts with ReportLab and Poppler.

Every person, clinic, medication and credential in the sample is fictional. The document is unsigned and visibly marked **DEMO — NOT VALID FOR DISPENSING**. The invalid licence and fictional medication are intentional; this is an OCR fixture, not a usable prescription template.

## Request flow and limits

```text
Browser → staff-protected Next.js API → private Python PaddleOCR service
        ← fields, warnings, original OCR text and recognition confidence
```

`GET /api/prescriptions/verify` reports configuration availability and accepted image limits. It does not probe model readiness or expose service credentials. `POST` requires staff access (except the existing local demo mode), a same-origin request, `X-Demo-Consent: true`, and raw PNG/JPEG bytes. Files are capped at 4 MiB. The Python service fully decodes the image and also enforces pixel, frame, text, and concurrency limits. See its README for the exact service contract.

The adapter uses an 80-second provider deadline; the page has a 90-second request deadline. Invalid images, unavailable services, and malformed responses produce recoverable errors while keeping the selected image. Model initialization can take longer on first startup; wait for `/health` to report ready before extracting.

Twelve labelled fields are extracted with deterministic rules: patient, date of birth, issue date, prescriber, licence, clinic phone, medication, strength, directions, quantity, refills, and signature. Split OCR boxes on the same row are joined. Conflicting repeated values remain unset. Unlabelled, handwritten, multi-column, rotated, blurry, or unusual layouts may produce incomplete results. A missing field means the extractor did not reliably locate it; it is not a legal determination about the document. No medication meaning or missing clinical facts are inferred.

Recognition confidence describes how the OCR model read text. It does not measure clinical correctness. Every result requires human review, including high-confidence text. No prescription approval, clinical checking, database record, or dispensing authorization is created.

## Validation

```powershell
npm.cmd test
npm.cmd run build
services/paddleocr/.venv/Scripts/python.exe -m pytest services/paddleocr/test_app.py -q
services/paddleocr/.venv/Scripts/python.exe services/paddleocr/smoke_test.py
```

Node tests cover extraction, ambiguity, malformed responses, authentication, origin/consent checks, upload limits, and sanitized failures. Python tests cover real image decoding, input limits, authorization, output bounds, and concurrency with a test engine. The separate smoke test calls the **running real PaddleOCR model** against the PNG fixture; it is not an inference mock.

Local verification on 2026-10-31: production build and lint passed; 120 Node tests and 12 Python tests passed. Real model inference recognized 30 lines and all 12 expected labelled fields. Browser checks passed for both the built-in demo loader and an uploaded PNG (approximately 15 seconds each), raw-text expansion, comparison marks, and clearing prior results/consent on document removal. This confirms the provided fixture and interface flow, not general OCR accuracy or clinical validity.

## Hosting later

The current implementation is tested locally. Vercel cannot reach `127.0.0.1:8001` on your computer. Host the Python service separately on a suitable CPU container/VM, then configure the Next.js server with an HTTPS `PADDLEOCR_SERVICE_URL` (base URL without `/ocr`) and matching strong `PADDLEOCR_SERVICE_TOKEN`. A non-loopback Python bind requires a token of at least 32 characters. Keep these settings server-only, preserve the existing Neon staff allowlist, and keep using fictional documents. The supplied Dockerfile is a deployment starting point and has not been tested with a hosted provider.

The implementation uses the [official PaddleOCR pipeline](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html) with explicit English mobile models. Version pins and model details are in the service README.
