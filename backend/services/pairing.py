import random
from collections import Counter

def split_groups(players, n_groups, mode="random", seed=None):
    """players: [(id, rating)]. Chia kiểu rắn để các bảng đều quân số; mode='seeded' rải theo rating."""
    ps = list(players)
    if mode == "seeded":
        ps.sort(key=lambda p: -(p[1] or 0))
    else:
        random.Random(seed).shuffle(ps)
    groups = [[] for _ in range(n_groups)]
    for i, p in enumerate(ps):
        k = i % (2 * n_groups)
        groups[k if k < n_groups else 2 * n_groups - 1 - k].append(p[0])
    return groups


def round_robin(ids):
    """Lịch Berger; bye luôn có dạng (người chơi, None)."""
    ids = list(ids)
    if not ids:
        return []
    if len(ids) % 2:
        ids.append(None)
    n = len(ids)
    m = n - 1
    out = []
    for r in range(m):
        a, b = ids[r], ids[n - 1]
        if r % 2:
            a, b = b, a
        rnd = [(a, b)]
        for k in range(1, n // 2):
            a, b = ids[(r + k) % m], ids[(r - k) % m]
            if k % 2:
                a, b = b, a
            rnd.append((a, b))
        out.append([(y, x) if x is None else (x, y) for x, y in rnd])
    return out


SCORE = {"1-0": (1, 0), "0-1": (0, 1), "1/2": (0.5, 0.5)}


TIEBREAK_ORDER = {
    # Thụy Sĩ: đối đầu, Buchholz bỏ 1, Buchholz, Sonneborn-Berger, số ván thắng
    "swiss": ("de", "bhc1", "bh", "sb", "wins"),
    # Vòng tròn: đối đầu, Sonneborn-Berger, số ván thắng, rồi Buchholz
    "round_robin": ("de", "sb", "wins", "bhc1", "bh"),
}


def standings(pairs, fmt="swiss"):
    """pairs: [(white, black, result[, round])] -> xếp hạng theo điểm rồi 5 hệ số phụ FIDE.

    Hệ số: de (đối đầu), bhc1 (Buchholz bỏ 1 thấp nhất), bh (Buchholz),
    sb (Sonneborn-Berger), wins (số ván thắng trên bàn cờ).
    Ván nghỉ (bye) dùng đối thủ ảo theo quy định FIDE: điểm đối thủ ảo =
    điểm của người chơi trước vòng đó + (1 - kết quả) + 0.5 x số vòng còn lại.
    Nếu thiếu số vòng (tuple 3 phần tử) thì lấy thứ tự trong danh sách làm thứ tự vòng.
    """
    games = []
    for i, t in enumerate(pairs):
        w, b, r = t[0], t[1], t[2]
        rnd = t[3] if len(t) > 3 and t[3] is not None else i
        games.append((rnd, w, b, r))
    games.sort(key=lambda g: g[0])

    pts = {}
    for _, w, b, _r in games:
        for x in (w, b):
            if x:
                pts.setdefault(x, 0.0)

    # Điểm theo từng vòng (để tính đối thủ ảo) và danh sách ván đã có kết quả
    played = []  # (rnd, w, b, sw, sb)
    byes = []    # (rnd, player)
    for rnd, w, b, r in games:
        if b is None:
            if w and r in (None, "bye", "1-0"):
                byes.append((rnd, w))
        elif r in SCORE:
            sw, sbk = SCORE[r]
            played.append((rnd, w, b, sw, sbk))

    before = {}  # (player, rnd) -> điểm trước vòng rnd
    run = dict.fromkeys(pts, 0.0)
    events = {}
    for rnd, w, b, sw, sbk in played:
        events.setdefault(rnd, []).append((w, sw))
        events.setdefault(rnd, []).append((b, sbk))
    for rnd, x in byes:
        events.setdefault(rnd, []).append((x, 1.0))
    for rnd in sorted(events):
        for x in pts:
            before[(x, rnd)] = run[x]
        for x, v in events[rnd]:
            run[x] += v
    pts = dict(run) if run else pts
    for x in list(pts):
        pts.setdefault(x, 0.0)
    total_rounds = max(events) if events else 0

    opp = {x: [] for x in pts}       # (điểm đối thủ, kết quả của x)
    wins = dict.fromkeys(pts, 0)
    head = {x: {} for x in pts}      # head[x][y] = điểm x lấy được khi gặp y
    for rnd, w, b, sw, sbk in played:
        opp[w].append((pts[b], sw))
        opp[b].append((pts[w], sbk))
        head[w][b] = head[w].get(b, 0.0) + sw
        head[b][w] = head[b].get(w, 0.0) + sbk
        if sw == 1:
            wins[w] += 1
        if sbk == 1:
            wins[b] += 1
    for rnd, x in byes:
        remaining = total_rounds - rnd
        virtual = before.get((x, rnd), 0.0) + 0.0 + 0.5 * max(0, remaining)
        opp[x].append((virtual, 1.0))

    bh = {x: sum(o[0] for o in v) for x, v in opp.items()}
    bhc1 = {x: (bh[x] - min(o[0] for o in v)) if v else 0.0 for x, v in opp.items()}
    sb = {x: sum(o[0] * o[1] for o in v) for x, v in opp.items()}
    keys = {"bh": bh, "bhc1": bhc1, "sb": sb, "wins": {x: float(v) for x, v in wins.items()}}

    def de_scores(group):
        """Điểm đối đầu trong nhóm bằng điểm; None nếu chưa đủ ván đấu giữa mọi cặp."""
        if len(group) < 2:
            return None
        for a in group:
            for b in group:
                if a != b and b not in head[a]:
                    return None
        return {a: sum(head[a][b] for b in group if b != a) for a in group}

    order_keys = TIEBREAK_ORDER.get(fmt, TIEBREAK_ORDER["swiss"])

    def split(group, level):
        if len(group) < 2 or level >= len(order_keys):
            return [group]
        k = order_keys[level]
        if k == "de":
            sc = de_scores(group)
            if sc is None:
                return split(group, level + 1)
        else:
            sc = keys[k]
        buckets = {}
        for x in group:
            buckets.setdefault(round(sc[x], 6), []).append(x)
        out = []
        for v in sorted(buckets, reverse=True):
            sub = buckets[v]
            out += split(sub, level + 1)
        return out

    by_pts = {}
    for x in pts:
        by_pts.setdefault(pts[x], []).append(x)
    order = []
    for pv in sorted(by_pts, reverse=True):
        for grp in split(sorted(by_pts[pv]), 0):
            order += grp

    de_show = {}
    for pv, grp in by_pts.items():
        sc = de_scores(grp)
        for x in grp:
            de_show[x] = None if sc is None else round(sc[x], 2)

    return [
        {
            "student_id": x,
            "rank": i + 1,
            "points": pts[x],
            "de": de_show.get(x),
            "bhc1": round(bhc1[x], 2),
            "bh": round(bh[x], 2),
            "sb": round(sb[x], 2),
            "wins": wins[x],
        }
        for i, x in enumerate(order)
    ]


def draw_groups(players, n, mode="pots", seed=None, avoid_club=True):
    """players: [(id, rating, club)]. mode 'pots' / 'random'. avoid_club: tránh cùng đơn vị chung bảng."""
    rng = random.Random(seed)
    ps = list(players)
    rng.shuffle(ps)
    pots_mode = mode != "random"
    if pots_mode:
        ps.sort(key=lambda p: -(p[1] or 0))
    groups, tier = [[] for _ in range(n)], {}
    for ti, pot in enumerate(ps[i : i + n] for i in range(0, len(ps), n)):
        order = list(range(n)) if len(pot) == n else rng.sample(range(n), len(pot))
        if pots_mode:
            rng.shuffle(pot)
        for p, gi in zip(pot, order):
            groups[gi].append(p)
            tier[p[0]] = ti if pots_mode else 0
    cnt = [Counter(p[2] for p in g if p[2]) for g in groups]
    if avoid_club:
        for _ in range(30):
            moved = False
            for a in range(n):
                for p in list(groups[a]):
                    c = p[2]
                    if not c or cnt[a][c] < 2:
                        continue
                    hit = None
                    for b in range(n):
                        if b == a:
                            continue
                        for q in groups[b]:
                            d = q[2]
                            if tier[q[0]] != tier[p[0]] or d == c:
                                continue
                            delta = cnt[b][c] - (cnt[a][c] - 1) + (
                                (cnt[a][d] - (cnt[b][d] - 1)) if d else 0
                            )
                            if delta < 0:
                                hit = (b, q)
                                break
                        if hit:
                            break
                    if hit:
                        b, q = hit
                        d = q[2]
                        ia, ib = groups[a].index(p), groups[b].index(q)
                        groups[a][ia], groups[b][ib] = q, p
                        cnt[a][c] -= 1
                        cnt[b][c] += 1
                        if d:
                            cnt[a][d] += 1
                            cnt[b][d] -= 1
                        moved = True
            if not moved:
                break
    conflicts = sum(v * (v - 1) // 2 for k in cnt for v in k.values())
    return [[p[0] for p in g] for g in groups], conflicts


def _player_stats(ids, pairs):
    """Từ lịch sử pairings tính điểm, màu đã chơi, đối thủ đã gặp."""
    pts = {i: 0.0 for i in ids}
    colors = {i: [] for i in ids}
    opponents = {i: set() for i in ids}
    had_bye = {i: False for i in ids}
    for w, b, r in pairs:
        if w is None and b is None:
            continue
        if b is None:
            if w in pts:
                pts[w] += 1.0
                had_bye[w] = True
            continue
        if r not in SCORE:
            continue
        sw, sb_ = SCORE[r]
        if w in pts:
            pts[w] += sw
            colors[w].append("w")
            opponents[w].add(b)
        if b in pts:
            pts[b] += sb_
            colors[b].append("b")
            opponents[b].add(w)
    return pts, colors, opponents, had_bye


def _color_pref(colors_list):
    if not colors_list:
        return None
    nw = colors_list.count("w")
    nb = colors_list.count("b")
    if nw < nb:
        return "w"
    if nb < nw:
        return "b"
    last = colors_list[-1]
    return "b" if last == "w" else "w"


def swiss_pair(ids, pairs, ratings=None, seed=None):
    """
    Ghép cặp hệ Thụy Sĩ cho 1 vòng tiếp theo.
    ids: list student_id
    pairs: lịch sử [(white_id, black_id, result), ...]
    ratings: dict id -> rating
    Trả về list (white, black); black=None nếu bye.
    """
    ids = list(ids)
    if len(ids) < 2:
        return [(ids[0], None)] if ids else []

    ratings = ratings or {}
    rng = random.Random(seed)
    pts, colors, opponents, had_bye = _player_stats(ids, pairs)

    order = sorted(
        ids,
        key=lambda x: (-pts[x], -(ratings.get(x) or 0), rng.random()),
    )

    paired = set()
    result = []
    n = len(order)

    if n % 2 == 1:
        bye_cand = None
        for x in reversed(order):
            if not had_bye[x]:
                bye_cand = x
                break
        if bye_cand is None:
            bye_cand = order[-1]
        paired.add(bye_cand)
        result.append((bye_cand, None))

    remaining = [x for x in order if x not in paired]

    i = 0
    while i < len(remaining):
        a = remaining[i]
        if a in paired:
            i += 1
            continue
        best = None
        best_score = -999
        for j in range(i + 1, len(remaining)):
            b = remaining[j]
            if b in paired:
                continue
            if b in opponents[a]:
                continue
            score = 0
            if pts[a] == pts[b]:
                score += 100
            else:
                score += 50 - abs(pts[a] - pts[b]) * 10
            pa = _color_pref(colors[a])
            pb = _color_pref(colors[b])
            if pa and pb and pa != pb:
                score += 20
            elif not pa or not pb:
                score += 10
            if score > best_score:
                best_score = score
                best = b
        if best is None:
            for j in range(i + 1, len(remaining)):
                b = remaining[j]
                if b not in paired:
                    best = b
                    break
        if best is None:
            result.append((a, None))
            paired.add(a)
            i += 1
            continue

        pa = _color_pref(colors[a])
        pb = _color_pref(colors[best])
        if pa == "w" or (pa is None and pb == "b") or (
            pa is None and pb is None and (ratings.get(a) or 0) >= (ratings.get(best) or 0)
        ):
            white, black = a, best
        elif pa == "b" or pb == "w":
            white, black = best, a
        else:
            white, black = a, best

        result.append((white, black))
        paired.add(a)
        paired.add(best)
        i += 1

    return result


def recommended_swiss_rounds(n_players):
    """Số vòng Swiss khuyến nghị (~ceil(log2(n)))."""
    if n_players <= 2:
        return 1
    r, s = 1, 2
    while s < n_players:
        s *= 2
        r += 1
    return r
