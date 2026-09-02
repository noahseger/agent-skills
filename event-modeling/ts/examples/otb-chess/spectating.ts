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
    .service(ChessService, "WatchBroadcast")
    .note("The live position, as the broadcast shows it."),

  m
    .slice()
    .actor(Spectator)
    .query({ gameId: z.string() })
    .reads(MoveList)
    .service(ChessService, "WatchMoveList")
    .note(
      "The moves so far. A view reads one read model, so the board and the moves are two slices.",
    ),

  m
    .slice()
    .actor(Spectator)
    .query({ round: z.number().int() })
    .reads(GameRecord)
    .service(ChessService, "GetCrosstable")
    .note("The finished games of a round."),
])
