"""Deterministic generators shared by seeding and the simulator — the Python
mirror of the frontend's history generator (weekday seasonality, per-venue base)."""
import random

CITIES = ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast",
          "Newcastle", "Canberra", "Hobart", "Darwin"]
TYPES = ["Taphouse", "Rooftop Bar", "Bistro", "Grill", "Wine Room", "Brewhouse",
         "Kitchen", "Lounge", "Cantina", "Smokehouse"]
ITEMS = ["Pale Ale Schooner", "Margherita Pizza", "Wagyu Burger", "House Negroni",
         "Loaded Fries", "Espresso Martini", "Garlic Bread", "Chicken Parma",
         "Pinot Noir", "Calamari", "Aperol Spritz", "Tasting Plate",
         "Pulled Pork Roll", "Frozen Margarita", "Truffle Pasta",
         "Salt & Pepper Squid", "Sparkling Water", "Flat White", "Cheese Board",
         "Sticky Date Pudding"]

# Sun..Sat trade weighting
DOW = [0.95, 0.82, 0.85, 0.9, 1.0, 1.35, 1.5]


def venue_names(n=40):
    rnd = random.Random(42)
    out, seen = [], set()
    for _ in range(n):
        name = f"{rnd.choice(CITIES)} {rnd.choice(TYPES)}"
        while name in seen:
            name += " II"
        seen.add(name)
        out.append(name)
    return out


def venue_base(vid):
    return 1500 + random.Random(f"base-{vid}").random() * 7000


def day_metrics(vid, d):
    """Return (net, txns, voids, refunds) for a venue on a given date."""
    base = venue_base(vid)
    dow = DOW[(d.weekday() + 1) % 7]  # Python weekday: Mon=0 → shift to Sun=0
    rnd = random.Random(f"{vid}|{d.isoformat()}")
    net = base * dow * (0.78 + rnd.random() * 0.5)
    avg_ticket = 20 + rnd.random() * 18
    txns = max(1, round(net / avg_ticket))
    voids = round(txns * (0.004 + rnd.random() * 0.02))
    refunds = round(txns * (0.008 + rnd.random() * 0.03))
    return net, txns, voids, refunds


def item_weights(vid):
    rnd = random.Random(f"w-{vid}")
    raw = {it: 0.3 + random.Random(f"w-{vid}-{it}").random() for it in ITEMS}
    total = sum(raw.values())
    return {it: raw[it] / total for it in ITEMS}


def item_price(it):
    return 7 + random.Random(f"p-{it}").random() * 33
