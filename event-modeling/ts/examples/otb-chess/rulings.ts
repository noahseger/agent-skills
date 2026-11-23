// The arbiter rules on an illegal move and keeps count of them per player.

import { m, t } from "#em"
import {
  IllegalMoveRuled,
  illegalMoveRuled,
  MoveList,
  MovePlayed,
  RuleIllegalMove,
} from "./play.ts"
import { Arbiter, ChessService, Game } from "./setup.ts"

// How many illegal moves each side has made. FIDE 7.5.5 escalates on the second.
export const IllegalMoveTally = m
  .view({
    gameId: t.string(),
    offendingSide: t.enum(["white", "black"]),
    illegalMoveCount: t.int(),
  })
  .key("gameId", "offendingSide")

// The ruling that makes it two says so, so the forfeiter hears only the offence that forfeits.
export const SecondIllegalMoveRuled = m
  .event({
    gameId: t.string(),
    offendingSide: t.enum(["white", "black"]),
    illegalMoveCount: t.int(),
  })
  .stream(Game)

export const secondIllegalMoveRuled = IllegalMoveRuled({
  gameId: "otb-2024-ct-r5-b1",
  ply: 44,
  offendingSide: "white",
  illegalMoveCount: 2,
  addedTimeMs: 0,
  penalty: "loss",
  fen: "r5k1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R5K1 w - - 6 22",
  sideToMove: "white",
})

// White's king steps onto its own pawn: the move the arbiter strikes second.
const kingIntoOwnPawn = MovePlayed({
  gameId: "otb-2024-ct-r5-b1",
  ply: 44,
  san: "Kf2",
  fromSquare: "g1",
  toSquare: "f2",
  piece: "king",
  fen: "r5k1/pp3ppp/2p5/8/8/2P2N2/PP3KPP/R7 b - - 7 22",
  sideToMove: "black",
  isCheck: false,
  isCapture: false,
})

export const secondOffence = SecondIllegalMoveRuled({
  gameId: "otb-2024-ct-r5-b1",
  offendingSide: "white",
  illegalMoveCount: 2,
})

export const ArbiterRulings = m.chapter(4)

m.slice()
  .command({ RuleIllegalMove })
  .query({ MoveList }, (c) => ({ gameId: c.RuleIllegalMove.gameId, ply: c.RuleIllegalMove.ply }))
  .query({ IllegalMoveTally }, (c) => ({
    gameId: c.RuleIllegalMove.gameId,
    offendingSide: c.RuleIllegalMove.offendingSide,
  }))
  .event({ IllegalMoveRuled }, (c) => c.RuleIllegalMove)
  .event({ SecondIllegalMoveRuled }, (c) => c.RuleIllegalMove)
  .chapter(ArbiterRulings)
  .actor(Arbiter)
  .service(ChessService)
  .note(
    "FIDE 7.5.1: the position before the illegal move is reinstated. 7.5.5: the first one adds two minutes to the opponent, the second one loses the game.",
  )
  .test("An illegal move is struck and two minutes are added to the opponent", {
    given: illegalMoveRuled,
    when: RuleIllegalMove({
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
    given: [illegalMoveRuled, kingIntoOwnPawn],
    when: RuleIllegalMove({
      gameId: "otb-2024-ct-r5-b1",
      ply: 44,
      offendingSide: "white",
      illegalMoveCount: 2,
      addedTimeMs: 0,
      penalty: "loss",
      fen: "r5k1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R5K1 w - - 6 22",
      sideToMove: "white",
    }),
    then: [secondIllegalMoveRuled, secondOffence],
  })

m.slice()
  .view({ IllegalMoveTally })
  .event({ IllegalMoveRuled }, (c) => ({ illegalMoveCount: m.generate(c.IllegalMoveRuled) }))
  .chapter(ArbiterRulings)
  .test("One ruling puts the offender on one illegal move", {
    given: illegalMoveRuled,
    then: IllegalMoveTally({
      gameId: "otb-2024-ct-r5-b1",
      offendingSide: "white",
      illegalMoveCount: 1,
    }),
  })
  .test("A second ruling puts the offender on two", {
    given: [illegalMoveRuled, secondIllegalMoveRuled],
    then: IllegalMoveTally({
      gameId: "otb-2024-ct-r5-b1",
      offendingSide: "white",
      illegalMoveCount: 2,
    }),
  })
