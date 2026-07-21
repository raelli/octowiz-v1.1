"""
Render a 135x240 agent-status card for the AULA S75 Pro screen.

octowiz v1.1 design-system skin: void surface, stone borders, rune ink, arcane brand
accent, sigil colors for semantic states (see the octowiz Design System project,
colors_and_type.css). PIL is imported lazily/guarded so this module is import-safe
without Pillow (e.g. CI). Fonts: OpenSans if the vendor font dir is present, else
PIL's default bitmap font.
"""
import os

try:  # optional dependency — guarded for CI import-safety
    from PIL import Image, ImageDraw, ImageFont
except Exception:  # pragma: no cover
    Image = ImageDraw = ImageFont = None

SCREEN_W, SCREEN_H = 135, 240

# ---- octowiz design tokens (colors_and_type.css) ----
VOID = (11, 13, 20)          # --void, page surface
STONE_900 = (21, 23, 31)     # header band surface
STONE_700 = (38, 40, 56)     # --border-default
RUNE_50 = (244, 242, 251)    # --fg-default
RUNE_200 = (199, 197, 214)   # --fg-secondary
RUNE_400 = (139, 137, 163)   # --fg-muted
RUNE_500 = (111, 109, 135)
ARC_300 = (216, 180, 254)    # --arcane-300, stat values
ARC_400 = (192, 132, 252)    # --arcane-400, PRIMARY brand

# semantic states -> (sigil accent, label)
THEME = {
    "working":   (ARC_400, "WORKING"),
    "done":      ((34, 197, 94), "DONE"),        # --sigil-green
    "attention": ((225, 29, 116), "NEEDS YOU"),  # --sigil-rose
    "error":     ((249, 115, 22), "FAILED"),     # --sigil-orange
    "idle":      (RUNE_400, "READY"),
}

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


def _tracked(draw, xy, text, font, fill, tracking=2):
    """Letterspaced text (the design system's rune style is tracked uppercase)."""
    x, y = xy
    for c in text:
        draw.text((x, y), c, font=font, fill=fill)
        x += draw.textlength(c, font=font) + tracking


def _tracked_len(draw, text, font, tracking=2):
    return sum(draw.textlength(c, font=font) for c in text) + tracking * (len(text) - 1)


def render_hud(status, title, stats=None, footer=None):
    """Return a 135x240 PIL image. Requires Pillow (raises if absent)."""
    if Image is None:
        raise RuntimeError("Pillow not installed — `pip install Pillow` (the 'keyboard' extra)")
    accent, label = THEME.get(status, THEME["idle"])
    stats = stats or {}
    img = Image.new("RGB", (SCREEN_W, SCREEN_H), VOID)
    d = ImageDraw.Draw(img)

    # header: dark stone band, tracked state label in the sigil color, glowing accent rule
    d.rectangle([0, 0, SCREEN_W, 40], fill=STONE_900)
    hf = _font("OpenSans-ExtraBold.ttf", 15 if len(label) <= 8 else 13)
    tw = _tracked_len(d, label, hf)
    _tracked(d, ((SCREEN_W - tw) / 2, 10), label, hf, accent)
    d.rectangle([0, 40, SCREEN_W, 42], fill=accent)
    dim = tuple(v // 3 for v in accent)
    d.rectangle([0, 43, SCREEN_W, 44], fill=dim)          # soft glow falloff

    y = 54
    tf = _font("OpenSans-Semibold.ttf", 14)
    for line in _wrap(d, title, tf, SCREEN_W - 12)[:3]:
        d.text((8, y), line, font=tf, fill=RUNE_50)
        y += 18
    y += 6
    d.line([8, y, SCREEN_W - 8, y], fill=STONE_700, width=1)
    y += 8

    lf, vf = _font("OpenSans-Regular.ttf", 12), _font("OpenSans-Semibold.ttf", 13)
    for k, v in stats.items():
        d.text((8, y), str(k), font=lf, fill=RUNE_400)
        vw = d.textlength(str(v), font=vf)
        d.text((SCREEN_W - 8 - vw, y - 1), str(v), font=vf, fill=ARC_300)
        y += 20

    # footer: context line above the brand row
    if footer:
        d.text((8, SCREEN_H - 36), footer, font=_font("OpenSans-Regular.ttf", 11), fill=RUNE_400)
    d.line([8, SCREEN_H - 22, SCREEN_W - 8, SCREEN_H - 22], fill=STONE_700, width=1)
    bf = _font("OpenSans-Bold.ttf", 11)
    d.text((8, SCREEN_H - 18), "octo", font=bf, fill=RUNE_200)
    ow = d.textlength("octo", font=bf)
    d.text((8 + ow, SCREEN_H - 18), "wiz", font=bf, fill=ARC_400)
    vfnt = _font("OpenSans-Regular.ttf", 10)
    vw = d.textlength("v1.1", font=vfnt)
    d.text((SCREEN_W - 8 - vw, SCREEN_H - 17), "v1.1", font=vfnt, fill=RUNE_500)
    return img
