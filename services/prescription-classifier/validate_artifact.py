"""Fail deployment readiness unless a compatible trained research artifact loads."""
import argparse
import json
import os
from pathlib import Path

from lambda_function import load_model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).parent / "artifacts")
    args = parser.parse_args()
    os.environ["MODEL_DIR"] = str(args.model_dir.resolve())
    try:
        _, metadata = load_model()
    except Exception:
        print("NOT READY: a compatible, intact research artifact is required; software-smoke artifacts are rejected.")
        raise SystemExit(1) from None
    print(json.dumps({"ready": True, "modelVersion": metadata["modelVersion"], "validationStatus": "research_only",
                      "reviewRequired": True}))


if __name__ == "__main__":
    main()
