#!/usr/bin/env python3
"""Render docs/demo-frames.json into an animated terminal GIF.

The frames are plain strings containing ANSI SGR sequences. We parse a safe
subset (fg 30-37/90-97, 38;5;N bold 256-color, bold/dim/reset) and ignore
everything else. We simulate a fixed-height terminal: at any time the
viewport shows the LAST `rows` lines, like a real shell window that scrolls.

Usage:
    python scripts/render-gif.py [frames.json] [out.gif]
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RED = re.compile(r"\x1b\[[0-9;]*m")

# Cascadia Mono / Pillow don't ship color-emoji glyphs; render them as
# colored ASCII so the GIF is readable on any system.
EMOJI_AS_ASCII = {
    "✅": " PASS ",
    "⚠️": " WARN ",
    "❌": " FAIL ",
    "➖": " SKIP ",
}


def strip_emoji(text: str) -> str:
    for k, v in EMOJI_AS_ASCII.items():
        text = text.replace(k, v)
    return text

BG = (13, 17, 23)
PALETTE = {
    30: (13, 17, 23), 31: (255, 123, 114), 32: (63, 185, 80), 33: (210, 153, 34),
    34: (88, 166, 255), 35: (188, 140, 255), 36: (57, 197, 207), 37: (230, 237, 243),
    90: (72, 79, 88), 91: (255, 110, 115), 92: (63, 185, 80), 93: (210, 153, 34),
    94: (88, 166, 255), 95: (188, 140, 255), 96: (57, 197, 207), 97: (255, 255, 255),
}
DIM = 0.6
FONT_NAMES = ["CascadiaMono.ttf", "CascadiaMonoPL.ttf", "Consolas.ttf", "consola.ttf", "cour.ttf"]


def load_font(size):
    for name in FONT_NAMES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


class SGRState:
    """Super-simple SGR parser for fg colors."""

    def __init__(self):
        self.reset()

    def reset(self):
        self.fg = 37
        self.bold = False
        self.dim = False

    def apply(self, code: str):
        # strip ESC [ and trailing m, then split params
        params = code[2:-1].split(";")
        i = 0
        while i < len(params):
            p = params[i]
            if p in ("", "0"):
                self.reset()
            elif p == "1":
                self.bold = True
            elif p == "2":
                self.dim = True
            elif p == "22":
                self.bold = False
                self.dim = False
            elif p == "39":
                self.fg = 37
            elif p == "38":
                # 38;5;N
                if i + 2 < len(params) and params[i + 1] == "5":
                    self.fg = "x" + params[i + 2]
                    i += 2
            elif p.isdigit():
                n = int(p)
                if 30 <= n <= 37 or 90 <= n <= 97:
                    self.fg = n
            i += 1

    def color(self):
        fg = self.fg
        if isinstance(fg, str):
            c = index_to_rgb(int(fg[1:]))
        else:
            c = PALETTE.get(fg, (230, 237, 243))
        if self.bold:
            c = tuple(min(255, v + 40) for v in c)
        if self.dim:
            c = tuple(int(v * DIM) for v in c)
        return c


def index_to_rgb(n):
    if n < 16:
        return list(PALETTE.values())[n % 16]
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n // 6) % 6, n % 6
        conv = lambda v: 0 if v == 0 else 55 + v * 40
        return (conv(r), conv(g), conv(b))
    v = 8 + (n - 232) * 10
    return (v, v, v)


def render(text, rows, font):
    """Draw a full frame, then keep only the last `rows` lines => scrolling window."""
    # Find viewport: last `rows` visual lines.
    raw_lines = text.split("\n")
    visible = raw_lines[-rows:] if len(raw_lines) > rows else raw_lines

    # Size the canvas from the widest visible line.
    font = font or load_font(13)
    pad = 12
    mc = font.getbbox("M")
    cw = (mc[2] - mc[0]) or 8
    ch = (mc[3] - mc[1]) or 14
    line_h = ch + 5

    avg_has = sum(1 for ln in visible if len(ln) > 0)
    width = max((len(ln) for ln in visible), default=0)
    img = Image.new("RGB", (pad * 2 + width * cw, pad * 2 + rows * line_h), BG)
    draw = ImageDraw.Draw(img)

    y = pad
    for line in visible:
        if not line:
            y += line_h
            continue
        line = strip_emoji(line)
        x = pad
        st = SGRState()
        parts = RED.split(line)
        codes = RED.findall(line) + [""]
        for idx, part in enumerate(parts):
            if not part:
                continue
            draw.text((x, y), part, font=font, fill=st.color())
            x += draw.textlength(part, font=font)
            st.apply(codes[idx] if idx < len(codes) else "")
        y += line_h
    return img


def main():
    frames_path = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/demo-frames.json")
    out_path = Path(sys.argv[2] if len(sys.argv) > 2 else "docs/demo.gif")
    data = json.loads(frames_path.read_text(encoding="utf8"))
    frames = data["frames"]
    rows = int(data.get("rows", 22))

    font = load_font(13)
    images = []
    step = max(1, len(frames) // 45 if len(frames) > 45 else 1)
    for i in range(0, len(frames), step):
        images.append(render(frames[i], rows, font))

    w = max(img.width for img in images)
    h = max(img.height for img in images)
    padded = []
    for img in images:
        canv = Image.new("RGB", (w, h), BG)
        canv.paste(img, (0, 0))
        padded.append(canv)

    durations = [450] * (len(padded) - 1) + [5000]
    padded[0].save(out_path, save_all=True, append_images=padded[1:], duration=durations, loop=0, optimize=False)
    print(f"wrote {out_path} — {len(padded)} frames, {w}x{h}px")


if __name__ == "__main__":
    main()