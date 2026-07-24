#!/usr/bin/env python3
"""Quita fondo negro/oscuro de logos CMU y guarda PNG RGBA transparente."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image


def knockout_black(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    arr = np.array(im).astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    is_blueish = (b > r + 12) & (b > g + 8) & (b > 28)
    is_whiteish = (r > 200) & (g > 200) & (b > 200)
    is_content = is_blueish | is_whiteish
    near_black = (mx < 42) & (~is_content)
    fringe = (mx < 85) & (mx >= 42) & (~is_content)
    out = arr.copy()
    out[near_black, 3] = 0
    out[fringe, 3] = np.clip((mx[fringe] - 42) / 43 * 255, 0, 255)
    alpha = out[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs):
        pad = 8
        y0, y1 = max(0, ys.min() - pad), min(out.shape[0], ys.max() + pad + 1)
        x0, x1 = max(0, xs.min() - pad), min(out.shape[1], xs.max() + pad + 1)
        out = out[y0:y1, x0:x1]
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out.astype(np.uint8)).save(dest, "PNG")
    print(f"OK {dest} {Image.open(dest).size}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("uso: knockout_logo_bg.py <entrada> <salida.png>")
        sys.exit(1)
    knockout_black(Path(sys.argv[1]), Path(sys.argv[2]))
