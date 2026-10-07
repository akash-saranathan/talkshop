"""
Build the merchant catalog photos: one studio photo per product colour.

    python scripts/fetch_catalog_photos.py                    # make photos that are missing
    python scripts/fetch_catalog_photos.py --refresh          # rebuild every photo
    python scripts/fetch_catalog_photos.py --only nike_vomero_18,casio_pro_trek

Each colour in backend/data/<merchant>_catalog.json names a hand-picked Pixabay
photo (Pixabay Content License; key in .env as PIXABAY_API_KEY). This downloads
it and gives every product the same studio look: background removed, centred on
a soft neutral backdrop with a floor shadow, 800x800 WebP at
frontend/public/catalog/<slug>/<colour>.webp. Pixabay's API terms do not allow
hotlinking, so photos are stored locally. Sources and photographers are
recorded in backend/data/catalog_images.json.

Processing modes per photo:
  studio   remove the background (rembg)
  largest  same, then keep only the largest shape (drops separate props)
  onblack  product on a plain black backdrop: separate by brightness

Run it in its own virtual environment, so rembg and its model stay out of the app:

    py -m venv .venv-photos
    .venv-photos/Scripts/pip install rembg onnxruntime scipy pillow httpx python-dotenv
    .venv-photos/Scripts/python scripts/fetch_catalog_photos.py

(The first run downloads a ~170 MB background-removal model.)
"""
import io
import json
import os
import sys
import time
from pathlib import Path

import httpx
import numpy as np
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "backend" / "data"
RECORD = DATA_DIR / "catalog_images.json"
OUT_DIR = ROOT / "frontend" / "public" / "catalog"
MERCHANTS = ["nike", "adidas", "zara", "hm", "fossil", "casio"]
SIZE = 800
BACKDROP = (243, 242, 239)   # soft warm grey, the same colour the product cards use behind photos
SHADOW = (150, 148, 144)

_session = None


def colour_file(name: str) -> str:
    return "-".join(name.lower().replace("/", " ").split()) + ".webp"


def rembg_cut(img: Image.Image) -> Image.Image:
    global _session
    from rembg import new_session, remove
    if _session is None:
        _session = new_session("isnet-general-use")
    return remove(img, session=_session)


def keep_largest(mask: np.ndarray) -> np.ndarray:
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def black_cut(img: Image.Image, kernel: int) -> Image.Image:
    """Product on a plain black backdrop: anything clearly brighter than black is the product."""
    a = np.asarray(img, dtype=np.int16)
    mask = a.max(axis=2) > 45
    mask = ndimage.binary_opening(mask, structure=np.ones((kernel, 1)))
    mask = ndimage.binary_opening(mask, structure=np.ones((1, kernel)))
    mask = keep_largest(ndimage.binary_fill_holes(ndimage.binary_closing(mask, iterations=3)))
    alpha = Image.fromarray((mask * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0))
    out = img.convert("RGBA")
    out.putalpha(alpha)
    return out


def largest_cut(img: Image.Image, kernel: int) -> Image.Image:
    cut = rembg_cut(img)
    # A tall opening erases thin horizontal streaks before keeping the single largest shape.
    alpha = np.asarray(cut.getchannel("A"))
    solid = ndimage.binary_opening(alpha > 40, structure=np.ones((kernel, 1)))
    cut.putalpha(Image.fromarray((alpha * keep_largest(solid)).astype("uint8")))
    return cut


