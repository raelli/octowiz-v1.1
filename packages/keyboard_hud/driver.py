"""
AULA S75 Pro USB-HID driver (VID 0x0C45 / PID 0x800A).

Two vendor HID interfaces:
  * config  channel: usage_page 0xFF13 -> 64-byte FEATURE reports (lighting, LCD control)
  * LCD data channel: usage_page 0xFF68 -> 4096-byte OUTPUT reports (screen pixel pages)

Protocol is the Sonix/AULA family protocol verified on the near-identical AULA F108 Pro
(parsiya/f108-pro, hcode10 OpenRGB controller, VitalyArt F75 Max driver). Every S75 constant
(256B header, 35ms delay, fw 120, 141-frame cap, usage pages) matches that family exactly.

SAFETY (do not remove):
  * LCD pixel pages are sent ONLY as output reports via hid.write(). Sending them as feature
    reports crashes the firmware until a power-cycle.
  * The screen accepts at most 141 frames. Exceeding it overflows an SPI-flash region and can
    PERMANENTLY destroy the keyboard's built-in menu graphics with no known recovery.

`hid` (hidapi) is imported lazily/guarded so this module is import-safe on machines without it
(e.g. CI). Constructing AulaS75 without hidapi raises a clear error.
"""
import sys
import time

try:  # optional dependency — guarded so the module imports on CI without hidapi
    import hid as _hid
except Exception:  # pragma: no cover - environment dependent
    _hid = None

VID, PID = 0x0C45, 0x800A
UP_CONFIG = 0xFF13
UP_LCD = 0xFF68

CMD_DELAY = 0.035
PAYLOAD = 64
LCD_PAGE = 4096
LCD_HEADER = 256
LCD_MAX_FRAMES = 141

SCREEN_W, SCREEN_H = 135, 240
FRAME_BYTES = SCREEN_W * SCREEN_H * 2  # 64800, RGB565

TRAILER = bytes([0xAA, 0x55])  # 0x55AA little-endian on the wire

MODES = {
    0: "off", 1: "static", 2: "single_on", 3: "single_off", 4: "glittering",
    5: "falling", 6: "colourful", 7: "breath", 8: "spectrum", 9: "outward",
    10: "scrolling", 11: "rolling", 12: "rotating", 13: "explode", 14: "launch",
    15: "ripples", 16: "flowing", 17: "pulsating", 18: "tilt", 19: "shuttle",
}


def available():
    """True if hidapi is importable AND an S75 config interface is present."""
    if _hid is None:
        return False
    try:
        return _find(UP_CONFIG) is not None
    except Exception:
        return False


def _find(usage_page):
    for d in _hid.enumerate(VID, PID):
        if (d.get("usage_page") or 0) == usage_page:
            return d["path"]
    return None


