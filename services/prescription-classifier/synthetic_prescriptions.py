"""Generate fictional paired documents with visible edits, never valid prescriptions."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import random
import shutil

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

VERSION = "fictional-visible-alterations-v2"
SIZE = (900, 1200)
KINDS = ["strikeout", "pasted_block", "overprint", "duplicate_field"]
PUBLIC_SOURCE = "template-06-source-00"  # Fixed before training or any predictions.
DEMO_NOTICE = "DEMO - NOT VALID FOR DISPENSING"


def fonts():
    candidates = [(Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
                  (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            return regular, bold
    raise RuntimeError("Arial or DejaVu Sans regular/bold fonts are required.")


def font(size, bold=False):
    return ImageFont.truetype(str(fonts()[int(bold)]), size)


def watermark_hash(image):
    return hashlib.sha256(image.crop((0, 0, 900, 100)).tobytes()
                          + image.crop((0, 1100, 900, 1200)).tobytes()).hexdigest()


def stamp(image):
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 899, 99), fill="white")
    draw.rectangle((0, 1100, 899, 1199), fill="white")
    for top in [12, 1110]:
        draw.rounded_rectangle((25, top, 875, top + 70), radius=8, fill="#fff0cf", outline="#7c541b", width=2)
        draw.text((65, top + 12), DEMO_NOTICE, fill="#4c350e", font=font(31, True))
    draw.text((180, 1185), "FICTIONAL DATA / NO PRESCRIBING AUTHORITY", fill="#444444", font=font(15))


def original(template, source, rng):
    image = Image.new("RGB", SIZE, "white")
    draw = ImageDraw.Draw(image)
    ink = ["#203a36", "#2d3b51", "#43364b", "#3d3c34"][template % 4]
    left = 65 + (template % 3) * 15
    top = 340 + (template % 2) * 35
    line = 71 + (template % 3) * 3
    styles = ["ruled", "cards", "sidebar", "boxed", "compact", "split", "ledger", "minimal"]
    style = styles[template]
    if style == "sidebar":
        draw.rectangle((35, 130, 85, 1080), fill="#dfe7e3")
        left += 35
    elif style in {"boxed", "ledger"}:
        draw.rectangle((40, 125, 860, 1080), outline=ink, width=3)
    title_x = left if style != "split" else 305
    draw.text((title_x, 140), f"Fictional Clinic {template + 1}", fill=ink, font=font(34, True))
    draw.text((left, 195), "Ontario educational document / not a medical order", fill=ink, font=font(22))
    draw.text((left, 233), "100 Example Road | 416-555-0100 | fictional contact", fill="#555555", font=font(19))
    draw.line((left, 285, 835, 285), fill=ink, width=3)
    fields = [
        ("Patient", f"Demo Person {template:02d}-{source:02d}"),
        ("Date of birth", f"1990-{source % 12 + 1:02d}-15"),
        ("Example medicine", f"Fictional Compound {chr(65 + source % 4)}"),
        ("Example quantity", f"{10 + source % 15} demo units - not for use"),
        ("Directions", "Exhibit only. DO NOT ADMINISTER."),
        ("Issuer", "Fictional Clinician / INVALID-DEMO"),
        ("Signature", "UNSIGNED EDUCATIONAL SAMPLE"),
    ]
    field_size = 22 + template % 2
    for index, (label, value) in enumerate(fields):
        y = top + index * line
        if style in {"cards", "compact", "split"} and index % 2 == 0:
            draw.rounded_rectangle((left - 14, y - 8, 835, y + 54), radius=5, fill="#eff2f1")
        if style in {"ruled", "ledger", "minimal"}:
            draw.line((left, y + 52, 835, y + 52), fill="#b7c2bf", width=1)
        if style in {"split", "ledger"}:
            draw.text((left, y), label, fill=ink, font=font(20, True))
            draw.text((left + 235, y), value, fill=ink, font=font(20))
        else:
            draw.text((left, y), label.upper(), fill=ink, font=font(16, True))
            draw.text((left, y + 24), value, fill=ink, font=font(field_size))
    draw.text((left, 950), f"Exhibit date: 2026-10-31 / Sample code {rng.randrange(100000, 999999)}", fill="#555555", font=font(19))
    draw.text((left, 1000), "All identities and medicines are invented.", fill=ink, font=font(21, True))
    draw.text((left, 1035), "This page never authorizes treatment or dispensing.", fill=ink, font=font(19))
    return image, (left, top + 3 * line, 835, top + 3 * line + 55)


def alter(image, box, kind, rng):
    result = image.copy()
    draw = ImageDraw.Draw(result)
    x, y, right, bottom = box
    inset = rng.randint(10, 45)
    quantity = rng.randint(10, 24)
    if kind == "strikeout":
        for offset in [6, 20, 35]:
            draw.line((x + inset, y + offset, right - 20, bottom - offset), fill="#303030", width=5)
        draw.text((x + 220, y - 35), f"{quantity} demo units", fill="#333333", font=font(28, True))
    elif kind == "pasted_block":
        draw.rectangle((x + inset, y - 13, right - 30, bottom + 15), fill="#d2d0c8", outline="#777777", width=3)
        draw.text((x + inset + 15, y + 10), f"Example quantity: {quantity} demo units", fill="#303030", font=font(29, True))
    elif kind == "overprint":
        for offset in [0, 8, 16]:
            draw.text((x + 120 + offset, y + 5 + offset), f"{quantity} demo units", fill="#303030", font=font(32, True))
    else:
        copied = image.crop((x, y - 5, right, bottom + 4))
        result.paste(copied, (x + 8, y + 37))
        draw = ImageDraw.Draw(result)
        draw.line((x, y + 36, right, y + 36), fill="#555555", width=3)
    return result


def generate(directory, public_dir=None, seed=385, replace_public=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    rng = random.Random(seed)
    records = []
    for template in range(8):
        split = "train" if template < 4 else "val" if template < 6 else "test"
        for source in range(24):
            source_id = f"template-{template:02d}-source-{source:02d}"
            kind = KINDS[source % len(KINDS)]
            clean, box = original(template, source, rng)
            changed = alter(clean, box, kind, rng)
            angle, brightness, blur = rng.uniform(-.45, .45), rng.uniform(.96, 1.02), rng.uniform(0, .25)
            for label, image in [("original_demo", clean), ("altered_demo", changed)]:
                image = ImageEnhance.Brightness(image).enhance(brightness).filter(ImageFilter.GaussianBlur(blur))
                image = image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor="white")
                stamp(image)  # Identical, unaltered watermark pixels for every image and both classes.
                filename = f"{source_id}-{label}.png"
                image.save(directory / filename, "PNG")
                records.append({"path": filename, "label": label, "group_id": source_id, "split": split,
                                "verification_reference": f"synthetic://{VERSION}/{source_id}/{label}",
                                "template_id": f"template-{template:02d}", "source_id": source_id,
                                "alteration_kind": kind, "watermark_sha256": watermark_hash(image)})
    with (directory / "manifest.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)
    metadata = {"generatorVersion": VERSION, "seed": seed, "imageSize": SIZE, "imageCount": len(records),
                "publicSourceSelectedBeforeInference": PUBLIC_SOURCE, "templateSplits": {"train": [0, 1, 2, 3], "val": [4, 5], "test": [6, 7]},
                "watermark": DEMO_NOTICE, "alterationKinds": KINDS,
                "fontSha256": [hashlib.sha256(path.read_bytes()).hexdigest() for path in fonts()]}
    (directory / "generation.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    if public_dir:
        public_dir = Path(public_dir)
        public_dir.mkdir(parents=True, exist_ok=True)
        published = {"mode": "synthetic_demo", "authenticityAssessed": False, "sourceId": PUBLIC_SOURCE,
                     "selection": "Fixed template 06, source 00, before model training or inference", "samples": {}}
        for label, name in [("original_demo", "original.png"), ("altered_demo", "altered.png")]:
            target = public_dir / name
            if target.exists() and not replace_public:
                raise ValueError("Public demo fixtures already exist; do not overwrite silently.")
            shutil.copyfile(directory / f"{PUBLIC_SOURCE}-{label}.png", target)
            published["samples"][label] = {"file": name, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
        (public_dir / "manifest.json").write_text(json.dumps(published, indent=2), encoding="utf-8")
    print(json.dumps(metadata))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--public-dir", type=Path)
    parser.add_argument("--seed", type=int, default=385)
    parser.add_argument("--replace-public", action="store_true", help="Explicitly replace only the named public demo files")
    args = parser.parse_args()
    generate(args.directory, args.public_dir, args.seed, args.replace_public)
