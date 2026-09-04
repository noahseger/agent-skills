// The game ends by checkmate, resignation, agreement, or flag fall, and the result is recorded.

import { z } from "zod"
import { m } from "#em"
import { DrawAgreed, drawAgreed, GameResigned, gameResigned, Result, Termination } from "./draws.ts"
import {
  ClockPressed,
  ClockState,
  e4,
  GameState,
  IllegalMoveRuled,
  illegalMoveRuled,
  MovePlayed,
} from "./play.ts"
import { IllegalMoveTally, secondIllegalMoveRuled } from "./rulings.ts"
import { Arbiter, ChessService, GamePairing, gameStarted, Player } from "./setup.ts"

// FIDE 6.8: a flag has fallen when the arbiter or a player observes it.
export const ClaimFlagFall = m.command({
  gameId: z.string(),
  flaggedSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
export const TimeForfeited = m.event({
  gameId: z.string(),
  flaggedSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
export const FlagStanding = m.rejected("that side still has time on the clock")

// The position itself ends the game: checkmate, stalemate, or a dead position.
export const AdjudicateOutcome = m.command({
  gameId: z.string(),
  ply: z.number().int(),
  fen: z.string(),
  result: Result,
  termination: Termination,
})
export const BoardOutcomeAdjudicated = m.event({
  gameId: z.string(),
  ply: z.number().int(),
  fen: z.string(),
  result: Result,
  termination: Termination,
})
export const PositionIsLive = m.rejected("the position is neither mate, stalemate, nor dead")

// FIDE 7.5.5: the second illegal move by the same player loses the game.
export const ForfeitGame = m.command({
  gameId: z.string(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
  result: Result,
  termination: Termination,
})
export const IllegalMoveForfeited = m.event({
  gameId: z.string(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
  result: Result,
  termination: Termination,
})
export const NotYetTwoIllegalMoves = m.rejected("the offender has made only one illegal move")

// How this game finished, whichever way it finished.
export const GameResult = m.readModel({
  gameId: m.key(z.string()),
  result: Result,
  termination: Termination,
})

// The arbiter signs the scoresheet and the result goes on the pairing sheet.
export const RecordResult = m.command({
  gameId: z.string(),
  round: z.number().int(),
  boardNumber: z.number().int(),
  whitePlayerId: z.string(),
  blackPlayerId: z.string(),
  result: Result,
  termination: Termination,
})
export const ResultRecorded = m.event({
  gameId: z.string(),
  round: z.number().int(),
  boardNumber: z.number().int(),
  whitePlayerId: z.string(),
  blackPlayerId: z.string(),
  result: Result,
  termination: Termination,
})

// The finished game as the crosstable shows it.
export const GameRecord = m.readModel({
  gameId: m.key(z.string()),
  round: z.number().int(),
  boardNumber: z.number().int(),
  whitePlayerId: z.string(),
  blackPlayerId: z.string(),
  result: Result,
  termination: Termination,
})

const MATE_FEN = "r1bqkb1r/pppp1Qpp/2n2n2/8/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4"

const timeForfeited = TimeForfeited.with({
  gameId: "otb-2024-ct-r5-b1",
  flaggedSide: "black",
  result: "white_won",
  termination: "time_forfeit",
})

const checkmate = BoardOutcomeAdjudicated.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 7,
  fen: MATE_FEN,
  result: "white_won",
  termination: "checkmate",
})

const illegalMoveForfeited = IllegalMoveForfeited.with({
  gameId: "otb-2024-ct-r5-b1",
  offendingSide: "white",
  illegalMoveCount: 2,
  result: "black_won",
  termination: "illegal_move_forfeit",
})

const resultRecorded = ResultRecorded.with({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  result: "draw",
  termination: "agreement",
})

export const Conclusion = m.chapter([
  m
    .slice()
    .actor(Player)
    .reads(ClockState)
    .service(ChessService)
    .command(ClaimFlagFall)
    .emits(TimeForfeited)
    .test("White claims Black's fallen flag", {
      given: ClockPressed.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 61000,
        blackTimeMs: 0,
        runningSide: "black",
      }),
      when: ClaimFlagFall.with({
        gameId: "otb-2024-ct-r5-b1",
        flaggedSide: "black",
        result: "white_won",
        termination: "time_forfeit",
      }),
      then: timeForfeited,
    })
    .test("A claim while time remains is rejected", {
      given: ClockPressed.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 61000,
        blackTimeMs: 240000,
        runningSide: "black",
      }),
      when: ClaimFlagFall.with({
        gameId: "otb-2024-ct-r5-b1",
        flaggedSide: "black",
        result: "white_won",
        termination: "time_forfeit",
      }),
      then: FlagStanding,
    }),

  m
    .slice("OutcomeAdjudicator")
    .on(MovePlayed)
    .reads(GameState)
    .command(AdjudicateOutcome)
    .emits(BoardOutcomeAdjudicated)
    .note("Every move is looked at. Only a terminal position produces an outcome.")
    .test("Checkmate on the board ends the game", {
      given: e4,
      when: AdjudicateOutcome.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 7,
        fen: MATE_FEN,
        result: "white_won",
        termination: "checkmate",
      }),
      then: checkmate,
    })
    .test("Stalemate on the board draws the game", {
      given: e4,
      when: AdjudicateOutcome.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 52",
        result: "draw",
        termination: "stalemate",
      }),
      then: BoardOutcomeAdjudicated.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 52",
        result: "draw",
        termination: "stalemate",
      }),
    })
    .test("A capture leaving king against king is a dead position", {
      given: e4,
      when: AdjudicateOutcome.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: "8/8/4k3/8/8/4K3/8/8 w - - 0 45",
        result: "draw",
        termination: "dead_position",
      }),
      then: BoardOutcomeAdjudicated.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: "8/8/4k3/8/8/4K3/8/8 w - - 0 45",
        result: "draw",
        termination: "dead_position",
      }),
    })
    .test("An ordinary move adjudicates nothing", {
      given: gameStarted,
      when: AdjudicateOutcome.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
        result: "draw",
        termination: "dead_position",
      }),
      then: PositionIsLive,
    }),

  m
    .slice("IllegalMoveForfeiter")
    .on(IllegalMoveRuled)
    .reads(IllegalMoveTally)
    .command(ForfeitGame)
    .emits(IllegalMoveForfeited)
    .test("A tally of two illegal moves forfeits the game", {
      given: [illegalMoveRuled, secondIllegalMoveRuled],
      when: ForfeitGame.with({
        gameId: "otb-2024-ct-r5-b1",
        offendingSide: "white",
        illegalMoveCount: 2,
        result: "black_won",
        termination: "illegal_move_forfeit",
      }),
      then: illegalMoveForfeited,
    })
    .test("A first illegal move does not forfeit", {
      given: illegalMoveRuled,
      when: ForfeitGame.with({
        gameId: "otb-2024-ct-r5-b1",
        offendingSide: "white",
        illegalMoveCount: 1,
        result: "black_won",
        termination: "illegal_move_forfeit",
      }),
      then: NotYetTwoIllegalMoves,
    }),

  m
    .slice()
    .projects(GameResult)
    .on(GameResigned)
    .on(DrawAgreed)
    .on(BoardOutcomeAdjudicated)
    .on(TimeForfeited)
    .on(IllegalMoveForfeited)
    .note("Five ways a game ends. Each one carries the result and how it came about.")
    .test("Settled after a resignation", {
      given: gameResigned,
      then: GameResult.with({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "resignation",
      }),
    })
    .test("Settled after a draw agreement", {
      given: drawAgreed,
      then: GameResult.with({
        gameId: "otb-2024-ct-r5-b1",
        result: "draw",
        termination: "agreement",
      }),
    })
    .test("Settled after checkmate on the board", {
      given: checkmate,
      then: GameResult.with({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "checkmate",
      }),
    })
    .test("Settled after a time forfeit", {
      given: timeForfeited,
      then: GameResult.with({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "time_forfeit",
      }),
    })
    .test("Settled after a second illegal move", {
      given: illegalMoveForfeited,
      then: GameResult.with({
        gameId: "otb-2024-ct-r5-b1",
        result: "black_won",
        termination: "illegal_move_forfeit",
      }),
    }),

  m
    .slice()
    .actor(Arbiter)
    .reads(GameResult)
    .reads(GamePairing)
    .service(ChessService)
    .command(RecordResult)
    .emits(ResultRecorded)
    .test("The arbiter records the signed draw on the pairing sheet", {
      given: [gameStarted, drawAgreed],
      when: RecordResult.with({
        gameId: "otb-2024-ct-r5-b1",
        round: 5,
        boardNumber: 1,
        whitePlayerId: "gm-carlsen",
        blackPlayerId: "gm-nepo",
        result: "draw",
        termination: "agreement",
      }),
      then: resultRecorded,
    }),

  m
    .slice()
    .projects(GameRecord)
    .on(ResultRecorded)
    .test("The recorded game enters the crosstable", {
      given: resultRecorded,
      then: GameRecord.with({
        gameId: "otb-2024-ct-r5-b1",
        round: 5,
        boardNumber: 1,
        whitePlayerId: "gm-carlsen",
        blackPlayerId: "gm-nepo",
        result: "draw",
        termination: "agreement",
      }),
    }),
])

export const Game = m.stream({
  ClaimFlagFall,
  TimeForfeited,
  AdjudicateOutcome,
  BoardOutcomeAdjudicated,
  ForfeitGame,
  IllegalMoveForfeited,
  RecordResult,
  ResultRecorded,
})
