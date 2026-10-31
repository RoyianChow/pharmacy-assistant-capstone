"""Send only the repository's fictional fixture to a running real OCR service."""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8001")
    parser.add_argument("--save", type=Path)
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parents[2] / "public/demo/ontario-demo-prescription.png"
    headers = {"Content-Type": "image/png"}
    token = os.getenv("PADDLEOCR_SERVICE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(args.url.rstrip("/") + "/ocr", data=fixture.read_bytes(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        assert response.headers.get("cache-control") == "no-store"
        result = json.load(response)
    assert result["engine"] == "PaddleOCR"
    assert result["lines"]
    text = "\n".join(line["text"] for line in result["lines"]).lower()
    required = ["not valid for dispensing", "patient", "prescriber", "quantity", "directions"]
    missing = [value for value in required if value not in text]
    assert not missing, f"Expected demo text missing: {', '.join(missing)}"
    assert all(0 <= line["confidence"] <= 1 and len(line["box"]) == 4 for line in result["lines"])
    if args.save:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"engine": result["engine"], "model": result["model"], "lineCount": len(result["lines"]), "durationMs": result["durationMs"], "image": result["image"], "requiredDemoLabelsFound": True}))


if __name__ == "__main__":
    main()
