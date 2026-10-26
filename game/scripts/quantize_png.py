"""Quantize RGBA atlases to a 256-colour palette PNG with libimagequant (dithered).

Run: uv run --no-project --with pillow==13.0.0 --with imagequant==1.1.5 python -I quantize_png.py <in> <out> [<in> <out>...]

The painted atlases lose nothing visible (RMSE about 2/255 on the opaque texels, cut-out
alpha unchanged) and shrink about 3x, which matters because every one ships in the game pack.
"""
import sys

import imagequant
from PIL import Image

args = sys.argv[1:]
if not args or len(args) % 2:
    raise SystemExit('usage: quantize_png.py <in> <out> [<in> <out>...]')
for src, dst in zip(args[::2], args[1::2]):
    image = Image.open(src).convert('RGBA')
    quantized = imagequant.quantize_pil_image(image, dithering_level=1.0, max_colors=256, min_quality=0,
                                              max_quality=95)
    quantized.save(dst, optimize=True)
    print(f'{dst}: {image.size[0]}x{image.size[1]}, {len(quantized.getpalette()) // 3} colours')
