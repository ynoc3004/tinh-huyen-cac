REALMS = [(0, "Phàm Nhân"), (800, "Luyện Khí"), (1200, "Trúc Cơ"), (1500, "Kim Đan"), (1800, "Nguyên Anh"), (2000, "Hóa Thần")]
GAME_CLASSES = {
    "bullet", "blitz", "rapid", "classical", "daily", "correspondence",
    "standard", "chess960", "ultrabullet",
}

def realm(rating: int) -> dict:
    rating = int(rating)
    i = max(k for k, (lo, _) in enumerate(REALMS) if rating >= lo)
    lo, name = REALMS[i]
    hi = REALMS[i + 1][0] if i + 1 < len(REALMS) else lo + 450
    span = max(hi - lo, 1)
    tier = min(9, 1 + int((rating - lo) / span * 9))
    return {"realm": name, "tier": tier, "progress": round(min(1, (rating - lo) / span), 2)}

def summary(rows: list) -> dict:
    items = []
    for r in rows:
        if r.get("rating") is None:
            continue
        items.append({**r, **realm(int(r["rating"]))})
    games = [x for x in items if str(x.get("time_class") or "").lower() in GAME_CLASSES]
    pool = games or items
    tu = min(pool, key=lambda x: (int(x["rating"]), x.get("platform") or "", x.get("time_class") or "")) if pool else None
    for x in items:
        x["is_can_co"] = bool(
            tu
            and x.get("platform") == tu.get("platform")
            and x.get("time_class") == tu.get("time_class")
            and int(x["rating"]) == int(tu["rating"])
        )
    items.sort(key=lambda x: (int(x["rating"]), x.get("platform") or "", x.get("time_class") or ""))
    return {"tu_vi": tu, "mach": items}