def compose(cut: Image.Image) -> Image.Image:
    """Centre the cut-out on the studio backdrop with a soft floor shadow."""
    bbox = cut.getchannel("A").point(lambda v: 255 if v > 20 else 0).getbbox()
    cut = cut.crop(bbox)
    scale = min(SIZE * 0.80 / cut.width, SIZE * 0.72 / cut.height)
    cut = cut.resize((max(1, int(cut.width * scale)), max(1, int(cut.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (SIZE, SIZE), BACKDROP)
    x, y = (SIZE - cut.width) // 2, (SIZE - cut.height) // 2 - 10
    shadow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(shadow).ellipse([x + cut.width * 0.08, y + cut.height - 14,
                                    x + cut.width * 0.92, y + cut.height + 22], fill=70)
    canvas.paste(Image.new("RGB", (SIZE, SIZE), SHADOW), (0, 0), shadow.filter(ImageFilter.GaussianBlur(18)))
    canvas.paste(cut, (x, y), cut)
    return canvas


def fetch(client: httpx.Client, key: str, image_id: int):
    r = client.get("https://pixabay.com/api/", params={"key": key, "id": image_id}, timeout=20)
    r.raise_for_status()
    time.sleep(0.7)  # stay well under Pixabay's 100 requests/minute
    hit = r.json()["hits"][0]
    img = Image.open(io.BytesIO(client.get(hit["largeImageURL"], timeout=60).content)).convert("RGB")
    return hit, img


def main() -> None:
    load_dotenv(ROOT / ".env")
    key = os.getenv("PIXABAY_API_KEY")
    if not key:
        sys.exit("PIXABAY_API_KEY is not set in .env")
    refresh = "--refresh" in sys.argv
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None

    record = json.loads(RECORD.read_text(encoding="utf-8")) if RECORD.exists() else {}
    with httpx.Client(headers={"User-Agent": "TalkShop-demo-catalog/1.0"}) as client:
        for merchant in MERCHANTS:
            catalog = json.loads((DATA_DIR / f"{merchant}_catalog.json").read_text(encoding="utf-8"))
            for product in catalog["products"]:
                if only and product["product_id"] not in only:
                    continue
                for c in product["colors"]:
                    photo = c["photo"]
                    dest = OUT_DIR / product["slug"] / colour_file(c["name"])
                    done = record.get(product["slug"], {}).get(c["name"], {})
                    if dest.exists() and not refresh and all(done.get(k) == photo.get(k)
                                                             for k in ("pixabay_id", "mode", "kernel")):
                        continue
                    hit, img = fetch(client, key, photo["pixabay_id"])
                    if photo["mode"] == "onblack":
                        cut = black_cut(img, photo.get("kernel", 25))
                    elif photo["mode"] == "largest":
                        cut = largest_cut(img, photo.get("kernel", 9))
                    else:
                        cut = rembg_cut(img)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    compose(cut).save(dest, "WEBP", quality=84, method=6)
                    record.setdefault(product["slug"], {})[c["name"]] = {
                        "pixabay_id": photo["pixabay_id"], "mode": photo["mode"],
                        **({"kernel": photo["kernel"]} if "kernel" in photo else {}),
                        "page_url": hit["pageURL"], "photographer": hit.get("user"),
                        "license": "Pixabay Content License",
                    }
                    RECORD.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
                    print(f"  {product['product_id']} / {c['name']}  ({photo['mode']})", flush=True)
    if not only:
        prune(record)
    print("done")


def prune(record: dict) -> None:
    """Delete photos and source records for colours no product offers any more."""
    wanted: dict[str, set[str]] = {}
    for merchant in MERCHANTS:
        catalog = json.loads((DATA_DIR / f"{merchant}_catalog.json").read_text(encoding="utf-8"))
        for p in catalog["products"]:
            wanted[p["slug"]] = {c["name"] for c in p["colors"]}
    for slug in list(record):
        for colour in list(record[slug]):
            if colour not in wanted.get(slug, set()):
                del record[slug][colour]
        if not record[slug]:
            del record[slug]
    RECORD.write_text(json.dumps(record, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    for folder in (OUT_DIR.iterdir() if OUT_DIR.exists() else []):
        keep = {colour_file(c) for c in wanted.get(folder.name, set())}
        for f in folder.glob("*.webp"):
            if f.name not in keep:
                f.unlink()
                print(f"  removed unused {folder.name}/{f.name}")
        if not any(folder.iterdir()):
            folder.rmdir()


if __name__ == "__main__":
    main()
