// The arbiter rules on an illegal move and keeps count of them per player.

import { d, m, t } from "#em"
import { illegalMoveRuled } from "./play.ts"

// How many illegal moves each side has made. FIDE 7.5.5 escalates on the second.
m.view("IllegalMoveTally", {
  gameId: t.string().key(),
  offendingSide: t.enum(["white", "black"]).key(),
  illegalMoveCount: t.int(),
})

// The ruling that makes it two says so, so the forfeiter hears only the offence that forfeits.
m.event("SecondIllegalMoveRuled", {
  gameId: t.string(),
  offendingSide: t.enum(["white", "black"]),
  illegalMoveCount: t.int(),
}).stream(d.Game)

export const secondIllegalMoveRuled = d.IllegalMoveRuled({
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
const kingIntoOwnPawn = d.MovePlayed({
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

export const secondOffence = d.SecondIllegalMoveRuled({
  gameId: "otb-2024-ct-r5-b1",
  offendingSide: "white",
  illegalMoveCount: 2,
})

m.chapter("ArbiterRulings", 4)

m.slice()
  .command(d.RuleIllegalMove)
  .query(d.MoveList, (c) => ({ gameId: c.RuleIllegalMove.gameId, ply: c.RuleIllegalMove.ply }))
  .query(d.IllegalMoveTally, (c) => ({
    gameId: c.RuleIllegalMove.gameId,
    offendingSide: c.RuleIllegalMove.offendingSide,
  }))
  .event(d.IllegalMoveRuled, (c) => c.RuleIllegalMove)
  .event(d.SecondIllegalMoveRuled, (c) => c.RuleIllegalMove)
  .chapter(d.ArbiterRulings)
  .actor(d.Arbiter)
  .service(d.ChessService)
  .note(
    "FIDE 7.5.1: the position before the illegal move is reinstated. 7.5.5: the first one adds two minutes to the opponent, the second one loses the game.",
  )
  .test("An illegal move is struck and two minutes are added to the opponent", {
    given: illegalMoveRuled,
    when: d.RuleIllegalMove({
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
    when: d.RuleIllegalMove({
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
  .view(d.IllegalMoveTally)
  .event(d.IllegalMoveRuled, (c) => ({ illegalMoveCount: m.generate(c.IllegalMoveRuled) }))
  .chapter(d.ArbiterRulings)
  .test("One ruling puts the offender on one illegal move", {
    given: illegalMoveRuled,
    then: d.IllegalMoveTally({
      gameId: "otb-2024-ct-r5-b1",
      offendingSide: "white",
      illegalMoveCount: 1,
    }),
  })
  .test("A second ruling puts the offender on two", {
    given: [illegalMoveRuled, secondIllegalMoveRuled],
    then: d.IllegalMoveTally({
      gameId: "otb-2024-ct-r5-b1",
      offendingSide: "white",
      illegalMoveCount: 2,
    }),
  })
