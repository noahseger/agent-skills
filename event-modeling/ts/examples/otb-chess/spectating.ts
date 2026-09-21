// Spectators watch the broadcast and read the result. They never act on the game.

import { m, z } from "#em"

import { GameRecord } from "./conclusion.ts"
import { GameState, MoveList } from "./play.ts"
import { Broadcast } from "./setup.ts"

export const Spectating = m.chapter([
  Broadcast.view("WatchBroadcast")
    .query({ gameId: z.string() })
    .reads(GameState)
    .reads(MoveList)
    .note("The live position and the moves so far, as the broadcast shows them."),

  Broadcast.view("GetCrosstable")
    .query({ round: z.number().int() })
    .reads(GameRecord)
    .note("The finished games of a round."),
])
