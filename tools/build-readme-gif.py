"""Turns the frames from tools/capture-readme-media.js into docs/media/stella.gif and trims docs/media/chat.png.

Needs Pillow (pip install pillow). Run from the repo root after the capture script.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = ROOT / ".stella-local" / "readme-media" / "frames"
MEDIA = ROOT / "docs" / "media"

# One shared palette (taken from a few frames across the loop) keeps colors steady between frames.
paths = sorted(FRAMES.glob("frame-*.png"))
if not paths:
    raise SystemExit("No frames: run tools/capture-readme-media.js first.")
images = [Image.open(p).convert("RGB") for p in paths]
sample = Image.new("RGB", (images[0].width, images[0].height * 4))
for i, k in enumerate(range(0, len(images), max(1, len(images) // 4))):
    if i < 4:
        sample.paste(images[k], (0, images[0].height * i))
palette = sample.quantize(colors=192, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
gif = MEDIA / "stella.gif"
frames[0].save(gif, save_all=True, append_images=frames[1:], duration=67, loop=0, optimize=True, disposal=1)
print(f"{gif} {gif.stat().st_size / 1e6:.2f} MB, {len(frames)} frames")

# Chat: keep the panel and Stella, drop the empty desktop on the left.
chat = MEDIA / "chat.png"
im = Image.open(chat)
if im.width > 600:
    im.crop((420, 100, 880, 500)).save(chat, optimize=True)
    print(f"{chat} cropped")