class AulaS75:
    def __init__(self, open_lcd=False, verbose=False):
        if _hid is None:
            raise RuntimeError("hidapi not installed — `pip install hidapi` (the 'keyboard' extra)")
        self.verbose = verbose
        cfg_path = _find(UP_CONFIG)
        if not cfg_path:
            raise RuntimeError("AULA S75 config interface (0xFF13) not found — keyboard connected?")
        self.cfg = _hid.device()
        self.cfg.open_path(cfg_path)
        self.lcd = None
        if open_lcd:
            lcd_path = _find(UP_LCD)
            if not lcd_path:
                raise RuntimeError("AULA S75 LCD interface (0xFF68) not found")
            self.lcd = _hid.device()
            self.lcd.open_path(lcd_path)

    def close(self):
        try:
            if self.cfg:
                self.cfg.close()
        finally:
            if self.lcd:
                self.lcd.close()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()

    def _dbg(self, msg):
        if self.verbose:
            # stderr only — stdout may be a structured channel (e.g. the Octowiz hook bus)
            print(msg, file=sys.stderr)

    # ---- config channel (0xFF13, feature reports) ----
    def _feature(self, payload, readback=False, tag=""):
        buf = bytes([0x00]) + bytes(payload) + bytes(PAYLOAD - len(payload))
        assert len(buf) == PAYLOAD + 1, len(buf)
        self.cfg.send_feature_report(buf)
        self._dbg("  -> %s: %s" % (tag or "feat", " ".join("%02x" % b for b in payload[:16])))
        ack = None
        if readback:
            ack = self.cfg.get_feature_report(0x00, PAYLOAD + 1)
        time.sleep(CMD_DELAY)
        return ack

    def set_mode(self, mode, r=0, g=0, b=0, colorful=0, brightness=5, speed=3, direction=0):
        """Set a built-in effect (0..19) with color/brightness/speed/direction."""
        mode = int(mode)
        assert 0 <= mode <= 19, "mode must be 0..19"
        assert 0 <= brightness <= 5 and 0 <= speed <= 5, "brightness/speed 0..5"
        self._feature([0x04, 0x18], readback=True, tag="begin")
        self._feature([0x04, 0x13] + [0] * 6 + [0x01], readback=True, tag="light-init")
        data = bytearray(PAYLOAD)
        data[0] = mode
        data[1], data[2], data[3] = r & 0xFF, g & 0xFF, b & 0xFF
        data[8] = 1 if colorful else 0
        data[9] = brightness
        data[10] = speed
        data[11] = 1 if direction else 0
        data[14], data[15] = TRAILER[0], TRAILER[1]
        self._feature(data, readback=False, tag="data")
        self._feature([0x04, 0x02], readback=True, tag="apply")
        self._feature([0x04, 0xF0], readback=False, tag="finalize")

    def off(self):
        self.set_mode(0)

    def static_color(self, r, g, b, brightness=5):
        self.set_mode(1, r, g, b, colorful=0, brightness=brightness)

    # ---- LCD screen ----
    @staticmethod
    def rgb565_le(r, g, b):
        v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
        return bytes([v & 0xFF, (v >> 8) & 0xFF])

    def lcd_upload_frames(self, frames565, delays_cs=None, slot=1):
        """Upload animation frames. frames565: list of bytes, each exactly FRAME_BYTES (RGB565 LE).
        SAFETY: pages go ONLY via output reports; frame count hard-capped at 141."""
        if self.lcd is None:
            raise RuntimeError("LCD channel not open — construct AulaS75(open_lcd=True)")
        n = len(frames565)
        if n == 0:
            raise ValueError("no frames")
        if n > LCD_MAX_FRAMES:
            raise ValueError("REFUSING: %d frames > hard limit %d (can permanently destroy the "
                             "keyboard's menu graphics)" % (n, LCD_MAX_FRAMES))
        for i, f in enumerate(frames565):
            if len(f) != FRAME_BYTES:
                raise ValueError("frame %d is %d bytes, expected %d" % (i, len(f), FRAME_BYTES))
        if delays_cs is None:
            delays_cs = [10] * n

        header = bytearray([0xFF] * LCD_HEADER)
        header[0] = n
        for i in range(n):
            header[1 + i] = max(1, int(delays_cs[i]) // 2)
        buf = bytes(header) + b"".join(frames565)
        if len(buf) % LCD_PAGE:
            buf += b"\x00" * (LCD_PAGE - (len(buf) % LCD_PAGE))
        page_count = len(buf) // LCD_PAGE

        self._feature([0x04, 0x18], readback=True, tag="lcd-begin")
        hdr = bytearray(PAYLOAD)
        hdr[0], hdr[1], hdr[2] = 0x04, 0x72, slot & 0xFF
        hdr[8] = page_count & 0xFF
        hdr[9] = (page_count >> 8) & 0xFF
        self._feature(hdr, readback=True, tag="lcd-header")

        for p in range(page_count):
            page = buf[p * LCD_PAGE:(p + 1) * LCD_PAGE]
            self.lcd.write(bytes([0x00]) + page)  # OUTPUT report — never a feature report
            ack = self.lcd.read(64, 300)
            if p == 0 and not ack:
                raise RuntimeError("LCD page 1 got no ACK — aborting (nothing committed)")
            time.sleep(CMD_DELAY)

        self._feature([0x04, 0x02], readback=True, tag="lcd-apply")

    def lcd_show_image(self, img, slot=1):
        """Render a PIL image to the screen (auto-converts to 135x240 RGB565, width-fast)."""
        img = img.convert("RGB")
        if img.size != (SCREEN_W, SCREEN_H):
            img = img.resize((SCREEN_W, SCREEN_H))
        px = img.load()
        data = bytearray()
        for y in range(SCREEN_H):
            for x in range(SCREEN_W):
                r, g, b = px[x, y]
                data += self.rgb565_le(r, g, b)
        self.lcd_upload_frames([bytes(data)], slot=slot)

    STATES = {
        "working":   dict(mode=7, r=255, g=255, b=255, brightness=3),
        "done":      dict(mode=1, r=0,   g=255, b=0,   brightness=5),
        "attention": dict(mode=7, r=255, g=0,   b=0,   brightness=5, speed=5),
        "error":     dict(mode=1, r=255, g=30,  b=0,   brightness=5),
        "idle":      dict(mode=1, r=0,   g=30,  b=70,  brightness=2),
    }

    def signal(self, state):
        if state not in self.STATES:
            raise ValueError("unknown state %r" % state)
        self.set_mode(**self.STATES[state])
