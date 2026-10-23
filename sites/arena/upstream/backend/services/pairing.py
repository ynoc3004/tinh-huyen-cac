import random
from collections import Counter
import networkx as nx

def split_groups(players, n_groups, mode="random", seed=None):
    """players: [(id, rating)]. Chia kiểu rắn để các bảng đều quân số; mode='seeded' rải theo rating."""
    ps = sorted(players, key=lambda p: p[0])
    random.Random(seed).shuffle(ps)
    if mode == "seeded":
        ps.sort(key=lambda p: -(p[1] or 0))
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
    "round_robin": ("de", "sb", "wins"),
}


def standings(pairs, fmt="swiss", player_ids=(), total_rounds=None):
    """Rank by the application's published tie-break order; unresolved ties share rank.

    Swiss full-point byes use a dummy with the participant's own final score,
    capped at half the declared rounds (FIDE tie-break rules, March 2026, 16.4.2).
    Round-robin rests award no points and do not contribute an opponent.
    Forfeits, requested byes and withdrawals are not supported here.
    """
    games = []
    for i, t in enumerate(pairs, 1):
        w, b, r = t[0], t[1], t[2]
        rnd = t[3] if len(t) > 3 and t[3] is not None else i
        games.append((rnd, w, b, r))
    games.sort(key=lambda g: g[0])
    total_rounds = total_rounds if total_rounds is not None else max((g[0] for g in games), default=0)

    pts = dict.fromkeys(player_ids, 0.0)
    for _, w, b, _r in games:
        for x in (w, b):
            if x is not None:
                pts.setdefault(x, 0.0)

    # Điểm theo từng vòng (để tính đối thủ ảo) và danh sách ván đã có kết quả
    played = []  # (rnd, w, b, sw, sb)
    byes = []    # (rnd, player)
    for rnd, w, b, r in games:
        if b is None:
            if fmt != "round_robin" and w is not None and r in (None, "bye", "1-0"):
                byes.append((rnd, w))
        elif r in SCORE:
            sw, sbk = SCORE[r]
            played.append((rnd, w, b, sw, sbk))

    run = dict.fromkeys(pts, 0.0)
    events = {}
    for rnd, w, b, sw, sbk in played:
        events.setdefault(rnd, []).append((w, sw))
        events.setdefault(rnd, []).append((b, sbk))
    for rnd, x in byes:
        events.setdefault(rnd, []).append((x, 1.0))
    for rnd in sorted(events):
        for x, v in events[rnd]:
            run[x] += v
    pts = dict(run) if run else pts
    for x in list(pts):
        pts.setdefault(x, 0.0)

    opp = {x: [] for x in pts}       # (điểm đối thủ, kết quả của x)
    wins = dict.fromkeys(pts, 0)
    head = {x: {} for x in pts}      # head[x][y] = điểm x lấy được khi gặp y
    head_count = Counter()
    for rnd, w, b, sw, sbk in played:
        opp[w].append((pts[b], sw))
        opp[b].append((pts[w], sbk))
        head[w][b] = head[w].get(b, 0.0) + sw
        head[b][w] = head[b].get(w, 0.0) + sbk
        head_count[frozenset((w, b))] += 1
        if sw == 1:
            wins[w] += 1
        if sbk == 1:
            wins[b] += 1
    for rnd, x in byes:
        opp[x].append((min(pts[x], 0.5 * total_rounds), 1.0))
    for x in head:
        for y in head[x]:
            head[x][y] /= head_count[frozenset((x, y))]

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
                # A Swiss leader can be certain even when some encounters are missing.
                if fmt == "swiss":
                    low = {x: sum(head[x].get(y, 0) for y in group if y != x) for x in group}
                    high = {x: low[x] + sum(y not in head[x] for y in group if y != x) for x in group}
                    for x in group:
                        if all(low[x] > high[y] for y in group if y != x):
                            return [[x]] + split([y for y in group if y != x], level)
                return split(group, level + 1)
        else:
            sc = keys[k]
        buckets = {}
        for x in group:
            buckets.setdefault(round(sc[x], 6), []).append(x)
        out = []
        for v in sorted(buckets, reverse=True):
            sub = buckets[v]
            out += split(sub, level if k == "de" and len(buckets) > 1 else level + 1)
        return out

    by_pts = {}
    for x in pts:
        by_pts.setdefault(pts[x], []).append(x)
    order = []
    ranks = {}
    for pv in sorted(by_pts, reverse=True):
        for grp in split(sorted(by_pts[pv]), 0):
            for x in grp:
                ranks[x] = len(order) + 1
            order += grp

    de_show = {}
    for pv, grp in by_pts.items():
        sc = de_scores(grp)
        for x in grp:
            de_show[x] = None if sc is None else round(sc[x], 2)

    return [
        {
            "student_id": x,
            "rank": ranks[x],
            "points": pts[x],
            "de": de_show.get(x),
            "bhc1": None if fmt == "round_robin" else round(bhc1[x], 2),
            "bh": None if fmt == "round_robin" else round(bh[x], 2),
            "sb": round(sb[x], 2),
            "wins": wins[x],
        }
        for i, x in enumerate(order)
    ]


def knockout_standings(pairs, player_ids=()):
    """Place by progress through the bracket, never by total points including byes."""
    reach = dict.fromkeys(player_ids, 0)
    wins = dict.fromkeys(player_ids, 0)
    for w, b, result, rnd in pairs:
        for x in (w, b):
            if x is not None:
                reach[x] = max(reach.get(x, 0), rnd)
                wins.setdefault(x, 0)
        if b is not None and result in ("1-0", "0-1"):
            winner = w if result == "1-0" else b
            wins[winner] += 1
            reach[winner] = max(reach[winner], rnd + 1)
    order = sorted(reach, key=lambda x: (-reach[x], x))
    rank, prev, out = 0, None, []
    for i, x in enumerate(order, 1):
        if reach[x] != prev:
            rank, prev = i, reach[x]
        out.append({"student_id": x, "rank": rank, "points": wins[x], "wins": wins[x],
                    "de": None, "bhc1": None, "bh": None, "sb": None})
    return out


