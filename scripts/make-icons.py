#!/usr/bin/env python3
"""Draw the home-screen icons without extra libraries."""
import struct
import zlib
from pathlib import Path


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size: int) -> bytes:
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            nx = x / (size - 1)
            ny = y / (size - 1)
            # Deep field with a lime stripe, like a yard line.
            green = 8 + int(18 * (1 - ny))
            if abs(ny - 0.72) < 0.012 or abs(ny - 0.38) < 0.008:
                row.extend((223, 242, 90))
            elif (nx - 0.5) ** 2 + (ny - 0.42) ** 2 < 0.09:
                row.extend((223, 242, 90))
            else:
                row.extend((green, 22 + int(12 * (1 - ny)), 16))
        rows.append(b"\x00" + bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


out = Path(__file__).resolve().parents[1] / "public"
out.mkdir(exist_ok=True)
for size in (192, 512):
    (out / f"icon-{size}.png").write_bytes(png(size))
    print(out / f"icon-{size}.png")
