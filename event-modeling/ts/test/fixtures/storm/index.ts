// An event storm: events in a stream and no slice yet. `view` draws it; `json` refuses it.

import { m, t } from "#em"

export const Games = m.stream()
export const GameStarted = m.event({ gameId: t.string() }).stream(Games)
export const MoveMade = m.event({ gameId: t.string(), san: t.string() }).stream(Games)
export const GameEnded = m.event({ gameId: t.string(), result: t.string() }).stream(Games)
export default m.model("Chess")
