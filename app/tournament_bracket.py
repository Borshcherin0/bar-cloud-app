"""Build and resolve a fixed elimination bracket."""
from math import ceil, log2


def build_bracket(players, double):
    matches = []

    def add(group, round_no, left, right):
        number = len(matches) + 1
        matches.append({
            "id": number, "group": group, "round": round_no,
            "sources": [left, right], "score": None, "confirmed": False,
        })
        return ("win", number)

    def pairs(group, round_no, slots):
        return [add(group, round_no, slots[i], slots[i + 1])
                for i in range(0, len(slots), 2)]

    rounds = ceil(log2(len(players)))
    seeds = [0, 1]
    while len(seeds) < 2 ** rounds:
        size = len(seeds) * 2
        seeds = [seed for index in seeds for seed in (index, size - 1 - index)]
    slots = [("player", seed if seed < len(players) else None) for seed in seeds]
    upper = [pairs("upper", 1, slots)]
    for round_no in range(2, rounds + 1):
        upper.append(pairs("upper", round_no, upper[-1]))

    if double:
        lower = [("loss", number) for _, number in upper[0]]
        if len(lower) > 1:
            lower = pairs("lower", 1, lower)
        for index in range(1, rounds):
            drops = [("loss", number) for _, number in upper[index]]
            if len(drops) > 1:
                drops = [drops[i ^ 1] for i in range(len(drops))]
            lower = pairs("lower", index * 2, [
                slot for pair in zip(lower, drops) for slot in pair
            ])
            if len(lower) > 1:
                lower = pairs("lower", index * 2 + 1, lower)
        add("final", 1, upper[-1][0], lower[0])
    return matches


def resolve_bracket(matches):
    """Distinguish an unresolved slot from a confirmed bye."""
    outcomes = {}
    resolved = []
    for match in matches:
        slots = [((True, source) if kind == "player" else
                  outcomes.get((kind, source), (False, None)))
                 for kind, source in match["sources"]]
        players = [player for _, player in slots]
        known = all(ready for ready, _ in slots)
        ready = known and all(player is not None for player in players)
        winner = loser = None
        if ready and match["confirmed"]:
            side = int(match["score"][1] > match["score"][0])
            winner, loser = players[side], players[1 - side]
        elif known and not ready:
            winner = next((p for p in players if p is not None), None)

        done = known and (not ready or match["confirmed"])
        number = match["id"]
        outcomes["win", number] = (done, winner)
        outcomes["loss", number] = (done, loser)
        resolved.append({
            **match, "players": players, "known": [slot[0] for slot in slots],
            "ready": ready, "done": done, "winner": winner,
        })
    last = resolved[-1]
    champion = last["winner"]
    reset_needed = (last["group"] == "final" and champion is not None
                    and champion == last["players"][1])
    return resolved, champion if not reset_needed else None, reset_needed
