"""Exercise the local Lambda emulator without pretending a trained model exists."""
import argparse
import base64
import io
import json
import urllib.request

from PIL import Image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8003")
    args = parser.parse_args()
    output = io.BytesIO()
    Image.new("RGB", (40, 80), "white").save(output, "PNG")
    valid = {"schemaVersion": 1, "contentType": "image/png", "imageBase64": base64.b64encode(output.getvalue()).decode()}
    cases = [("unavailable_model", valid, 503), ("bad_schema", {**valid, "schemaVersion": 2}, 400),
             ("bad_base64", {**valid, "imageBase64": "%%%"}, 400),
             ("unsupported_type", {**valid, "contentType": "application/pdf"}, 415),
             ("invalid_image", {**valid, "imageBase64": base64.b64encode(b"not an image").decode()}, 422)]
    results = {}
    for name, event, expected in cases:
        request = urllib.request.Request(args.url.rstrip("/") + "/2015-03-31/functions/function/invocations",
                                         data=json.dumps(event).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            actual = json.load(response)
        assert actual["statusCode"] == expected, (name, actual)
        results[name] = actual["statusCode"]
    print(json.dumps({"lambdaEmulatorChecks": results, "classificationValidated": False}))


if __name__ == "__main__":
    main()
