// An event storm: events in a stream and no slice yet. `view` draws it; `json` refuses it.

import { z } from "zod"
import { m } from "#em"

export const GameStarted = m.event({ gameId: z.string() })
export const MoveMade = m.event({ gameId: z.string(), san: z.string() })
export const GameEnded = m.event({ gameId: z.string(), result: z.string() })
export const Games = m.stream({ GameStarted, MoveMade, GameEnded })
export default m.model("Chess")
