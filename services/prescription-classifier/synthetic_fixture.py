"""Generate geometric shapes for software smoke only; these are not prescriptions."""
import argparse
import csv
from pathlib import Path

from PIL import Image, ImageDraw


def generate(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    records = []
    for split_index, split in enumerate(["train", "val", "test"]):
        for label_index, label in enumerate(["real", "fake"]):
            for sample in range(2):
                number = split_index * 4 + label_index * 2 + sample
                image = Image.new("RGB", (240 + number, 320 + number), "white")
                draw = ImageDraw.Draw(image)
                box = (20 + number, 30 + number, 180, 260)
                if label_index:
                    draw.ellipse(box, fill=(10, 80 + number, 180))
                else:
                    draw.rectangle(box, fill=(180, 20 + number, 40))
                filename = f"shape-{number}.png"
                image.save(directory / filename)
                records.append({"path": filename, "label": label, "group_id": f"geometry-{number}", "split": split,
                                "verification_reference": "synthetic://geometric-software-test-only"})
    with (directory / "manifest.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    generate(parser.parse_args().directory)
