"""
Render a 135x240 agent-status card for the AULA S75 Pro screen.

PIL is imported lazily/guarded so this module is import-safe without Pillow (e.g. CI).
Fonts: OpenSans if the vendor font dir is present, else PIL's default bitmap font.
"""
import os

try:  # optional dependency — guarded for CI import-safety
    from PIL import Image, ImageDraw, ImageFont
except Exception:  # pragma: no cover
    Image = ImageDraw = ImageFont = None

SCREEN_W, SCREEN_H = 135, 240

# Octowiz brand purple (ANSI 256 color 135 = #af5fff) for the WORKING state.
THEME = {
    "working":   ((175, 95, 255), (255, 255, 255), (205, 165, 255), "WORKING"),
    "done":      ((20, 150, 60),  (255, 255, 255), (120, 240, 150), "DONE"),
    "attention": ((210, 40, 40),  (255, 255, 255), (255, 150, 150), "NEEDS YOU"),
    "error":     ((200, 90, 0),   (255, 255, 255), (255, 190, 110), "FAILED"),
    "idle":      ((45, 55, 75),   (200, 210, 230), (130, 150, 190), "READY"),
}
BG = (12, 14, 20)

_FONT_CANDIDATES = [
    r"C:\Program Files (x86)\S75Pro\font",
    "/usr/share/fonts/truetype/opensans",
]


def _font_dir():
    for d in _FONT_CANDIDATES:
        if os.path.isdir(d):
            return d
    return None


def _font(name, size):
    d = _font_dir()
    if d and ImageFont is not None:
        try:
            return ImageFont.truetype(os.path.join(d, name), size)
        except Exception:
            pass
    return ImageFont.load_default() if ImageFont is not None else None


def _wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render_hud(status, title, stats=None, footer=None):
    """Return a 135x240 PIL image. Requires Pillow (raises if absent)."""
    if Image is None:
        raise RuntimeError("Pillow not installed — `pip install Pillow` (the 'keyboard' extra)")
    hdr_bg, hdr_fg, accent, label = THEME.get(status, THEME["idle"])
    stats = stats or {}
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, SCREEN_W, 44], fill=hdr_bg)
    hf = _font("OpenSans-ExtraBold.ttf", 20 if len(label) <= 8 else 16)
    tw = d.textlength(label, font=hf)
    d.text(((SCREEN_W - tw) / 2, 11), label, font=hf, fill=hdr_fg)

    y = 54
    tf = _font("OpenSans-Semibold.ttf", 14)
    for line in _wrap(d, title, tf, SCREEN_W - 12)[:3]:
        d.text((8, y), line, font=tf, fill=(235, 238, 245))
        y += 18
    y += 6
    d.line([8, y, SCREEN_W - 8, y], fill=(40, 46, 60), width=1)
    y += 8

    lf, vf = _font("OpenSans-Regular.ttf", 12), _font("OpenSans-Semibold.ttf", 13)
    for k, v in stats.items():
        d.text((8, y), str(k), font=lf, fill=(140, 150, 170))
        vw = d.textlength(str(v), font=vf)
        d.text((SCREEN_W - 8 - vw, y - 1), str(v), font=vf, fill=accent)
        y += 20

    if footer:
        d.text((8, SCREEN_H - 18), footer, font=_font("OpenSans-Regular.ttf", 11), fill=(110, 120, 140))
    return img