def draw_groups(players, n, mode="pots", seed=None, avoid_club=True):
    """players: [(id, rating, club)]. mode 'pots' / 'random'. avoid_club: tránh cùng đơn vị chung bảng."""
    rng = random.Random(seed)
    if n < 1 or n > len(players):
        raise ValueError("Số bảng không hợp lệ")
    ps = sorted(((i, rating, (club or '').strip().casefold()) for i, rating, club in players), key=lambda p: p[0])
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


class PairingError(ValueError):
    pass


def _colour_cost(history, colour, strict):
    balance = history.count("w") - history.count("b") + (1 if colour == "w" else -1)
    violation = abs(balance) > 2 or history[-2:] == [colour, colour]
    if strict and violation:
        return None
    return (100 if violation else 0) + abs(balance) * 2 + int(_color_pref(history) not in (None, colour))


def _match(ids, pairs, ratings, seed, strict):
    """Complete global matching. Swiss constraints never silently fall back to repeats.

    This is a club pairing system, NOT an implementation of the FIDE Dutch system.
    Blossom chooses a full matching before allocating any board or bye.
    """
    ids = sorted(ids)
    if len(ids) != len(set(ids)):
        raise PairingError("Danh sách ghép cặp có người trùng")
    if not ids:
        return []
    ratings = ratings or {}
    rng = random.Random(seed)
    lot = {x: rng.random() for x in ids}
    pts, colors, opponents, had_bye = _player_stats(ids, pairs)
    order = sorted(ids, key=lambda x: (-pts[x], -(ratings.get(x) or 0), lot[x]))
    rank = {x: i for i, x in enumerate(order)}
    encounters, latest = Counter(), {}
    last_played = dict.fromkeys(ids, -1)
    for i, (w, b, result) in enumerate(pairs):
        if b is not None and result in SCORE:
            key = frozenset((w, b))
            encounters[key] += 1
            latest[key] = i
            for x in (w, b):
                if x in last_played:
                    last_played[x] = i
    # Split each score group into upper/lower halves as a low-priority preference.
    target = {}
    for score in set(pts.values()):
        group = [x for x in order if pts[x] == score]
        half = len(group) // 2
        for a, b in zip(group[:half], group[half:]):
            target[frozenset((a, b))] = True
    graph = nx.Graph()
    graph.add_nodes_from(order)
    orientations = {}
    n = len(ids)
    colour_unit = (n + 1) ** 2
    gap_unit = colour_unit * (n + 1) * 220
    repeat_unit = gap_unit * (n + 1) * (len(pairs) + 1) * 2
    for i, a in enumerate(order):
        for b in order[i + 1:]:
            key = frozenset((a, b))
            if strict and b in opponents[a]:
                continue
            options = []
            for w, black in ((a, b), (b, a)):
                cw = _colour_cost(colors[w], "w", strict)
                cb = _colour_cost(colors[black], "b", strict)
                if cw is not None and cb is not None:
                    # Initial colour is drawn from the persisted tournament seed.
                    preferred_white = a if (rank[a] + int(lot[a] >= .5)) % 2 == 0 else b
                    options.append((cw + cb, int(w != preferred_white), w, black))
            if not options:
                continue
            cost, _, w, black = min(options)
            orientations[key] = (w, black)
            quality = int(abs(pts[a] - pts[b]) * 2) * gap_unit + cost * colour_unit
            quality += int(key not in target) * (n + 1) + abs(rank[a] - rank[b])
            if not strict:
                # Arena permits repeats; prefer fewer meetings, then less recent ones.
                quality += encounters[key] * repeat_unit + (latest.get(key, -1) + 1) * gap_unit
            graph.add_edge(a, b, weight=-quality)
    bye = object()
    if n % 2:
        graph.add_node(bye)
        bye_unit = repeat_unit * (n + 1) * (len(pairs) + 1)
        for x in order:
            if strict and had_bye[x]:
                continue
            # Swiss: lowest score/rank eligible player; Arena: rest the most recent player.
            cost = (int(pts[x] * 2) * (n + 1) + n - rank[x]) if strict else len(pairs) - last_played[x]
            graph.add_edge(x, bye, weight=-cost * bye_unit)
    matching = nx.max_weight_matching(graph, maxcardinality=True)
    if len(matching) * 2 != len(graph):
        raise PairingError("Không có lịch ghép đủ người mà vẫn tránh tái đấu, lặp bye và vi phạm màu quân. Cần trọng tài xử lý; chưa tạo vòng mới.")
    result = []
    for a, b in matching:
        if a is bye or b is bye:
            result.append((b if a is bye else a, None))
        else:
            result.append(orientations[frozenset((a, b))])
    return sorted(result, key=lambda p: (p[1] is None, min(rank[p[0]], rank[p[1]]) if p[1] is not None else n))


def swiss_pair(ids, pairs, ratings=None, seed=0):
    return _match(ids, pairs, ratings, seed, strict=True)


def arena_pair(ids, pairs, ratings=None, seed=0):
    # The unpaired participant stays waiting and receives no score.
    return [(w, b) for w, b in _match(ids, pairs, ratings, seed, strict=False) if b is not None]


def recommended_swiss_rounds(n_players):
    """Số vòng Swiss khuyến nghị (~ceil(log2(n)))."""
    if n_players <= 2:
        return 1
    r, s = 1, 2
    while s < n_players:
        s *= 2
        r += 1
    return r
