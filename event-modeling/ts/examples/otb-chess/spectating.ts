// Spectators watch the broadcast and read the result. They never act on the game.

import { z } from "zod"
import { m } from "#em"

import { GameRecord } from "./conclusion.ts"
import { GameState, MoveList } from "./play.ts"
import { ChessService, Spectator } from "./setup.ts"

export const Spectating = m.chapter([
  m
    .slice()
    .actor(Spectator)
    .query({ gameId: z.string() })
    .reads(GameState)
    .reads(MoveList)
    .service(ChessService, "WatchBroadcast")
    .note("The live position and the moves so far, as the broadcast shows them."),

  m
    .slice()
    .actor(Spectator)
    .query({ round: z.number().int() })
    .reads(GameRecord)
    .service(ChessService, "GetCrosstable")
    .note("The finished games of a round."),
])
