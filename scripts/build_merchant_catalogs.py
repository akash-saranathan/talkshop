"""
Builds the six merchant catalogs in backend/data/<merchant>_catalog.json.

    python scripts/build_merchant_catalogs.py

Every product lists only the colours it has a convincing Pixabay photo for:
each colour names the hand-picked photo (pixabay_id) and how to cut it out
(mode, see scripts/fetch_catalog_photos.py). Sizes refer to a named range in
SIZE_RANGES instead of being repeated per product, and stock is described by
exceptions (out_of_stock) rather than a full variant table.

After changing this file:
    python scripts/build_merchant_catalogs.py
    .venv-photos/Scripts/python scripts/fetch_catalog_photos.py
then restart the backend.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "backend" / "data"

HEX = {  # colour name -> swatch colour
    "Black": "#1c1c1e", "White": "#f5f5f2", "Grey": "#8e9196", "Silver": "#c0c3c7",
    "Navy": "#1f2a44", "Navy/Pink": "#2a3a6e", "Navy/Red": "#27304f", "Navy/Gold": "#2b2f4a",
    "Blue": "#2f5fb3", "Light Blue": "#8fb3d9", "Denim Blue": "#4a6f9c", "Teal": "#2bb3b1",
    "Coral": "#f0705a", "Volt": "#d7f23a", "Orange/Blue": "#e0702f", "White/Black": "#e9e9e6",
    "Red": "#c0392b", "Burgundy": "#7a1f2b", "Pink": "#e8a0b4", "Rose": "#d9a3a6",
    "Purple": "#6d4c9f", "Yellow": "#e7c33a", "Green": "#3e7d4f", "Green Floral": "#4f6b45",
    "Ivory": "#f1ead9", "Cream": "#efe6d2", "White/Navy": "#dfe3ea", "Two-Tone": "#b8a27a", "Beige": "#d9c7a7", "Sand": "#d8c49b", "Brown": "#7a4a2a",
    "Gold": "#c9a74a", "Rose Gold": "#c99a86", "Gunmetal": "#4a4d52", "Black/White": "#3a3a3a",
    "Black/Brown": "#3b2a20", "Blue/Rose Gold": "#2d3f66",
}

SIZE_RANGES = {
    "shoe_men": ["7", "8", "9", "10", "11", "12", "13"],
    "shoe_unisex": ["6", "7", "8", "9", "10", "11", "12"],
    "apparel_men": ["S", "M", "L", "XL", "XXL"],
    "apparel_women": ["XS", "S", "M", "L", "XL"],
    "apparel_unisex": ["XS", "S", "M", "L", "XL"],
    "jeans_women": ["24", "26", "28", "30", "32"],
    "watch_28": ["28mm"],
    "watch_36_40": ["36mm", "40mm"],
    "watch_40": ["40mm"],
    "watch_42": ["42mm"],
    "watch_42_44": ["42mm", "44mm"],
    "watch_44": ["44mm"],
    "watch_45": ["45mm"],
    "watch_46": ["46mm"],
    "watch_48": ["48mm"],
    "watch_50": ["50mm"],
}

MERCHANTS = {
    "nike": ("Nike", ["shoes", "running", "sneakers", "sportswear", "apparel", "clothing"]),
    "adidas": ("Adidas", ["shoes", "running", "sneakers", "sportswear", "apparel", "clothing"]),
    "zara": ("Zara", ["dresses", "clothing", "apparel", "fashion", "tops", "bottoms", "outerwear"]),
    "hm": ("H&M", ["dresses", "clothing", "apparel", "fashion", "tops", "bottoms", "knitwear"]),
    "fossil": ("Fossil", ["watches", "accessories", "smartwatch"]),
    "casio": ("Casio", ["watches", "accessories", "digital"]),
}

CATALOG: dict[str, list[dict]] = {m: [] for m in MERCHANTS}


def photo(pixabay_id: int, mode: str = "studio", **extra) -> dict:
    return {"pixabay_id": pixabay_id, "mode": mode, **extra}


def slugify(name: str) -> str:
    slug = name.lower().replace(" & ", " and ").replace("&", "")
    for ch in "'\"().,":
        slug = slug.replace(ch, "")
    return "-".join(slug.replace("/", " ").split())


def add(merchant, product_id, name, *, department, category, subcategory, gender, price,
        rating, reviews, days, sizes, colors, description, tags, new=False, oos=None, label="Size"):
    CATALOG[merchant].append({
        "product_id": product_id,
        "slug": slugify(name),
        "name": name,
        "brand": MERCHANTS[merchant][0],
        "department": department,
        "category": category,
        "subcategory": subcategory,
        "gender": gender,
        "price": price,
        "currency": "USD",
        "rating": rating,
        "review_count": reviews,
        "delivery_days": days,
        "is_new": new,
        "option_label": label,
        "sizes": sizes,
        "colors": [{"name": c, "hex": HEX[c], "photo": p} for c, p in colors],
        "description": description,
        "tags": tags,
        "out_of_stock": oos or [],
    })


# ── NIKE ──────────────────────────────────────────────────────────────────────
add("nike", "nike_pegasus_42", "Nike Air Zoom Pegasus 42", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=99.99, rating=4.6, reviews=1240, days=2, sizes="shoe_unisex",
    colors=[("Coral", photo(1324431)), ("Teal", photo(2799608))],
    description="Lightweight daily trainer with React foam cushioning and a smooth ride.",
    tags=["everyday running", "cushioned", "road"], oos=[{"size": "11", "color": "Teal"}])
add("nike", "nike_free_run_5", "Nike Free Run 5.0", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=89.99, rating=4.5, reviews=890, days=2, sizes="shoe_unisex",
    colors=[("Grey", photo(2605582))],
    description="Flexible everyday runner with a natural motion feel and lightweight mesh upper.",
    tags=["flexible", "lightweight", "everyday running"])
add("nike", "nike_vomero_18", "Nike Vomero 18", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=129.99, rating=4.7, reviews=645, days=2, sizes="shoe_unisex",
    colors=[("Volt", photo(3714720))],
    description="Maximum cushioning for long-distance comfort with a ZoomX foam stack.",
    tags=["max cushioning", "long distance", "road"], new=True)
add("nike", "nike_zoom_fly_6", "Nike Zoom Fly 6", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=139.99, rating=4.8, reviews=412, days=3, sizes="shoe_unisex",
    colors=[("Black", photo(5578113))],
    description="Carbon-fibre plate racer for tempo runs and race day performance.",
    tags=["racing", "carbon plate", "tempo"], new=True)
add("nike", "nike_air_max_90", "Nike Air Max 90", department="shoes", category="sneakers",
    subcategory="shoes", gender="unisex", price=109.99, rating=4.5, reviews=2310, days=2, sizes="shoe_unisex",
    colors=[("Navy/Pink", photo(5041718, "largest"))],
    description="Iconic visible-Air heel for all-day cushioning and streetwear style.",
    tags=["lifestyle", "streetwear", "air cushioning"])
add("nike", "nike_air_force_1", "Nike Air Force 1 '07", department="shoes", category="sneakers",
    subcategory="shoes", gender="unisex", price=94.99, rating=4.7, reviews=5420, days=2, sizes="shoe_unisex",
    colors=[("White", photo(5126389, "largest"))],
    description="The classic low-top with Air cushioning, a streetwear staple since 1982.",
    tags=["classic", "lifestyle", "streetwear"])
add("nike", "nike_metcon_9", "Nike Metcon 9", department="shoes", category="running",
    subcategory="training shoes", gender="unisex", price=124.99, rating=4.6, reviews=560, days=3,
    sizes="shoe_unisex", colors=[("Orange/Blue", photo(3699954))],
    description="Stable cross-training shoe for weightlifting, HIIT and gym workouts.",
    tags=["training", "gym", "stable"])
add("nike", "nike_dri_fit_tshirt", "Nike Dri-FIT Training T-Shirt", department="clothing", category="sportswear",
    subcategory="tops", gender="men", price=34.99, rating=4.4, reviews=1890, days=2, sizes="apparel_men",
    colors=[("Black", photo(1886001, "largest", kernel=25)), ("White", photo(1278404))],
    description="Sweat-wicking Dri-FIT fabric keeps you dry and comfortable during any workout.",
    tags=["t-shirt", "training", "sweat-wicking"])

# ── ADIDAS ────────────────────────────────────────────────────────────────────
add("adidas", "adidas_ultraboost_22", "Adidas Ultraboost 22", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=109.99, rating=4.7, reviews=2100, days=3, sizes="shoe_unisex",
    colors=[("White", photo(5418991, "onblack")), ("Grey", photo(2554690))],
    description="Premium energy-return runner with a Boost midsole and Primeknit upper.",
    tags=["cushioned", "energy return", "road"])
add("adidas", "adidas_solarboost_4", "Adidas Solarboost 4", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=94.99, rating=4.5, reviews=890, days=3, sizes="shoe_unisex",
    colors=[("White/Navy", photo(974715, "largest"))],
    description="Energised long-run shoe with Boost cushioning and a supportive upper.",
    tags=["long distance", "supportive", "road"])
add("adidas", "adidas_supernova_rise", "Adidas Supernova Rise", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=84.99, rating=4.4, reviews=540, days=3, sizes="shoe_unisex",
    colors=[("Black", photo(5418985))],
    description="Versatile everyday trainer with a responsive Dreamstrike+ midsole.",
    tags=["everyday running", "responsive"], new=True)
add("adidas", "adidas_sl20", "Adidas SL20.3", department="shoes", category="running",
    subcategory="shoes", gender="unisex", price=79.99, rating=4.3, reviews=320, days=2, sizes="shoe_unisex",
    colors=[("White", photo(5418982))],
    description="Lightweight speed shoe with Lightstrike cushioning for tempo training.",
    tags=["lightweight", "tempo", "speed"])
add("adidas", "adidas_forum_low", "Adidas Forum Low", department="shoes", category="sneakers",
    subcategory="shoes", gender="unisex", price=89.99, rating=4.5, reviews=1650, days=2, sizes="shoe_unisex",
    colors=[("Navy/Gold", photo(2498994))],
    description="Retro basketball silhouette reimagined for everyday street style.",
    tags=["retro", "basketball", "lifestyle"])
add("adidas", "adidas_nmd_r1", "Adidas NMD_R1", department="shoes", category="sneakers",
    subcategory="shoes", gender="unisex", price=119.99, rating=4.6, reviews=1980, days=3, sizes="shoe_unisex",
    colors=[("Black", photo(5418990))],
    description="Urban runner icon with Boost cushioning and a sock-like Primeknit upper.",
    tags=["lifestyle", "boost", "streetwear"])
add("adidas", "adidas_adicolor_tshirt", "Adidas Adicolor T-Shirt", department="clothing", category="sportswear",
    subcategory="tops", gender="unisex", price=29.99, rating=4.3, reviews=760, days=2, sizes="apparel_unisex",
    colors=[("White", photo(9611374))],
    description="Classic tee in soft cotton jersey, an everyday essential.",
    tags=["t-shirt", "cotton", "everyday"])
add("adidas", "adidas_tiro_pants", "Adidas Tiro 23 Track Pants", department="clothing", category="sportswear",
    subcategory="bottoms", gender="men", price=44.99, rating=4.5, reviews=1100, days=2, sizes="apparel_men",
    colors=[("Navy", photo(2685231))],
    description="Slim-fit training pants with zip pockets for training and travel.",
    tags=["track pants", "training", "slim fit"])

# ── ZARA ──────────────────────────────────────────────────────────────────────
add("zara", "zara_floral_midi_dress", "Zara Floral Print Midi Dress", department="clothing", category="dresses",
    subcategory="midi", gender="women", price=59.99, rating=4.5, reviews=430, days=4, sizes="apparel_women",
    colors=[("Green Floral", photo(2840834))],
    description="Flowy midi dress with an all-over floral print, perfect for warm weather.",
    tags=["floral", "midi", "summer"])
add("zara", "zara_satin_slip_dress", "Zara Satin Slip Dress", department="clothing", category="dresses",
    subcategory="evening", gender="women", price=79.99, rating=4.6, reviews=290, days=4, sizes="apparel_women",
    colors=[("Ivory", photo(8338852))],
    description="Elegant satin dress with fine straps, from dinner to a night out.",
    tags=["satin", "evening", "elegant"])
add("zara", "zara_linen_blazer", "Zara Linen Blazer", department="clothing", category="clothing",
    subcategory="outerwear", gender="men", price=99.99, rating=4.4, reviews=380, days=4, sizes="apparel_men",
    colors=[("Beige", photo(340826))],
    description="Relaxed single-button linen blazer, versatile for work or weekend.",
    tags=["blazer", "linen", "smart casual"])
add("zara", "zara_wide_leg_trousers", "Zara Wide-Leg Trousers", department="clothing", category="clothing",
    subcategory="bottoms", gender="women", price=49.99, rating=4.5, reviews=510, days=4, sizes="apparel_women",
    colors=[("Black", photo(4415148))],
    description="High-waist wide-leg trousers in fluid fabric, effortless and polished.",
    tags=["trousers", "wide leg", "high waist"])
add("zara", "zara_ribbed_knit_top", "Zara Ribbed Knit Top", department="clothing", category="clothing",
    subcategory="tops", gender="women", price=29.99, rating=4.3, reviews=670, days=4, sizes="apparel_women",
    colors=[("Yellow", photo(4430382)), ("Grey", photo(3847132))],
    description="Fitted ribbed knit top, a wardrobe staple.",
    tags=["knit", "ribbed", "top"])
add("zara", "zara_sundress", "Zara Linen Sundress", department="clothing", category="dresses",
    subcategory="maxi", gender="women", price=69.99, rating=4.6, reviews=350, days=4, sizes="apparel_women",
    colors=[("White", photo(107269))],
    description="Breezy linen sundress for a relaxed summer look.",
    tags=["linen", "summer", "sundress"])
add("zara", "zara_cropped_jacket", "Zara Cropped Jacket", department="clothing", category="clothing",
    subcategory="outerwear", gender="women", price=89.99, rating=4.4, reviews=280, days=4, sizes="apparel_women",
    colors=[("Black", photo(2821961)), ("Light Blue", photo(2566082))],
    description="Cropped jacket in quilted faux leather or washed denim, an easy layering piece.",
    tags=["jacket", "cropped", "layering"])
add("zara", "zara_bow_blouse", "Zara Bow-Neck Blouse", department="clothing", category="clothing",
    subcategory="tops", gender="women", price=45.99, rating=4.4, reviews=190, days=4, sizes="apparel_women",
    colors=[("White", photo(2180509))],
    description="Crisp white blouse with a contrast bow at the neck, pairs well with trousers or jeans.",
    tags=["blouse", "office", "bow"])
add("zara", "zara_evening_gown", "Zara Evening Gown", department="clothing", category="dresses",
    subcategory="evening", gender="women", price=119.99, rating=4.7, reviews=145, days=5, sizes="apparel_women",
    colors=[("Red", photo(5660012))],
    description="Floor-length gown designed for special occasions.",
    tags=["gown", "evening", "formal"], oos=[{"size": "XL"}])

# ── H&M ───────────────────────────────────────────────────────────────────────
add("hm", "hm_pleated_dress", "H&M Pleated Chiffon Dress", department="clothing", category="dresses",
    subcategory="casual", gender="women", price=34.99, rating=4.3, reviews=820, days=5, sizes="apparel_women",
    colors=[("Cream", photo(4202487))],
    description="Light pleated chiffon dress with a soft, flowing skirt.",
    tags=["dress", "pleated", "chiffon"])
add("hm", "hm_denim_dress", "H&M Tiered Denim Dress", department="clothing", category="dresses",
    subcategory="midi", gender="women", price=39.99, rating=4.2, reviews=650, days=5, sizes="apparel_women",
    colors=[("Denim Blue", photo(8568399))],
    description="Relaxed tiered midi dress in soft washed denim.",
    tags=["denim", "midi", "casual"])
add("hm", "hm_oversized_shirt", "H&M Oxford Shirt", department="clothing", category="clothing",
    subcategory="tops", gender="men", price=19.99, rating=4.2, reviews=1890, days=5, sizes="apparel_men",
    colors=[("White", photo(3740340)), ("Pink", photo(3740347)), ("Navy", photo(2947549))],
    description="Oxford shirt in crisp cotton, easy to dress up or down.",
    tags=["shirt", "oxford", "cotton"])
add("hm", "hm_slim_jeans", "H&M Skinny High Jeans", department="clothing", category="clothing",
    subcategory="bottoms", gender="women", price=29.99, rating=4.3, reviews=2400, days=5, sizes="jeans_women",
    colors=[("Black", photo(4514891)), ("Blue", photo(4514892))],
    description="High-rise skinny jeans in stretch denim, a reliable everyday staple.",
    tags=["jeans", "skinny", "stretch"], oos=[{"size": "24", "color": "Black"}])
add("hm", "hm_chino_shorts", "H&M Chino Shorts", department="clothing", category="clothing",
    subcategory="bottoms", gender="men", price=22.99, rating=4.2, reviews=1050, days=5, sizes="apparel_men",
    colors=[("Sand", photo(601564))],
    description="Breathable cotton chino shorts, a summer essential.",
    tags=["shorts", "summer", "chino"])
add("hm", "hm_embroidered_blouse", "H&M Embroidered Blouse", department="clothing", category="clothing",
    subcategory="tops", gender="women", price=27.99, rating=4.3, reviews=730, days=5, sizes="apparel_women",
    colors=[("White", photo(18664))],
    description="Lightweight white blouse with delicate embroidery.",
    tags=["blouse", "embroidered", "summer"])
add("hm", "hm_knit_cardigan", "H&M Patterned Knit Cardigan", department="clothing", category="clothing",
    subcategory="knitwear", gender="women", price=34.99, rating=4.4, reviews=890, days=5, sizes="apparel_women",
    colors=[("Black/White", photo(3831827)), ("Burgundy", photo(3831826))],
    description="Soft open-front cardigan with a jacquard pattern, the perfect layering piece.",
    tags=["cardigan", "knit", "layering"])
add("hm", "hm_knit_sweater", "H&M Oversized Knit Sweater", department="clothing", category="clothing",
    subcategory="knitwear", gender="women", price=32.99, rating=4.4, reviews=1120, days=5, sizes="apparel_women",
    colors=[("Beige", photo(3847148)), ("Rose", photo(3847119))],
    description="Cosy oversized sweater in a chunky knit.",
    tags=["sweater", "knit", "oversized"], new=True)

# ── FOSSIL ────────────────────────────────────────────────────────────────────
add("fossil", "fossil_gen6_smartwatch", "Fossil Gen 6 Smartwatch", department="accessories", category="watches",
    subcategory="smartwatch", gender="unisex", price=199.99, rating=4.4, reviews=1250, days=3,
    sizes="watch_42_44", label="Case size", colors=[("Black", photo(889639))],
    description="Wear OS smartwatch with health tracking, GPS and fast charging.",
    tags=["smartwatch", "fitness", "gps"])
add("fossil", "fossil_neutra_chrono", "Fossil Neutra Chronograph", department="accessories", category="watches",
    subcategory="chronograph", gender="men", price=149.99, rating=4.5, reviews=780, days=3,
    sizes="watch_44", label="Case size", colors=[("Brown", photo(4895498))],
    description="Chronograph with a minimalist dial and genuine leather strap.",
    tags=["chronograph", "leather strap", "classic"])
add("fossil", "fossil_minimalist_watch", "Fossil Minimalist Watch", department="accessories", category="watches",
    subcategory="minimalist", gender="unisex", price=89.99, rating=4.3, reviews=1640, days=3,
    sizes="watch_36_40", label="Case size",
    colors=[("Gold", photo(4895499)), ("Silver", photo(183145))],
    description="Slim dress watch with a clean dial.",
    tags=["minimalist", "dress watch", "slim"])
add("fossil", "fossil_machine_auto", "Fossil Machine Automatic", department="accessories", category="watches",
    subcategory="automatic", gender="men", price=229.99, rating=4.6, reviews=430, days=4,
    sizes="watch_42", label="Case size", colors=[("Silver", photo(4623183))],
    description="Self-winding automatic movement on show through an open-heart dial.",
    tags=["automatic", "skeleton", "mechanical"])
add("fossil", "fossil_ladies_carlie", "Fossil Carlie Watch", department="accessories", category="watches",
    subcategory="ladies", gender="women", price=109.99, rating=4.5, reviews=960, days=3,
    sizes="watch_28", label="Case size",
    colors=[("Gold", photo(140488)), ("Silver", photo(3737339))],
    description="Feminine three-hand watch with a slim bracelet.",
    tags=["ladies", "bracelet", "elegant"])
add("fossil", "fossil_hybrid_smartwatch", "Fossil Hybrid Smartwatch HR", department="accessories", category="watches",
    subcategory="smartwatch", gender="men", price=129.99, rating=4.2, reviews=560, days=3,
    sizes="watch_42", label="Case size", colors=[("Black/Brown", photo(1766858))],
    description="Analog watch face with smart features and heart-rate tracking.",
    tags=["hybrid", "smartwatch", "leather strap"])
add("fossil", "fossil_nate_chrono", "Fossil Nate Chronograph", department="accessories", category="watches",
    subcategory="chronograph", gender="men", price=169.99, rating=4.4, reviews=380, days=3,
    sizes="watch_50", label="Case size",
    colors=[("Two-Tone", photo(466360))],
    description="Bold oversized chronograph with a stainless steel bracelet.",
    tags=["chronograph", "oversized", "sporty"])

# ── CASIO ─────────────────────────────────────────────────────────────────────
add("casio", "casio_gshock_ga2100", "Casio G-Shock GA-2100", department="accessories", category="watches",
    subcategory="sport", gender="unisex", price=99.99, rating=4.7, reviews=3200, days=3,
    sizes="watch_45", label="Case size",
    colors=[("Blue/Rose Gold", photo(761271)), ("Green", photo(6904008))],
    description="Analog-digital G-Shock, shockproof and water resistant to 200m.",
    tags=["g-shock", "shockproof", "analog-digital"])
add("casio", "casio_edifice_efr", "Casio Edifice EFR-539", department="accessories", category="watches",
    subcategory="chronograph", gender="men", price=119.99, rating=4.5, reviews=640, days=3,
    sizes="watch_46", label="Case size", colors=[("Silver", photo(7655723))],
    description="Stainless steel chronograph with tachymeter bezel, sporty and refined.",
    tags=["chronograph", "stainless steel", "edifice"])
add("casio", "casio_pro_trek", "Casio Pro Trek PRW-3500", department="accessories", category="watches",
    subcategory="outdoor", gender="men", price=139.99, rating=4.6, reviews=420, days=3,
    sizes="watch_48", label="Case size", colors=[("Black", photo(1435348))],
    description="Outdoor watch with altimeter, barometer and compass.",
    tags=["outdoor", "hiking", "triple sensor"])
add("casio", "casio_gshock_gbd200", "Casio G-Shock GBD-200", department="accessories", category="watches",
    subcategory="sport", gender="unisex", price=89.99, rating=4.5, reviews=870, days=3,
    sizes="watch_46", label="Case size",
    colors=[("Red", photo(7420334)), ("White", photo(2619634))],
    description="Step-tracking G-Shock with Bluetooth and built-in running features.",
    tags=["g-shock", "running", "bluetooth"])
add("casio", "casio_gshock_dw6900", "Casio G-Shock DW-6900", department="accessories", category="watches",
    subcategory="digital", gender="unisex", price=69.99, rating=4.5, reviews=1100, days=3,
    sizes="watch_40", label="Case size", colors=[("Black", photo(1283309))],
    description="Classic digital G-Shock, tough, simple and water resistant to 200m.",
    tags=["g-shock", "digital", "classic"])
add("casio", "casio_gshock_ga100", "Casio G-Shock GA-100", department="accessories", category="watches",
    subcategory="digital", gender="unisex", price=99.99, rating=4.7, reviews=1850, days=3,
    sizes="watch_48", label="Case size", colors=[("Black", photo(7703039))],
    description="Big-face analog-digital G-Shock with world time and a 200m water rating.",
    tags=["g-shock", "analog-digital", "black"])


def main() -> None:
    for merchant, products in CATALOG.items():
        used = sorted({p["sizes"] for p in products})
        doc = {
            "merchant": {"merchant_id": merchant, "merchant_name": MERCHANTS[merchant][0],
                         "categories": MERCHANTS[merchant][1]},
            "size_ranges": {name: SIZE_RANGES[name] for name in used},
            "products": products,
        }
        path = DATA_DIR / f"{merchant}_catalog.json"
        path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        colours = sum(len(p["colors"]) for p in products)
        print(f"{path.name}: {len(products)} products, {colours} colour photos")


if __name__ == "__main__":
    main()
