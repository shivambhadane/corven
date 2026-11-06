"""Generates the landing page's red halftone artwork (public/landing/*.png).

    python3 scripts/make-halftones.py

Original artwork in the style of the design in designs/: a shaded shape is rendered as a density
map, then drawn as dots on red — dark dots where the shape is dark, pale dots on its highlights, plus
a little grain. Needs numpy and Pillow.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "landing"
RED = (238, 28, 28)
DARK = (34, 6, 6)
PALE = (255, 196, 188)
CELL = 6


def halftone(density: np.ndarray, highlight: np.ndarray, seed: int) -> Image.Image:
    """density/highlight: 0..1 arrays the size of the output. Returns the dotted image."""
    h, w = density.shape
    rng = np.random.default_rng(seed)
    image = Image.new("RGB", (w, h), RED)
    draw = ImageDraw.Draw(image)
    for y in range(0, h, CELL):
        for x in range(0, w, CELL):
            d = float(density[y : y + CELL, x : x + CELL].mean())
            l = float(highlight[y : y + CELL, x : x + CELL].mean())
            jitter = rng.normal(0, 0.05) * (0.15 + d)  # grain lives in the shape, not the empty red
            cx, cy = x + CELL / 2 + rng.uniform(-0.6, 0.6), y + CELL / 2 + rng.uniform(-0.6, 0.6)
            r = (CELL / 2) * np.sqrt(np.clip(d + jitter, 0, 1)) * 1.05
            if r > 0.55:
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=DARK)
            elif l + jitter > 0.25:
                r = (CELL / 2) * 0.75 * np.sqrt(np.clip(l + jitter, 0, 1))
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PALE)
    return image


def globe(w=1600, h=560) -> Image.Image:
    y, x = np.mgrid[0:h, 0:w].astype(float)
    cx, cy, radius = w * 0.5, h * 0.62, h * 0.62
    nx, ny = (x - cx) / radius, (y - cy) / radius
    inside = nx**2 + ny**2 < 1
    nz = np.sqrt(np.clip(1 - nx**2 - ny**2, 0, 1))
    light = np.array([-0.55, -0.6, 0.58]) / np.linalg.norm([-0.55, -0.6, 0.58])
    lambert = np.clip(nx * light[0] + ny * light[1] + nz * light[2], 0, 1)
    # meridians and parallels, as on a globe
    lon = np.arctan2(nx, nz)
    lat = np.arcsin(np.clip(-ny, -1, 1))
    grid = (np.abs(np.sin(lon * 6)) < 0.06) | (np.abs(np.sin(lat * 6)) < 0.06)
    density = np.where(inside, 0.95 - 0.85 * lambert, 0.0)
    density = np.where(inside & grid, density * 0.55, density)
    # rim of darkness around the sphere and a soft vignette
    vignette = np.clip(((x - cx) / (w * 0.75)) ** 2 + ((y - cy) / (h * 1.1)) ** 2, 0, 1) * 0.35
    density = np.clip(density + np.where(inside, 0, vignette), 0, 1)
    highlight = np.where(inside, np.clip(lambert - 0.72, 0, 1) * 3.0 + grid * (0.25 + 0.8 * lambert), 0)
    return halftone(density, highlight, seed=1)


def field(w=1600, h=420) -> Image.Image:
    y, x = np.mgrid[0:h, 0:w].astype(float)
    u, v = x / w, y / h
    # a rippling surface seen in perspective, darker towards the right like the design's portrait
    depth = 1 / (0.35 + v)
    wave = np.sin(u * 18 * depth + np.sin(v * 7) * 2) * np.cos(u * 7 - v * 5)
    density = np.clip(0.3 + 0.4 * wave + 0.55 * (u - 0.35) - 0.3 * (1 - v), 0, 1)
    highlight = np.clip(wave - 0.55, 0, 1) * 1.6 * (1 - u)
    return halftone(density, highlight, seed=2)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in {"halftone-globe.png": globe(), "halftone-field.png": field()}.items():
        image.save(OUT / name, optimize=True)
        print(f"wrote {OUT / name} ({(OUT / name).stat().st_size // 1024} KB)")
