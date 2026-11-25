// An event storm: events in a stream and no slice yet, each on the timeline where it is declared.

import { d, m, t } from "#em"

m.stream("Games")
m.event("GameStarted", { gameId: t.string() }).stream(d.Games)
m.event("MoveMade", { gameId: t.string(), san: t.string() }).stream(d.Games)
m.event("GameEnded", { gameId: t.string(), result: t.string() }).stream(d.Games)
export default m.model("Chess")
