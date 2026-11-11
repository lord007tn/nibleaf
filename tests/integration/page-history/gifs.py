"""Encode the captured interaction steps; Pillow is required."""
import json
import tempfile
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[3]
frames_root = Path(tempfile.gettempdir()) / "nibleaf-page-history-frames"
for locale in ("en", "ar"):
    for width in (1440, 390):
        label = f"{locale}-{width}"
        frames = json.loads((frames_root / f"{label}.json").read_text())
        images = [Image.open(frame["path"]).convert("RGB") for frame in frames]
        target = root / ".github/assets/feat-page-history" / f"{label}-journey.gif"
        images[0].save(target, save_all=True, append_images=images[1:],
                       duration=[frame["duration"] for frame in frames], loop=0,
                       optimize=True)
        assert target.stat().st_size < 5_000_000, target
        print(f"{target.name}: {target.stat().st_size} bytes")
