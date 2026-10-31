"""Shared full-page preprocessing; no files, network calls, or image logging."""
import io
import warnings

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

LABELS = ["real", "fake"]
PREPROCESSING = "rgb-exif-white-letterbox224-bilinear-imagenet-v1"
MAX_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 16_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class InputError(ValueError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def decode_image(payload, content_type):
    if content_type not in {"image/png", "image/jpeg"}:
        raise InputError(415, "Use a PNG or JPEG image.")
    if len(payload) > MAX_BYTES:
        raise InputError(413, "The image must be 4 MiB or smaller.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload), formats=["PNG", "JPEG"]) as probe:
                if probe.format != {"image/png": "PNG", "image/jpeg": "JPEG"}[content_type]:
                    raise InputError(415, "The image format does not match its content type.")
                width, height = probe.size
                if width * height > MAX_PIXELS or max(width, height) > 8000:
                    raise InputError(413, "Use at most 16 megapixels and 8,000 pixels per side.")
                if getattr(probe, "n_frames", 1) != 1:
                    raise InputError(415, "Use a single-frame image.")
                probe.verify()
            with Image.open(io.BytesIO(payload), formats=["PNG", "JPEG"]) as original:
                rgba = ImageOps.exif_transpose(original).convert("RGBA")
                background = Image.new("RGBA", rgba.size, "white")
                background.alpha_composite(rgba)
                return background.convert("RGB")
    except InputError:
        raise
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError,
            Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise InputError(422, "The image could not be decoded.") from None


def preprocess(payload, content_type):
    image = decode_image(payload, content_type)
    scale = 224 / max(image.size)
    size = tuple(max(1, round(side * scale)) for side in image.size)
    resized = image.resize(size, Image.Resampling.BILINEAR)
    page = Image.new("RGB", (224, 224), "white")
    page.paste(resized, ((224 - size[0]) // 2, (224 - size[1]) // 2))
    pixels = np.asarray(page, dtype=np.float32) / np.float32(255)
    pixels = (pixels - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
    return np.ascontiguousarray(pixels.transpose(2, 0, 1))
