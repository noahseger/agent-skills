// Spectators watch the broadcast and read the result. They never act on the game.

import { m, z } from "#em"

import { GameRecord } from "./conclusion.ts"
import { GameState, MoveList } from "./play.ts"
import { ChessService, Spectator } from "./setup.ts"

export const Spectating = [
  m
    .slice()
    .view(GameState, MoveList)
    .query({ gameId: z.string() })
    .actor(Spectator)
    .service(ChessService, "WatchBroadcast")
    .note("The live position and the moves so far, as the broadcast shows them."),

  m
    .slice()
    .view(GameRecord)
    .query({ round: z.number().int() })
    .actor(Spectator)
    .service(ChessService, "GetCrosstable")
    .note("The finished games of a round."),
]
