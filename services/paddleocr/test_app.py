import io
import threading

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image
import pytest

import app as service


class FakeEngine:
    def predict(self, image):
        assert image.shape == (60, 120, 3)
        return [{"rec_texts": ["Patient: Demo Example"], "rec_scores": [0.98], "rec_polys": [np.array([[1, 2], [100, 2], [100, 30], [1, 30]])]}]


def png(width=120, height=60):
    output = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(output, "PNG")
    return output.getvalue()


@pytest.fixture
def client():
    with TestClient(service.create_app(FakeEngine(), token=""), client=("127.0.0.1", 50000)) as connection:
        yield connection


def test_contract_and_no_store(client):
    result = client.post("/ocr", content=png(), headers={"Content-Type": "image/png"})
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    assert result.json()["image"] == {"width": 120, "height": 60}
    assert result.json()["engine"] == "PaddleOCR"
    assert result.json()["lines"] == [{"text": "Patient: Demo Example", "confidence": 0.98, "box": [[1.0, 2.0], [100.0, 2.0], [100.0, 30.0], [1.0, 30.0]]}]


def test_empty_and_invalid_images(client):
    assert client.post("/ocr", content=b"", headers={"Content-Type": "image/png"}).status_code == 400
    invalid = client.post("/ocr", content=b"private document contents", headers={"Content-Type": "image/png"})
    assert invalid.status_code == 422
    assert "private document contents" not in invalid.text
    assert client.post("/ocr", content=png(), headers={"Content-Type": "application/pdf"}).status_code == 415
    assert client.post("/ocr", content=png(), headers={"Content-Type": "image/jpeg"}).status_code == 415


def test_body_limits_for_declared_and_streamed_lengths(client):
    assert client.post("/ocr", content=b"x", headers={"Content-Type": "image/png", "Content-Length": str(service.MAX_BYTES + 1)}).status_code == 413
    oversized = (b"x" * (1024 * 1024) for _ in range(5))
    assert client.post("/ocr", content=oversized, headers={"Content-Type": "image/png"}).status_code == 413


def test_image_dimensions_are_bounded(client):
    assert client.post("/ocr", content=png(8001, 1), headers={"Content-Type": "image/png"}).status_code == 413


def test_model_boxes_are_clamped_to_image_bounds():
    class EdgeEngine(FakeEngine):
        def predict(self, image):
            result = super().predict(image)[0]
            result["rec_polys"] = [np.array([[-1, -2], [121, 0], [121, 61], [0, 61]])]
            return [result]

    result = service.recognize(EdgeEngine(), png(), "image/png")
    assert result["lines"][0]["box"] == [[0, 0], [120, 0], [120, 60], [0, 60]]


@pytest.mark.parametrize("count,text", [(501, "line"), (31, "x" * 2000)])
def test_excessive_model_text_is_rejected(count, text):
    class VerboseEngine(FakeEngine):
        def predict(self, image):
            result = super().predict(image)[0]
            return [{"rec_texts": [text] * count, "rec_scores": [0.9] * count, "rec_polys": result["rec_polys"] * count}]

    with TestClient(service.create_app(VerboseEngine(), token=""), client=("127.0.0.1", 50000)) as client:
        assert client.post("/ocr", content=png(), headers={"Content-Type": "image/png"}).status_code == 422


def test_optional_token_is_enforced_and_never_returned():
    token = "test-service-secret-" + "x" * 32
    with TestClient(service.create_app(FakeEngine(), token=token)) as client:
        for auth in ["", "Bearer wrong-token", "Bearer non-ascii-\u00e9"]:
            headers = {"Content-Type": "image/png"}
            if auth:
                headers["Authorization"] = auth.encode("utf-8")
            response = client.post("/ocr", content=png(), headers=headers)
            assert response.status_code == 401
            assert token not in response.text
        assert client.post("/ocr", content=png(), headers={"Content-Type": "image/png", "Authorization": f"Bearer {token}"}).status_code == 200


def test_remote_requests_cannot_use_unauthenticated_mode():
    with TestClient(service.create_app(FakeEngine(), token=""), client=("192.0.2.1", 50000)) as client:
        assert client.post("/ocr", content=png(), headers={"Content-Type": "image/png"}).status_code == 403


def test_remote_bind_requires_long_token(monkeypatch):
    monkeypatch.setenv("PADDLEOCR_HOST", "0.0.0.0")
    monkeypatch.delenv("PADDLEOCR_SERVICE_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        service.service_settings()


def test_model_errors_are_sanitized(client, monkeypatch):
    def fail(*_args):
        raise RuntimeError("secret document content")
    monkeypatch.setattr(service, "recognize", fail)
    response = client.post("/ocr", content=png(), headers={"Content-Type": "image/png"})
    assert response.status_code == 503
    assert "secret document content" not in response.text


def test_concurrent_inference_is_rejected_without_second_model_call():
    entered = threading.Event()
    release = threading.Event()

    class BlockingEngine(FakeEngine):
        def predict(self, image):
            entered.set()
            assert release.wait(timeout=10)
            return super().predict(image)

    with TestClient(service.create_app(BlockingEngine(), token=""), client=("127.0.0.1", 50000)) as client:
        first = []
        thread = threading.Thread(target=lambda: first.append(client.post("/ocr", content=png(), headers={"Content-Type": "image/png"})))
        thread.start()
        try:
            assert entered.wait(timeout=5)
            assert client.post("/ocr", content=png(), headers={"Content-Type": "image/png"}).status_code == 429
        finally:
            release.set()
            thread.join(timeout=10)
        assert first[0].status_code == 200
