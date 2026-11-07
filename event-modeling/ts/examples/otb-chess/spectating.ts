// Spectators watch the broadcast and read the result. They never act on the game.

import { m, z } from "#em"

import { GameRecord, resultRecorded } from "./conclusion.ts"
import { e4, GameState, MoveList, OPENING_FEN } from "./play.ts"
import { ChessService, gameStarted, Spectator } from "./setup.ts"

export const Spectating = m.chapter()

m.slice()
  .view(GameState, MoveList)
  .chapter(Spectating)
  .query({ gameId: z.string() })
  .actor(Spectator)
  .service(ChessService, "WatchBroadcast")
  .note("The live position and the moves so far, as the broadcast shows them.")
  .test("The broadcast shows the board and the scoresheet after 1. e4", {
    given: [gameStarted, e4],
    when: { gameId: "otb-2024-ct-r5-b1" },
    then: [
      GameState({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        sideToMove: "black",
        fen: OPENING_FEN,
      }),
      MoveList({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        san: "e4",
        sideToMove: "black",
        isCheck: false,
        isCapture: false,
        status: "recorded",
      }),
    ],
  })

m.slice()
  .view(GameRecord)
  .chapter(Spectating)
  .query({ round: z.number().int() })
  .actor(Spectator)
  .service(ChessService, "GetCrosstable")
  .note("The finished games of a round.")
  .test("Round 5 shows its recorded draw", {
    given: resultRecorded,
    when: { round: 5 },
    then: GameRecord({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
      result: "draw",
      termination: "agreement",
    }),
  })
