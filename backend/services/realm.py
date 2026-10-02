REALMS = [(0, "Phàm Nhân"), (800, "Luyện Khí"), (1200, "Trúc Cơ"), (1500, "Kim Đan"), (1800, "Nguyên Anh"), (2000, "Hóa Thần")]
def realm(rating: int) -> dict:
    i = max(k for k, (lo, _) in enumerate(REALMS) if rating >= lo)
    lo, name = REALMS[i]
    hi = REALMS[i + 1][0] if i + 1 < len(REALMS) else lo + 450
    tier = min(9, 1 + int((rating - lo) / (hi - lo) * 9))
    return {"realm": name, "tier": tier, "progress": round(min(1, (rating - lo) / (hi - lo)), 2)}
