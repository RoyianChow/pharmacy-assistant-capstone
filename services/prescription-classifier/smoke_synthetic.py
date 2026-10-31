"""Invoke the two preselected fictional samples through a local Lambda emulator."""
import argparse
import base64
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8003")
    parser.add_argument("--save", type=Path)
    args = parser.parse_args()
    target = urllib.parse.urlsplit(args.url)
    if target.scheme != "http" or target.hostname not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("This software smoke test is limited to a local emulator.")
    root = Path(__file__).resolve().parents[2]
    fixtures = root / "public/demo/classifier"
    manifest = json.loads((fixtures / "manifest.json").read_text(encoding="utf-8"))
    def invoke(event):
        request = urllib.request.Request(args.url.rstrip("/") + "/2015-03-31/functions/function/invocations",
                                         data=json.dumps(event).encode(), headers={"Content-Type": "application/json"})
        started = time.perf_counter()
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.load(response)
        return result, round((time.perf_counter() - started) * 1000)
    results = {}
    for expected, record in manifest["samples"].items():
        event = {"schemaVersion": 1, "contentType": "image/png",
                 "imageBase64": base64.b64encode((fixtures / record["file"]).read_bytes()).decode()}
        result, wall_ms = invoke(event)
        assert result["statusCode"] == 200, result
        body = result["body"]
        assert body["schemaVersion"] == 2 and body["mode"] == "synthetic_demo"
        assert body["authenticityAssessed"] is False and body["reviewRequired"] is True
        assert body["validationStatus"] == "synthetic_demo_only" and body["predictedLabel"] == expected
        assert set(body["scores"]) == {"original_demo", "altered_demo"}
        assert all(0 <= value <= 1 for value in body["scores"].values())
        assert abs(sum(body["scores"].values()) - 1) < 1e-9
        results[expected] = {"response": body, "httpWallMs": wall_ms}
    other = (root / "public/demo/ontario-demo-prescription.png").read_bytes()
    result, _ = invoke({"schemaVersion": 1, "contentType": "image/png", "imageBase64": base64.b64encode(other).decode()})
    assert result["statusCode"] == 422
    results["nonAllowlistedStatus"] = 422
    results["authenticityValidated"] = False
    if args.save:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
