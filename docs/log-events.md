# Game-log events (log-format v2)

Since schema v2, `state.log` is a `GameLogEntry[]` (framework
`digital-boardgame-framework` ≥ 0.42.0, `core/game-log`), not a prose
`string[]`. Every entry carries:

- `seq` — monotonic event index (stable across cap trims)
- `turn` — `state.turnNumber` at append time
- `phase` — `playing | finalRound | gameOver`
- `side` — acting seat id (`p1`, `p2`, …; the Rogue's seat id in solo), or
  `null` for neutral events
- `kind` + `payload` — structured event data (below)
- `msg` — the human-readable prose line (what the UI renders)

All entries go through the single choke point `logEvent()` in
`src/engine/setup.ts`, which stamps the fields above and trims the in-state
log to the last **500** entries (`LOG_CAP`).

Migration: v1 snapshots stored `log: string[]`. `tegAdapter.migrate()` wraps
old lines via the framework's `upgradeProseLog`, producing `kind: 'legacy'`
entries (prose in `msg`, no payload), so in-flight KV games keep rendering.

## Kinds registry

| kind | payload | notes |
|---|---|---|
| `legacy` | — | migrated v1 prose line |
| `dice.roll` | `{ faces: DieFace[], count }` | start-of-turn roll (also solo/Rogue turns) |
| `dice.reroll` | `{ dieIds: number[], free?: boolean, via?: 'cp25' }` | free/paid reroll; `via: 'cp25'` = ZALAX |
| `dice.convert` | `{ spend: [id, id], target: id, face }` | the Converter |
| `ship.move` | `{ shipIdx, dest: ShipLocation, via?: 'cp21' \| 'cp23' }` | `via`: NAGATO move / PIEDES repeated move |
| `ship.advance` | `{ shipIdx, advance: 'diplomacy' \| 'economy' }` | orbit-track advance |
| `resource.acquire` | `{ resource: 'energy' \| 'culture', amount }` | acquire die |
| `empire.upgrade` | `{ level, pay: 'energy' \| 'culture', cost }` | galaxy colony action |
| `colonize` | `{ planetId, vp }` | planet slid under the mat |
| `planet.effect` | `{ planetId, source: 'surface' \| 'colony' \| 'follow' }` | a planet card's action resolved (card id in `planetId`) |
| `planet.nagato` | `{ planetId: 'cp21', ok: boolean, reason?, cultureSpent?, moves? }` | NAGATO setup / refusal |
| `planet.skip` | `{ planetId }` | player declined the optional action |
| `follow` | `{ face, cultureSpent, params }` | a player followed an activation |
| `game.finalRound` | `{ player, vp }` | 21+ VP reached, final round triggered |
| `game.over` | `{ winners: string[], ranking?: string[], solo?: true }` | terminal entry |
| `rogue.advance` | `{ type: 'diplomacy' \| 'economy' }` | Rogue advances all matching ships |
| `rogue.acquire` | `{ resource, amount? , unusable?: true }` | Rogue acquire die |
| `rogue.move` | `{ usable: boolean }` | Rogue ship into orbit (or no-op) |
| `rogue.colonyAction` | `{ card: RogueCardId, level: 1..5 }` | Rogue Colony Action ladder step |
| `rogue.reroll` | `{ face }` | advanced difficulty: unusable die rerolled |
| `rogue.upgrade` | `{ level }` | energy-maxed empire upgrade |
| `rogue.bonus` | `{ actions: 3 }` | culture-maxed bonus actions |

No entries are `secret` today (secret missions are redacted in `viewFor`,
not logged). If a future event must be side-private, set `secret: true` and
route views through the framework's `redactGameLog`.
