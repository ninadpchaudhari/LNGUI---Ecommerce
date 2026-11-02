"""
Which value sets sentences.toml may use: one value for each filter (category, maxPrice, minRating; inStockOnly is
always true), kept if every pair of the four filters, together, shows fewer products than either one alone, and
still shows some. Then any δ added in MR_AC removes products, but never all of them.
Reads the catalog from the app (app/shared/catalog.ts) and prints every value set that passes, and whether
sentences.toml's is one of them.
Run: python3 helpful_utility_to_generate_cases/values.py
"""
import re
import sys
from itertools import permutations, product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))  # so Python finds app.py, in this folder
from app import load_sentences

CATALOG = Path(__file__).parent.parent / "app" / "shared" / "catalog.ts"
PRODUCTS = [{"category": m[1], "price": float(m[2]), "rating": float(m[3]), "inStock": m[4] == "true"}
            for m in re.finditer(r'category: "(\w+)",\s*price: ([\d.]+),\s*rating: ([\d.]+),\s*inStock: (\w+)',
                                 CATALOG.read_text(encoding="utf-8"))]
CATEGORIES = ["electronics", "books", "clothing", "home", "sports"]
PRICES = [25, 50, 100, 200]  # the prices the app's templates have used
RATINGS = [3, 3.5, 4, 4.5]


def passes(category, price, rating):
    filters = {"category": lambda p: p["category"] == category, "maxPrice": lambda p: p["price"] <= price,
               "minRating": lambda p: p["rating"] >= rating, "inStockOnly": lambda p: p["inStock"]}

    def shown(*names):
        return sum(all(filters[f](p) for f in names) for p in PRODUCTS)

    return all(0 < shown(a, b) < shown(a) for a, b in permutations(filters, 2))


good = [v for v in product(CATEGORIES, PRICES, RATINGS) if passes(*v)]
print(len(PRODUCTS), "products;", len(good), "value sets pass:")
for v in good:
    print("  ", *v)

controls, _ = load_sentences()
chosen = (controls["category"]["value"], controls["maxPrice"]["value"], controls["minRating"]["value"])
print("sentences.toml uses", *chosen, "→", "passes" if chosen in good else "DOES NOT PASS")
