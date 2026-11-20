// An event storm: events in a stream and no slice yet. `view` draws it; `json` refuses it.

import { z } from "zod"
import { m } from "#em"

export const Games = m.stream()
export const GameStarted = m.event({ gameId: z.string() }).stream(Games)
export const MoveMade = m.event({ gameId: z.string(), san: z.string() }).stream(Games)
export const GameEnded = m.event({ gameId: z.string(), result: z.string() }).stream(Games)
export default m.model("Chess")
