"""Small, private PaddleOCR image service. Never store or log uploaded documents."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import io
import math
import os
import time
import warnings

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_SIDE = 8000
MAX_LINES = 500
MAX_TEXT_CHARS = 60_000
MODEL_NAME = "PP-OCRv5_mobile_det + en_PP-OCRv5_mobile_rec"
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
SAFE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def service_settings() -> tuple[str, int, str]:
    host = os.getenv("PADDLEOCR_HOST", "127.0.0.1")
    port = int(os.getenv("PADDLEOCR_PORT", "8001"))
    token = os.getenv("PADDLEOCR_SERVICE_TOKEN", "")
    if host not in {"127.0.0.1", "::1", "localhost"} and len(token) < 32:
        raise RuntimeError("A service token of at least 32 characters is required for a non-loopback bind.")
    if token and len(token) < 32:
        raise RuntimeError("The configured service token must be at least 32 characters.")
    return host, port, token


def load_engine():
    # The default pipeline uses larger models and extra orientation stages.
    # Keep the exact lightweight English model pair explicit and reproducible.
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="en_PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
        cpu_threads=4,
        enable_mkldnn=False,
    )


def decode_image(payload: bytes, mime: str):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload), formats=["PNG", "JPEG"]) as probe:
                if probe.format != {"image/png": "PNG", "image/jpeg": "JPEG"}[mime]:
                    raise HTTPException(415, "The image format does not match its content type.")
                width, height = probe.size
                if width < 1 or height < 1 or max(width, height) > MAX_SIDE or width * height > MAX_PIXELS:
                    raise HTTPException(413, "Use an image of at most 16 megapixels and 8,000 pixels per side.")
                if getattr(probe, "n_frames", 1) != 1:
                    raise HTTPException(415, "Use a single-page PNG or JPEG image.")
                probe.verify()
            with Image.open(io.BytesIO(payload), formats=["PNG", "JPEG"]) as original:
                oriented = ImageOps.exif_transpose(original)
                # Composite transparent PNGs onto white, then discard image metadata.
                rgba = oriented.convert("RGBA")
                white = Image.new("RGBA", rgba.size, "white")
                white.alpha_composite(rgba)
                return white.convert("RGB")
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "The image could not be decoded. Upload a readable PNG or JPEG.") from None


def recognize(engine, payload: bytes, mime: str) -> dict:
    import numpy as np

    image = decode_image(payload, mime)
    width, height = image.size
    pixels = np.ascontiguousarray(np.asarray(image)[:, :, ::-1])
    started = time.perf_counter()
    results = list(engine.predict(pixels))
    lines = []
    text_chars = 0
    for result in results:
        for text, score, polygon in zip(result["rec_texts"], result["rec_scores"], result["rec_polys"]):
            text = str(text).strip()
            confidence = float(score)
            if not text or not math.isfinite(confidence):
                continue
            raw_box = [[float(point[0]), float(point[1])] for point in polygon]
            if len(raw_box) != 4 or not all(math.isfinite(coordinate) for point in raw_box for coordinate in point):
                continue
            box = [[round(max(0, min(width, point[0])), 2), round(max(0, min(height, point[1])), 2)] for point in raw_box]
            text = text[:2000]
            text_chars += len(text)
            lines.append({"text": text, "confidence": round(max(0, min(1, confidence)), 6), "box": box})
            if len(lines) > MAX_LINES or text_chars > MAX_TEXT_CHARS:
                raise HTTPException(422, "This image has too much text. Upload one prescription page.")
    return {
        "engine": "PaddleOCR",
        "model": MODEL_NAME,
        "lines": lines,
        "durationMs": round((time.perf_counter() - started) * 1000),
        "image": {"width": width, "height": height},
    }


def create_app(engine=None, token: str | None = None) -> FastAPI:
    _, _, configured_token = service_settings()
    expected_token = configured_token if token is None else token

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = engine if engine is not None else await asyncio.to_thread(load_engine)
        app.state.busy = asyncio.Lock()
        yield
        app.state.engine = None

    app = FastAPI(title="Private prescription OCR", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def request_error(_request, error: HTTPException):
        return JSONResponse({"error": error.detail}, status_code=error.status_code, headers=SAFE_HEADERS)

    @app.get("/health")
    async def health():
        return JSONResponse({"status": "ready", "engine": "PaddleOCR"}, headers=SAFE_HEADERS)

    @app.post("/ocr")
    async def ocr(request: Request):
        supplied = request.headers.get("authorization", "")
        if expected_token and not hmac.compare_digest(supplied.encode("utf-8"), f"Bearer {expected_token}".encode("utf-8")):
            raise HTTPException(401, "OCR service authentication is required.")
        if not expected_token and (not request.client or request.client.host not in {"127.0.0.1", "::1"}):
            raise HTTPException(403, "A service token is required for remote OCR requests.")
        mime = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if mime not in {"image/png", "image/jpeg"}:
            raise HTTPException(415, "Upload a PNG or JPEG image.")
        if request.headers.get("content-encoding", "identity") != "identity":
            raise HTTPException(415, "Compressed request bodies are not supported.")
        length = request.headers.get("content-length")
        if length is not None:
            if not length.isdecimal():
                raise HTTPException(400, "Invalid image request length.")
            if int(length) > MAX_BYTES:
                raise HTTPException(413, "The image must be 4 MB or smaller.")
        if app.state.busy.locked():
            raise HTTPException(429, "OCR is busy. Please try again shortly.")
        chunks = bytearray()
        try:
            async with asyncio.timeout(15):
                async for chunk in request.stream():
                    if len(chunks) + len(chunk) > MAX_BYTES:
                        raise HTTPException(413, "The image must be 4 MB or smaller.")
                    chunks.extend(chunk)
        except TimeoutError:
            raise HTTPException(408, "The image upload took too long.") from None
        if not chunks:
            raise HTTPException(400, "Choose an image before requesting OCR.")
        if app.state.busy.locked():
            raise HTTPException(429, "OCR is busy. Please try again shortly.")
        async with app.state.busy:
            try:
                result = await asyncio.to_thread(recognize, app.state.engine, bytes(chunks), mime)
                return JSONResponse(result, headers=SAFE_HEADERS)
            except HTTPException:
                raise
            except Exception:
                # Never return/log exception bodies: models may include input details.
                raise HTTPException(503, "Text extraction is temporarily unavailable. Please try again.") from None

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    bind, service_port, _ = service_settings()
    uvicorn.run(app, host=bind, port=service_port, access_log=False, log_level="warning")
