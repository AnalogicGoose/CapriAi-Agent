"""Write Stella's app/tray icons from PNGs drawn at each size.

Usage: python tools/build-stella-icons.py <icons.json>
icons.json maps size -> PNG data URL (drawn in a browser canvas, see docs/STELLA.md).
Writes assets/icons/stella.ico (PNG-compressed entries, Windows Vista+), stella.png (256) and tray.png (32).
"""
import base64, json, struct, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'assets' / 'icons'
data = json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
if isinstance(data, str):
    data = json.loads(data)
pngs = {int(size): base64.b64decode(url.split(',', 1)[1]) for size, url in data.items()}

sizes = sorted(s for s in pngs if s in (16, 20, 24, 32, 40, 48, 64, 128, 256))
header = struct.pack('<HHH', 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries, blobs = b'', b''
for size in sizes:
    png = pngs[size]
    dim = 0 if size >= 256 else size  # 0 means 256 in an ICO directory entry
    entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(png), offset + len(blobs))
    blobs += png
(root / 'stella.ico').write_bytes(header + entries + blobs)
(root / 'stella.png').write_bytes(pngs[256])
(root / 'tray.png').write_bytes(pngs[32])
print('wrote', root / 'stella.ico', sizes)
