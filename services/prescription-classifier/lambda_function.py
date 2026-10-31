"""Private, direct AWS Lambda invocation. Never log or retain uploaded images."""
import base64
import binascii
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import time

import numpy as np

from preprocess import DEMO_LABELS, InputError, LABELS, MAX_BYTES, PREPROCESSING, preprocess
from cost_guard import CostGuardUnavailable, MonthlyLimitExceeded, reserve_inference_attempt


@lru_cache(maxsize=1)
def load_metadata():
    directory = Path(os.getenv("MODEL_DIR", "/var/task/model"))
    metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
    mode = os.getenv("CLASSIFIER_DEPLOYMENT_MODE", "research_training")
    if mode not in {"research_training", "synthetic_demo"}:
        raise ValueError("Unknown deployment mode.")
    labels = DEMO_LABELS if mode == "synthetic_demo" else LABELS
    validation = "synthetic_demo_only" if mode == "synthetic_demo" else "research_only"
    if (metadata.get("schemaVersion") != 1 or metadata.get("trainingCompleted") is not True
            or metadata.get("trainingPurpose") != mode
            or metadata.get("labels") != labels or metadata.get("architecture") != "resnet18"
            or metadata.get("preprocessing") != PREPROCESSING
            or metadata.get("validationStatus") != validation
            or not re.fullmatch(r"resnet18-[a-f0-9]{12}", str(metadata.get("modelVersion", "")))):
        raise ValueError("No compatible artifact for this deployment mode.")
    if mode == "synthetic_demo":
        allowed = metadata.get("allowedImageSha256")
        if (metadata.get("authenticityAssessed") is not False or not isinstance(allowed, list)
                or not 1 <= len(allowed) <= 10000
                or not all(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) for value in allowed)):
            raise ValueError("A synthetic fixture allowlist is required.")
    return metadata


@lru_cache(maxsize=1)
def load_model():
    metadata = load_metadata()
    directory = Path(os.getenv("MODEL_DIR", "/var/task/model"))
    model_bytes = (directory / "model.onnx").read_bytes()
    digest = hashlib.sha256(model_bytes).hexdigest()
    if digest != metadata.get("modelSha256") or metadata["modelVersion"] != f"resnet18-{digest[:12]}":
        raise ValueError("Artifact integrity check failed.")
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 4
    session = ort.InferenceSession(model_bytes, sess_options=options, providers=["CPUExecutionProvider"])
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if (len(inputs) != 1 or inputs[0].name != "image" or inputs[0].shape != [1, 3, 224, 224]
            or inputs[0].type != "tensor(float)" or len(outputs) != 1
            or outputs[0].name != "logits" or outputs[0].shape != [1, 2]):
        raise ValueError("Unsupported model contract.")
    return session, metadata


def handler(event, _context):
    started = time.perf_counter()
    try:
        if not isinstance(event, dict) or type(event.get("schemaVersion")) is not int or event["schemaVersion"] != 1:
            raise InputError(400, "Use request schema version 1.")
        content_type = event.get("contentType")
        if not isinstance(content_type, str) or content_type not in {"image/png", "image/jpeg"}:
            raise InputError(415, "Use a PNG or JPEG image.")
        encoded = event.get("imageBase64")
        if not isinstance(encoded, str) or not encoded:
            raise InputError(400, "An image is required.")
        if len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
            raise InputError(413, "The image must be 4 MiB or smaller.")
        try:
            payload = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            raise InputError(400, "The image encoding is invalid.") from None
        if base64.b64encode(payload).decode("ascii") != encoded:
            raise InputError(400, "The image encoding is invalid.")
        image = preprocess(payload, content_type)[None]
        metadata = load_metadata()
        synthetic = metadata["trainingPurpose"] == "synthetic_demo"
        if synthetic and hashlib.sha256(payload).hexdigest() not in metadata["allowedImageSha256"]:
            raise InputError(422, "This demo accepts only its generated fictional sample images.")
        reserve_inference_attempt()
        session, metadata = load_model()
        logits = np.asarray(session.run(["logits"], {"image": image})[0], dtype=np.float64)
        if logits.shape != (1, 2) or not np.isfinite(logits).all():
            raise ValueError("Invalid model output.")
        scores = np.exp(logits[0] - logits.max())
        scores /= scores.sum()
        labels = DEMO_LABELS if synthetic else LABELS
        body = {"schemaVersion": 2 if synthetic else 1, "modelVersion": metadata["modelVersion"],
                "predictedLabel": labels[0] if scores[0] > scores[1] else labels[1],
                "scores": dict(zip(labels, map(float, scores))), "reviewRequired": True,
                "validationStatus": "synthetic_demo_only" if synthetic else "research_only",
                "durationMs": round((time.perf_counter() - started) * 1000)}
        if synthetic:
            body.update(mode="synthetic_demo", authenticityAssessed=False)
        return {"statusCode": 200, "body": body}
    except MonthlyLimitExceeded:
        return {"statusCode": 429, "body": {"error": "The monthly demo request limit has been reached."}}
    except CostGuardUnavailable:
        return {"statusCode": 503, "body": {"error": "The classifier is temporarily unavailable."}}
    except InputError as error:
        return {"statusCode": error.status, "body": {"error": str(error)}}
    except Exception:
        return {"statusCode": 503, "body": {"error": "The research classifier is unavailable. Pharmacist review is required."}}
