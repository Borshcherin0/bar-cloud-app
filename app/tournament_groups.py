from itertools import combinations

from app.tournament_bracket import resolve_bracket, seeded_slots


def make_group(count, first_id):
    return [
        {"id": match_id, "players": [left, right], "score": None,
         "confirmed": False, "ready": True, "done": False, "winner": None, "wins_required": 2}
        for match_id, (left, right) in enumerate(combinations(range(count), 2), first_id)
    ]


def group_table(matches, count):
    rows = [dict(player=i, wins=0, losses=0, won=0, lost=0) for i in range(count)]
    head_to_head = {}
    for match in matches:
        if not match["confirmed"]:
            continue
        left, right = match["players"]
        a, b = match["score"]
        for player, opponent, own, other in ((left, right, a, b), (right, left, b, a)):
            row = rows[player]
            row["won"] += own
            row["lost"] += other
            row["wins"] += int(own > other)
            row["losses"] += int(own < other)
            head_to_head[player, opponent] = (int(own > other), own - other)
    # Rank tied players using only their matches against one another.
    for row in rows:
        player = row["player"]
        rivals = [r["player"] for r in rows if r["wins"] == row["wins"] and r["player"] != player]
        records = [head_to_head.get((player, rival), (0, 0)) for rival in rivals]
        row["rank_key"] = (row["wins"], sum(r[0] for r in records), sum(r[1] for r in records))
    return sorted(rows, key=lambda row: row["rank_key"], reverse=True)


def make_playoff(seeds, first_id):
    matches = []

    def add(group, round_no, left, right):
        match_id = first_id + len(matches)
        matches.append({
            "id": match_id, "group": group, "round": round_no,
            "sources": [left, right], "score": None, "confirmed": False,
            "wins_required": 3 if group == "final" else 2,
        })
        return ("win", match_id)

    def knockout(group, slots):
        if len(slots) == 1:
            return slots[0]
        slots = seeded_slots(slots)
        round_no = 1
        while len(slots) > 1:
            slots = [add(group, round_no, slots[i], slots[i + 1])
                     for i in range(0, len(slots), 2)]
            round_no += 1
        return slots[0]

    split = (len(seeds) + 1) // 2
    upper = knockout("upper", [("player", player) for player in seeds[:split]])
    # A bye advances its winner but cannot send anyone to the lower bracket.
    drops = [("loss", match["id"]) for match in matches
             if all(source != ("player", None) for source in match["sources"])]
    lower_slots = [("player", player) for player in seeds[split:]]
    if drops:
        lower = knockout("lower", lower_slots + drops[:-1])
        lower_round = max((m["round"] for m in matches if m["group"] == "lower"), default=0) + 1
        lower = add("lower", lower_round, lower, drops[-1])
    else:
        lower = knockout("lower", lower_slots)
    add("final", 1, upper, lower)
    return matches


def advance_group(state):
    group = state["groups"][-1]
    if not all(match["confirmed"] for match in group):
        return
    count = len(state["players"])
    rows = group_table(group, count)
    split = (count + 1) // 2
    all_tied = rows[0]["wins"] == rows[-1]["wins"]
    cutoff_tied = rows[split - 1]["rank_key"] == rows[split]["rank_key"]
    first_id = group[-1]["id"] + 1
    if all_tied or cutoff_tied:
        state["groups"].append(make_group(count, first_id))
    else:
        state["matches"] = make_playoff([row["player"] for row in rows], first_id)


def playoff_view(matches):
    if not matches:
        return [], None
    resolved, champion, _ = resolve_bracket(matches, final_reset=False)
    upper = [m for m in resolved if m["group"] == "upper"]
    lower = [m for m in resolved if m["group"] == "lower"]
    upper_done = all(m["done"] for m in upper)
    for match in lower:
        match["ready"] = match["ready"] and upper_done
    for stage, label in ((upper, "Финал виннеров"), (lower, "Финал лузеров")):
        if stage:
            stage[-1]["label"] = label
    return resolved, champion


def playoff_places(matches, champion, count):
    places = [None] * count
    places[champion] = 1
    rank = 2
    eliminations = {}
    for match in reversed(matches):
        if match["group"] == "upper" or not match["confirmed"]:
            continue
        loser = next(p for p in match["players"] if p != match["winner"])
        eliminations.setdefault((match["group"], match["round"]), []).append(loser)
    for players in eliminations.values():
        for player in players:
            places[player] = rank
        rank += len(players)
    return places
