// The arbiter rules on an illegal move and keeps count of them per player.

import { z } from "zod"
import { m } from "#em"
import { IllegalMoveRuled, illegalMoveRuled, RuleIllegalMove } from "./play.ts"
import { Arbiter, ChessService } from "./setup.ts"

// How many illegal moves each side has made. FIDE 7.5.5 escalates on the second.
export const IllegalMoveTally = m.readModel({
  gameId: m.key(z.string()),
  offendingSide: m.key(z.enum(["white", "black"])),
  illegalMoveCount: z.number().int(),
})

export const secondIllegalMoveRuled = IllegalMoveRuled.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 44,
  offendingSide: "white",
  illegalMoveCount: 2,
  addedTimeMs: 0,
  penalty: "loss",
  fen: "r5k1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R5K1 w - - 6 22",
  sideToMove: "white",
})

export const ArbiterRulings = m.chapter([
  m
    .slice()
    .actor(Arbiter)
    .reads(IllegalMoveTally)
    .service(ChessService)
    .command(RuleIllegalMove)
    .emits(IllegalMoveRuled)
    .note(
      "FIDE 7.5.1: the position before the illegal move is reinstated. 7.5.5: the first one adds two minutes to the opponent, the second one loses the game.",
    )
    .test("An illegal move is struck and two minutes are added to the opponent", {
      given: illegalMoveRuled,
      when: RuleIllegalMove.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 32,
        offendingSide: "white",
        illegalMoveCount: 1,
        addedTimeMs: 120000,
        penalty: "opponent_time_added",
        fen: "r4rk1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R4RK1 w - - 4 17",
        sideToMove: "white",
      }),
      then: illegalMoveRuled,
    })
    .test("A second illegal move by the same player carries the loss", {
      given: illegalMoveRuled,
      when: RuleIllegalMove.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 44,
        offendingSide: "white",
        illegalMoveCount: 2,
        addedTimeMs: 0,
        penalty: "loss",
        fen: "r5k1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R5K1 w - - 6 22",
        sideToMove: "white",
      }),
      then: secondIllegalMoveRuled,
    }),

  m
    .slice()
    .projects(IllegalMoveTally)
    .on(IllegalMoveRuled, (e) => ({ illegalMoveCount: m.count(e) }))
    .test("One ruling puts the offender on one illegal move", {
      given: illegalMoveRuled,
      then: IllegalMoveTally.with({
        gameId: "otb-2024-ct-r5-b1",
        offendingSide: "white",
        illegalMoveCount: 1,
      }),
    })
    .test("A second ruling puts the offender on two", {
      given: [illegalMoveRuled, secondIllegalMoveRuled],
      then: IllegalMoveTally.with({
        gameId: "otb-2024-ct-r5-b1",
        offendingSide: "white",
        illegalMoveCount: 2,
      }),
    }),
])
