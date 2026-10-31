import base64
import csv
import hashlib
import io
import json

import numpy as np
from PIL import Image
import pytest

import lambda_function as runtime
from manifest import load_manifest
from preprocess import InputError, LABELS, MAX_BYTES, PREPROCESSING, decode_image, preprocess
from synthetic_fixture import generate


def png(size=(80, 160), mode="RGB", color="black"):
    output = io.BytesIO()
    Image.new(mode, size, color).save(output, "PNG")
    return output.getvalue()


def event(payload=None):
    return {"schemaVersion": 1, "contentType": "image/png", "imageBase64": base64.b64encode(payload or png()).decode()}


@pytest.fixture(autouse=True)
def reset_cache():
    runtime.load_model.cache_clear()
    yield
    runtime.load_model.cache_clear()


def test_full_page_letterbox_is_deterministic_and_not_a_crop():
    value = preprocess(png(), "image/png")
    assert value.shape == (3, 224, 224) and value.dtype == np.float32
    np.testing.assert_array_equal(value, preprocess(png(), "image/png"))
    np.testing.assert_allclose(value[:, 0, 0], (np.array([1, 1, 1]) - [.485, .456, .406]) / [.229, .224, .225], rtol=1e-6)
    assert np.all(value[:, :, 56:168] < 0)  # Entire portrait preserved, including top/bottom.
    assert np.all(value[:, :, :56] > 0)


def test_alpha_and_exif_are_applied_before_letterboxing():
    assert decode_image(png(mode="RGBA", color=(0, 0, 0, 0)), "image/png").getpixel((0, 0)) == (255, 255, 255)
    output = io.BytesIO()
    orientation = Image.Exif()
    orientation[274] = 6
    Image.new("RGB", (30, 60)).save(output, "JPEG", exif=orientation)
    assert decode_image(output.getvalue(), "image/jpeg").size == (60, 30)


@pytest.mark.parametrize("payload,mime,status", [(b"not an image", "image/png", 422),
    (png(), "image/jpeg", 415), (png((8001, 1)), "image/png", 413),
    (b"x" * (MAX_BYTES + 1), "image/png", 413)])
def test_invalid_or_oversized_images(payload, mime, status):
    with pytest.raises(InputError) as error:
        decode_image(payload, mime)
    assert error.value.status == status


@pytest.mark.parametrize("change,status", [({"schemaVersion": True}, 400), ({"schemaVersion": 2}, 400),
    ({"contentType": "application/pdf"}, 415), ({"contentType": []}, 415),
    ({"imageBase64": "%%%"}, 400), ({"imageBase64": "é"}, 400),
    ({"imageBase64": "YQ==\n"}, 400), ({"imageBase64": "Yf=="}, 400),
    ({"imageBase64": "A" * (4 * ((MAX_BYTES + 2) // 3) + 1)}, 413)])
def test_request_contract_rejects_bad_events(change, status):
    request = event()
    request.update(change)
    assert runtime.handler(request, None)["statusCode"] == status


def test_missing_artifact_returns_safe_503(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_DIR", str(tmp_path))
    result = runtime.handler(event(), None)
    assert result["statusCode"] == 503
    assert str(tmp_path) not in json.dumps(result)


def test_success_response_and_numerically_stable_scores(monkeypatch):
    class Session:
        def run(self, names, feed):
            assert names == ["logits"] and feed["image"].shape == (1, 3, 224, 224)
            return [np.array([[1000, 1002]], np.float32)]
    monkeypatch.setattr(runtime, "load_model", lambda: (Session(), {"modelVersion": "resnet18-0123456789ab"}))
    result = runtime.handler(event(), None)
    assert result["statusCode"] == 200
    assert result["body"]["predictedLabel"] == "fake"
    assert result["body"]["reviewRequired"] is True
    assert result["body"]["validationStatus"] == "research_only"
    assert sum(result["body"]["scores"].values()) == pytest.approx(1)
    assert result["body"]["scores"]["fake"] == pytest.approx(.880797078)


def test_exact_ties_resolve_to_fake(monkeypatch):
    class Session:
        def run(self, *_args):
            return [np.array([[0, 0]], np.float32)]
    monkeypatch.setattr(runtime, "load_model", lambda: (Session(), {"modelVersion": "resnet18-0123456789ab"}))
    assert runtime.handler(event(), None)["body"]["predictedLabel"] == "fake"


@pytest.mark.parametrize("mutation", [{"trainingPurpose": "pipeline_smoke_test"}, {"trainingCompleted": False},
    {"modelSha256": "0" * 64}, {"labels": ["fake", "real"]}, {"preprocessing": "wrong"}])
def test_unusable_artifacts_fail_closed(tmp_path, monkeypatch, mutation):
    payload = b"not a real model; artifact guard must run first"
    digest = hashlib.sha256(payload).hexdigest()
    metadata = {"schemaVersion": 1, "trainingCompleted": True, "trainingPurpose": "research_training",
                "architecture": "resnet18", "labels": LABELS, "preprocessing": PREPROCESSING,
                "validationStatus": "research_only", "modelSha256": digest, "modelVersion": f"resnet18-{digest[:12]}"}
    metadata.update(mutation)
    (tmp_path / "model.onnx").write_bytes(payload)
    (tmp_path / "metadata.json").write_text(json.dumps(metadata))
    monkeypatch.setenv("MODEL_DIR", str(tmp_path))
    assert runtime.handler(event(), None)["statusCode"] == 503


def mutate_manifest(directory, mutate):
    path = directory / "manifest.csv"
    with path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    mutate(rows)
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return path


@pytest.mark.parametrize("issue", ["group", "hash", "pixels", "conflicting_label", "provenance", "label", "missing_class", "outside"])
def test_manifest_blocks_leakage_and_invalid_provenance(tmp_path, issue):
    directory = tmp_path / "geometry"
    generate(directory)
    assert len(load_manifest(directory / "manifest.csv", "pipeline_smoke_test")) == 12
    def mutation(rows):
        if issue == "group":
            rows[4]["group_id"] = rows[0]["group_id"]
        elif issue in {"hash", "pixels", "conflicting_label"}:
            original = directory / rows[0]["path"]
            target = directory / rows[2 if issue == "conflicting_label" else 4]["path"]
            if issue in {"hash", "conflicting_label"}:
                target.write_bytes(original.read_bytes())
            else:
                with Image.open(original) as image:
                    image.save(target, "PNG", compress_level=0)
        elif issue == "provenance":
            rows[0]["verification_reference"] = ""
        elif issue == "label":
            rows[0]["label"] = "unknown"
        elif issue == "missing_class":
            for row in rows:
                if row["split"] == "val":
                    row["label"] = "real"
        else:
            rows[0]["path"] = "../outside.png"
    manifest = mutate_manifest(directory, mutation)
    with pytest.raises(ValueError):
        load_manifest(manifest, "pipeline_smoke_test")


def test_geometric_dataset_cannot_be_used_for_research_training(tmp_path):
    generate(tmp_path / "geometry")
    with pytest.raises(ValueError):
        load_manifest(tmp_path / "geometry/manifest.csv", "research_training")


def test_confusion_matrix_orientation_and_false_real_denominator():
    from train import metrics
    result = metrics([0, 0, 1, 1, 1], [0, 1, 0, 1, 1])
    assert result["matrixRowsActualColumnsPredicted"] == [[1, 1], [1, 2]]
    assert result["fakeRecall"] == pytest.approx(2 / 3)
    assert result["falseRealRate"] == pytest.approx(1 / 3)
    assert result["falseFakeRate"] == pytest.approx(1 / 2)
