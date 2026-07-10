#!/usr/bin/env python3
"""Render PDF pages to PNG files for visual inspection."""
import sys
from pathlib import Path

import pypdfium2 as pdfium


def main():
    pdf_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
    pages = sys.argv[4] if len(sys.argv) > 4 else None  # e.g. "0,1,2" or "0-5"

    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf_path))
    n = len(doc)
    print(f"{pdf_path.name}: {n} pages")

    if pages:
        idxs = []
        for part in pages.split(","):
            if "-" in part:
                a, b = part.split("-")
                idxs.extend(range(int(a), min(int(b) + 1, n)))
            else:
                idxs.append(int(part))
        idxs = [i for i in idxs if 0 <= i < n]
    else:
        idxs = list(range(n))

    for i in idxs:
        page = doc[i]
        w, h = page.get_size()
        bitmap = page.render(scale=scale)
        img = bitmap.to_pil()
        out = out_dir / f"page-{i:03d}.png"
        img.save(out)
        print(f"  page {i}: {w:.0f}x{h:.0f}pt -> {out}")


if __name__ == "__main__":
    main()
