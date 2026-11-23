// The game ends by checkmate, resignation, agreement, or flag fall, and the result is recorded.

import { d, m, t } from "#em"
import { drawAgreed, gameResigned, Result, Termination } from "./draws.ts"
import { illegalMoveRuled, MATE_FEN, mated } from "./play.ts"
import { secondIllegalMoveRuled, secondOffence } from "./rulings.ts"
import { gameStarted } from "./setup.ts"

// FIDE 6.8: a flag has fallen when the arbiter or a player observes it.
m.command("ClaimFlagFall", {
  gameId: t.string(),
  flaggedSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
m.event("TimeForfeited", {
  gameId: t.string(),
  flaggedSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
}).stream(d.Game)

// The position itself ends the game: checkmate, stalemate, or a dead position.
m.command("AdjudicateOutcome", {
  gameId: t.string(),
  ply: t.int(),
  fen: t.string(),
  termination: Termination,
})
m.event("BoardOutcomeAdjudicated", {
  gameId: t.string(),
  ply: t.int(),
  fen: t.string(),
  result: Result,
  termination: Termination,
}).stream(d.Game)

// FIDE 7.5.5: the second illegal move by the same player loses the game.
m.command("ForfeitGame", {
  gameId: t.string(),
  offendingSide: t.enum(["white", "black"]),
  illegalMoveCount: t.int(),
})
m.event("IllegalMoveForfeited", {
  gameId: t.string(),
  offendingSide: t.enum(["white", "black"]),
  illegalMoveCount: t.int(),
  result: Result,
  termination: Termination,
}).stream(d.Game)

// How this game finished, whichever way it finished.
m.view("GameResult", {
  gameId: t.string().key(),
  result: Result,
  termination: Termination,
})

// The arbiter signs the scoresheet and the result goes on the pairing sheet.
m.command("RecordResult", {
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  result: Result,
  termination: Termination,
})
m.event("ResultRecorded", {
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  result: Result,
  termination: Termination,
}).stream(d.Game)

// The finished game as the crosstable shows it.
m.view("GameRecord", {
  gameId: t.string().key(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  result: Result,
  termination: Termination,
})

const STALEMATE_FEN = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 52"
const BARE_KINGS_FEN = "8/8/4k3/8/8/4K3/8/8 w - - 0 45"

const timeForfeited = d.TimeForfeited({
  gameId: "otb-2024-ct-r5-b1",
  flaggedSide: "black",
  result: "white_won",
  termination: "time_forfeit",
})

const checkmate = d.BoardOutcomeAdjudicated({
  gameId: "otb-2024-ct-r5-b1",
  ply: 7,
  fen: MATE_FEN,
  result: "white_won",
  termination: "checkmate",
})

const illegalMoveForfeited = d.IllegalMoveForfeited({
  gameId: "otb-2024-ct-r5-b1",
  offendingSide: "white",
  illegalMoveCount: 2,
  result: "black_won",
  termination: "illegal_move_forfeit",
})

const resultRecorded = d.ResultRecorded({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  result: "draw",
  termination: "agreement",
})

m.chapter("Conclusion", 5)

m.slice()
  .command(d.ClaimFlagFall)
  .query(d.ClockState, "gameId")
  .event(d.TimeForfeited)
  .chapter(d.Conclusion)
  .actor(d.Player)
  .service(d.ChessService)
  .test("White claims Black's fallen flag", {
    given: d.ClockPressed({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 61000,
      blackTimeMs: 0,
      runningSide: "black",
    }),
    when: d.ClaimFlagFall({
      gameId: "otb-2024-ct-r5-b1",
      flaggedSide: "black",
      result: "white_won",
      termination: "time_forfeit",
    }),
    then: timeForfeited,
  })
  .test("A claim while time remains is rejected", {
    given: d.ClockPressed({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 61000,
      blackTimeMs: 240000,
      runningSide: "black",
    }),
    when: d.ClaimFlagFall({
      gameId: "otb-2024-ct-r5-b1",
      flaggedSide: "black",
      result: "white_won",
      termination: "time_forfeit",
    }),
    reject: "that side still has time on the clock",
  })

m.slice("OutcomeAdjudicator")
  .automation(d.GameEnded)
  .command(d.AdjudicateOutcome, (c) => ({ termination: c.GameEnded.ending }))
  .query(d.GameState, "gameId")
  .event(d.BoardOutcomeAdjudicated, (c) => ({
    ...c.AdjudicateOutcome,
    result: m.generate(c.AdjudicateOutcome.termination, c.GameState.sideToMove),
  }))
  .chapter(d.Conclusion)
  .note("The move that ended the game says how. This turns that into a result.")
  .test("Checkmate on the board ends the game", {
    given: [gameStarted, mated],
    when: d.AdjudicateOutcome({
      gameId: "otb-2024-ct-r5-b1",
      ply: 7,
      fen: MATE_FEN,
      termination: "checkmate",
    }),
    then: checkmate,
  })
  .test("Stalemate on the board draws the game", {
    given: [
      gameStarted,
      d.GameEnded({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: STALEMATE_FEN,
        ending: "stalemate",
      }),
    ],
    when: d.AdjudicateOutcome({
      gameId: "otb-2024-ct-r5-b1",
      ply: 103,
      fen: STALEMATE_FEN,
      termination: "stalemate",
    }),
    then: d.BoardOutcomeAdjudicated({
      gameId: "otb-2024-ct-r5-b1",
      ply: 103,
      fen: STALEMATE_FEN,
      result: "draw",
      termination: "stalemate",
    }),
  })
  .test("A capture leaving king against king is a dead position", {
    given: [
      gameStarted,
      d.GameEnded({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: BARE_KINGS_FEN,
        ending: "dead_position",
      }),
    ],
    when: d.AdjudicateOutcome({
      gameId: "otb-2024-ct-r5-b1",
      ply: 88,
      fen: BARE_KINGS_FEN,
      termination: "dead_position",
    }),
    then: d.BoardOutcomeAdjudicated({
      gameId: "otb-2024-ct-r5-b1",
      ply: 88,
      fen: BARE_KINGS_FEN,
      result: "draw",
      termination: "dead_position",
    }),
  })

m.slice("IllegalMoveForfeiter")
  .automation(d.SecondIllegalMoveRuled)
  .command(d.ForfeitGame)
  .query(d.IllegalMoveTally, (c) => ({
    gameId: c.ForfeitGame.gameId,
    offendingSide: c.ForfeitGame.offendingSide,
  }))
  .event(d.IllegalMoveForfeited, (c) => ({
    ...c.ForfeitGame,
    result: m.generate(c.ForfeitGame.offendingSide),
    termination: t.literal("illegal_move_forfeit"),
  }))
  .chapter(d.Conclusion)
  .test("The second illegal move forfeits the game", {
    given: [illegalMoveRuled, secondIllegalMoveRuled, secondOffence],
    when: d.ForfeitGame({
      gameId: "otb-2024-ct-r5-b1",
      offendingSide: "white",
      illegalMoveCount: 2,
    }),
    then: illegalMoveForfeited,
  })

m.slice()
  .view(d.GameResult)
  .event(d.GameResigned)
  .event(d.DrawAgreed)
  .event(d.BoardOutcomeAdjudicated)
  .event(d.TimeForfeited)
  .event(d.IllegalMoveForfeited)
  .chapter(d.Conclusion)
  .note("Five ways a game ends. Each one carries the result and how it came about.")
  .test("Settled after a resignation", {
    given: gameResigned,
    then: d.GameResult({
      gameId: "otb-2024-ct-r5-b1",
      result: "white_won",
      termination: "resignation",
    }),
  })
  .test("Settled after a draw agreement", {
    given: drawAgreed,
    then: d.GameResult({
      gameId: "otb-2024-ct-r5-b1",
      result: "draw",
      termination: "agreement",
    }),
  })
  .test("Settled after checkmate on the board", {
    given: checkmate,
    then: d.GameResult({
      gameId: "otb-2024-ct-r5-b1",
      result: "white_won",
      termination: "checkmate",
    }),
  })
  .test("Settled after a time forfeit", {
    given: timeForfeited,
    then: d.GameResult({
      gameId: "otb-2024-ct-r5-b1",
      result: "white_won",
      termination: "time_forfeit",
    }),
  })
  .test("Settled after a second illegal move", {
    given: illegalMoveForfeited,
    then: d.GameResult({
      gameId: "otb-2024-ct-r5-b1",
      result: "black_won",
      termination: "illegal_move_forfeit",
    }),
  })

m.slice()
  .command(d.RecordResult)
  .query(d.GameResult, "gameId")
  .query(d.GamePairing, "gameId")
  .event(d.ResultRecorded, (c) => c.RecordResult)
  .chapter(d.Conclusion)
  .actor(d.Arbiter)
  .service(d.ChessService)
  .test("The arbiter records the signed draw on the pairing sheet", {
    given: [gameStarted, drawAgreed],
    when: d.RecordResult({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
      result: "draw",
      termination: "agreement",
    }),
    then: resultRecorded,
  })

m.slice()
  .view(d.GameRecord)
  .event(d.ResultRecorded)
  .context({ round: t.int() })
  .chapter(d.Conclusion)
  .actor(d.Spectator)
  .service(d.ChessService, "GetCrosstable")
  .note("The finished games of a round.")
  .test("The recorded game enters the crosstable", {
    given: resultRecorded,
    when: { round: 5 },
    then: d.GameRecord({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
      result: "draw",
      termination: "agreement",
    }),
  })
