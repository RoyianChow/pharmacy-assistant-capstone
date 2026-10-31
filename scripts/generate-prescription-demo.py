"""Generate the fictional Ontario prescription fixture and its OCR-ready PNG.

Requires reportlab and Poppler's pdftoppm. No real patient, prescriber,
registration, signature, or medication is represented by this fixture.

    python scripts/generate-prescription-demo.py
    python scripts/generate-prescription-demo.py --pdftoppm /path/to/pdftoppm
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


FIELDS = {
    "Clinic": "Maple Demo Clinic",
    "Clinic address": "100 Example Street, Toronto, ON (fictional address)",
    "Clinic phone": "416-555-0100",
    "Patient": "Alex Example",
    "Date of birth": "1990-01-15",
    "Date issued": "2026-10-31",
    "Prescriber": "Dr. Taylor Sample",
    "Licence": "DEMO-0000 (invalid)",
    "Medication": "Example Medication (fictional)",
    "Strength": "10 mg",
    "Directions": "For OCR testing only. Do not administer.",
    "Quantity": "14 tablets (demo)",
    "Refills": "0",
    "Signature": "UNSIGNED DEMO",
}

INK = HexColor("#173B31")
GREEN = HexColor("#3B6956")
MUTED = HexColor("#53665C")
LINE = HexColor("#D7E1DA")
LIGHT = HexColor("#F1F6F1")
NOTICE = HexColor("#FFF1D9")
NOTICE_INK = HexColor("#5D3B16")


def draw_text(pdf: canvas.Canvas, text: str, x: float, y: float,
              size: float = 11, bold: bool = False, color=INK) -> None:
    pdf.setFillColor(color)
    pdf.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    pdf.drawString(x, y, text)


def draw_field(pdf: canvas.Canvas, label: str, y: float) -> None:
    # One complete label/value per line makes the fixture useful for OCR.
    draw_text(pdf, f"{label}: {FIELDS[label]}", 56, y, size=11.5)


def draw_section(pdf: canvas.Canvas, title: str, y: float) -> None:
    draw_text(pdf, title, 40, y, size=9, bold=True, color=GREEN)
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.7)
    pdf.line(40, y - 9, 572, y - 9)


def generate_pdf(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter, invariant=1)
    pdf.setTitle("Ontario prescription demo - NOT VALID FOR DISPENSING")
    pdf.setAuthor("Pharmacy Assistant capstone demonstration")
    pdf.setSubject("Fictional document for PaddleOCR extraction testing only")
    pdf.setFillColor(white)
    pdf.rect(0, 0, 612, 792, stroke=0, fill=1)

    pdf.setFillColor(NOTICE)
    pdf.roundRect(40, 718, 532, 38, 5, stroke=0, fill=1)
    draw_text(pdf, "DEMO - NOT VALID FOR DISPENSING", 59, 732,
              size=15, bold=True, color=NOTICE_INK)

    draw_text(pdf, "ONTARIO / PRESCRIPTION VERIFICATION SAMPLE", 40, 694,
              size=9, bold=True, color=GREEN)
    draw_text(pdf, FIELDS["Clinic"], 40, 661, size=25, bold=True)
    draw_text(pdf, FIELDS["Clinic address"], 40, 641, size=10.5, color=MUTED)
    draw_text(pdf, f"Clinic phone: {FIELDS['Clinic phone']}", 40, 623,
              size=10.5, color=MUTED)

    draw_section(pdf, "PATIENT AND ISSUE DETAILS", 590)
    draw_field(pdf, "Patient", 557)
    draw_field(pdf, "Date of birth", 533)
    draw_field(pdf, "Date issued", 509)

    draw_section(pdf, "PRESCRIPTION TEXT / FICTIONAL MEDICINE", 472)
    pdf.setFillColor(LIGHT)
    pdf.roundRect(40, 316, 532, 137, 5, stroke=0, fill=1)
    draw_field(pdf, "Medication", 432)
    draw_field(pdf, "Strength", 408)
    draw_field(pdf, "Directions", 384)
    draw_field(pdf, "Quantity", 360)
    draw_field(pdf, "Refills", 336)

    draw_section(pdf, "PRESCRIBER DETAILS / FICTIONAL IDENTITY", 284)
    draw_field(pdf, "Prescriber", 251)
    draw_field(pdf, "Licence", 227)
    draw_field(pdf, "Signature", 203)

    draw_text(pdf, "Educational OCR fixture", 40, 157, size=11, bold=True)
    draw_text(pdf, "Every identity and medicine on this page is fictional.", 40, 139,
              size=10, color=MUTED)
    draw_text(pdf, "No valid prescriber registration or signature is supplied.", 40, 123,
              size=10, color=MUTED)
    draw_text(pdf, "This page does not authorize treatment, supply, or dispensing.", 40, 107,
              size=10, color=MUTED)

    pdf.setFillColor(NOTICE)
    pdf.roundRect(40, 48, 532, 37, 5, stroke=0, fill=1)
    draw_text(pdf, "DEMO - NOT VALID FOR DISPENSING", 72, 61,
              size=14, bold=True, color=NOTICE_INK)
    draw_text(pdf, "Pharmacy Assistant | COMP 385 | Fictional Ontario sample", 40, 28,
              size=8, color=MUTED)
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "public" / "demo")
    parser.add_argument("--pdftoppm", default=shutil.which("pdftoppm"))
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()
    if not args.pdftoppm:
        parser.error("Poppler pdftoppm is required; install Poppler or pass --pdftoppm.")
    if not 100 <= args.dpi <= 300:
        parser.error("Choose a DPI between 100 and 300.")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    base = args.output_dir / "ontario-demo-prescription"
    generate_pdf(base.with_suffix(".pdf"))
    subprocess.run([args.pdftoppm, "-singlefile", "-r", str(args.dpi), "-png",
                    str(base.with_suffix(".pdf")), str(base)], check=True)
    png_size = base.with_suffix(".png").stat().st_size
    if png_size > 4 * 1024 * 1024:
        raise ValueError("Generated PNG exceeds the OCR upload limit.")
    print(f"PDF: {base.with_suffix('.pdf')}")
    print(f"PNG: {base.with_suffix('.png')} ({png_size:,} bytes)")


if __name__ == "__main__":
    main()
