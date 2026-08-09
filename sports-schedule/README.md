# Slate

Three teams, two questions: what's on today, and what's on this week.

| Team | League | ESPN id |
| --- | --- | --- |
| Texas A&M Aggies | College football | `football/college-football` / `245` |
| Tampa Bay Buccaneers | NFL | `football/nfl` / `27` |
| Tampa Bay Lightning | NHL | `hockey/nhl` / `20` |

Top section is today. Bottom section is the next 7 days, grouped by day, with
empty days left out. Each card carries both team logos, the `vs` / `@` that
says who is at home, the start time **in the device's own time zone with the
zone named**, the venue, and the TV or streaming channel.

## No GitHub Actions, no data file

The page calls ESPN directly from the browser. This is the opposite of the gas
app next door, and the difference is entirely down to one header: ESPN's site
API answers with `access-control-allow-origin: *`, so a browser is allowed to
read the response, while gas stations send no CORS headers at all and a
committed data file is the only way in.

So there is no workflow, no scraper, and no `data/*.json` here. Nine requests
on load — three teams by three season types — totalling about 65KB compressed.

```
https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams/<id>/schedule?seasontype=<1|2|3>
```

Season type is requested explicitly and the season year is deliberately left
off, so ESPN resolves the year itself. That matters more than it looks: the
NHL's 2026-27 season is year **2027** while the NFL's 2026 season is year
**2026**, and asking for the wrong one silently returns nothing. All three
types are always requested because ESPN will only return one at a time and
returns an empty document for a postseason that has not been drawn up yet
— which is why the default, with no `seasontype` at all, returns *zero* games
for Texas A&M in August.

> **The standing risk:** this API is public but undocumented and unversioned.
> It can change shape without notice. Every field is read defensively and a
> game that cannot be understood is dropped rather than half-rendered, so the
> likely failure is a missing game, not a broken page. If everything vanishes
> at once, that is where to look first.

## Scores and channels

These were the stretch goals, and they turned out to be nearly free — ESPN
returns them in the same payload as the schedule, so leaving them out would
have been extra work. Scores are told from the followed team's side (`W 31–9`,
never "which number is mine"), and a game in progress shows the running score
with no W/L attached to it, because a 14-0 second quarter is not a win.

Channels are tagged by kind: TV, streaming, and radio last. Anything ESPN
marks as a home or away market is labelled `(regional)` — that is the local
broadcast, and it is the one that may be dark where you are.

## Logos

The full-colour marks, on a light chip. ESPN also publishes a `dark` cut of
every logo for dark backgrounds, but they are flat white silhouettes, and
three white silhouettes in a row are much harder to tell apart at a glance
than three real team marks — which defeats the point of having logos.

Every logo goes through ESPN's resizing combiner:

```
https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/nyj.png&w=68&h=68
```

The directory is called `500` but does not promise 500 pixels — that Jets mark
is a **4096px, 130KB** PNG at the raw path, and 1.4KB through the combiner.

## Offline

The service worker caches the app shell and, separately, the logos — a logo
never changes, so it is cache-first forever. The schedule itself is **not**
cached by the worker. The last good set of games is kept in `localStorage`
instead, painted immediately on open and then overwritten by the network, with
an honest `Updated 9h ago` next to it. Two caches of the same thing would only
create a second, staler truth.

A league that fails is isolated: the other two still render, and the card
names which league could not be reached rather than blanking the page.

## Run it locally

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/sports-schedule/
```

Run the tests (no framework, no dependencies):

```bash
node sports-schedule/scripts/test-schedule.mjs
```

They cover the two things that are impossible to eyeball: which calendar day a
game lands on once a time zone is involved — including a 10pm ET puck drop
that is already tomorrow in UTC, and the 7-day boundary from both sides — and
reading a game out of ESPN's payload shape, including the malformed cases that
must drop out.

## Adding a team

Add a row to `js/teams.js`. Nothing else in the app is team-aware.

## Known rough edges

- **No watch links.** ESPN gives a channel *name*, not a URL, so the app can
  tell you it is on ESPN+ but cannot open ESPN+ at that game.
- **Blackouts are not modelled.** A `(regional)` tag is a warning, not an
  answer; whether that feed is actually available where you are sitting is not
  something the payload knows.
- **No notifications.** A PWA can do them on iOS only once installed to the
  home screen, and it needs a push service — the first thing here that would
  genuinely need a backend.
- Preseason, regular season and postseason are merged by event id, because the
  two do occasionally repeat a game across responses.
