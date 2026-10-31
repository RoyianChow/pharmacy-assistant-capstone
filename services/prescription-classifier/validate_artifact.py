"""Fail deployment readiness unless a compatible trained research artifact loads."""
import argparse
import json
import os
from pathlib import Path

from lambda_function import load_model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=Path(__file__).parent / "artifacts")
    parser.add_argument("--mode", choices=["research_training", "synthetic_demo"],
                        default=os.getenv("CLASSIFIER_DEPLOYMENT_MODE", "research_training"))
    args = parser.parse_args()
    os.environ["MODEL_DIR"] = str(args.model_dir.resolve())
    os.environ["CLASSIFIER_DEPLOYMENT_MODE"] = args.mode
    try:
        _, metadata = load_model()
    except Exception:
        print("NOT READY: a compatible intact artifact for the explicit deployment mode is required; software-smoke artifacts are rejected.")
        raise SystemExit(1) from None
    print(json.dumps({"ready": True, "modelVersion": metadata["modelVersion"], "mode": args.mode,
                      "validationStatus": metadata["validationStatus"], "authenticityAssessed": False, "reviewRequired": True}))


if __name__ == "__main__":
    main()
