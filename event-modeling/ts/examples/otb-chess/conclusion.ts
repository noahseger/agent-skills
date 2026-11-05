// The game ends by checkmate, resignation, agreement, or flag fall, and the result is recorded.

import { m, z } from "#em"
import { DrawAgreed, drawAgreed, GameResigned, gameResigned, Result, Termination } from "./draws.ts"
import { ClockPressed, ClockState, GameEnded, GameState, MATE_FEN, mated } from "./play.ts"
import { IllegalMoveTally, SecondIllegalMoveRuled, secondOffence } from "./rulings.ts"
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

// The position itself ends the game: checkmate, stalemate, or a dead position.
export const AdjudicateOutcome = m.command({
  gameId: z.string(),
  ply: z.number().int(),
  fen: z.string(),
  termination: Termination,
})
export const BoardOutcomeAdjudicated = m.event({
  gameId: z.string(),
  ply: z.number().int(),
  fen: z.string(),
  result: Result,
  termination: Termination,
})

// FIDE 7.5.5: the second illegal move by the same player loses the game.
export const ForfeitGame = m.command({
  gameId: z.string(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
})
export const IllegalMoveForfeited = m.event({
  gameId: z.string(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
  result: Result,
  termination: Termination,
})

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

const STALEMATE_FEN = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 52"
const BARE_KINGS_FEN = "8/8/4k3/8/8/4K3/8/8 w - - 0 45"

const timeForfeited = TimeForfeited({
  gameId: "otb-2024-ct-r5-b1",
  flaggedSide: "black",
  result: "white_won",
  termination: "time_forfeit",
})

const checkmate = BoardOutcomeAdjudicated({
  gameId: "otb-2024-ct-r5-b1",
  ply: 7,
  fen: MATE_FEN,
  result: "white_won",
  termination: "checkmate",
})

const illegalMoveForfeited = IllegalMoveForfeited({
  gameId: "otb-2024-ct-r5-b1",
  offendingSide: "white",
  illegalMoveCount: 2,
  result: "black_won",
  termination: "illegal_move_forfeit",
})

const resultRecorded = ResultRecorded({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  result: "draw",
  termination: "agreement",
})

export const Conclusion = [
  m
    .slice()
    .command(ClaimFlagFall)
    .readModel(ClockState)
    .event(TimeForfeited)
    .actor(Player)
    .service(ChessService)
    .test("White claims Black's fallen flag", {
      given: ClockPressed({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 61000,
        blackTimeMs: 0,
        runningSide: "black",
      }),
      when: ClaimFlagFall({
        gameId: "otb-2024-ct-r5-b1",
        flaggedSide: "black",
        result: "white_won",
        termination: "time_forfeit",
      }),
      then: timeForfeited,
    })
    .test("A claim while time remains is rejected", {
      given: ClockPressed({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 61000,
        blackTimeMs: 240000,
        runningSide: "black",
      }),
      when: ClaimFlagFall({
        gameId: "otb-2024-ct-r5-b1",
        flaggedSide: "black",
        result: "white_won",
        termination: "time_forfeit",
      }),
      reject: "that side still has time on the clock",
    }),

  m
    .slice("OutcomeAdjudicator")
    .trigger(GameEnded)
    .command(AdjudicateOutcome((e) => ({ termination: e.ending })))
    .readModel(GameState)
    .event(BoardOutcomeAdjudicated((_, { generate }) => ({ result: generate() })))
    .note("The move that ended the game says how. This turns that into a result.")
    .test("Checkmate on the board ends the game", {
      given: mated,
      when: AdjudicateOutcome({
        gameId: "otb-2024-ct-r5-b1",
        ply: 7,
        fen: MATE_FEN,
        termination: "checkmate",
      }),
      then: checkmate,
    })
    .test("Stalemate on the board draws the game", {
      given: GameEnded({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: STALEMATE_FEN,
        ending: "stalemate",
      }),
      when: AdjudicateOutcome({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: STALEMATE_FEN,
        termination: "stalemate",
      }),
      then: BoardOutcomeAdjudicated({
        gameId: "otb-2024-ct-r5-b1",
        ply: 103,
        fen: STALEMATE_FEN,
        result: "draw",
        termination: "stalemate",
      }),
    })
    .test("A capture leaving king against king is a dead position", {
      given: GameEnded({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: BARE_KINGS_FEN,
        ending: "dead_position",
      }),
      when: AdjudicateOutcome({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: BARE_KINGS_FEN,
        termination: "dead_position",
      }),
      then: BoardOutcomeAdjudicated({
        gameId: "otb-2024-ct-r5-b1",
        ply: 88,
        fen: BARE_KINGS_FEN,
        result: "draw",
        termination: "dead_position",
      }),
    }),

  m
    .slice("IllegalMoveForfeiter")
    .trigger(SecondIllegalMoveRuled)
    .command(ForfeitGame)
    .readModel(IllegalMoveTally)
    .event(
      IllegalMoveForfeited((_, { generate }) => ({
        result: generate(),
        termination: "illegal_move_forfeit",
      })),
    )
    .test("The second illegal move forfeits the game", {
      given: secondOffence,
      when: ForfeitGame({
        gameId: "otb-2024-ct-r5-b1",
        offendingSide: "white",
        illegalMoveCount: 2,
      }),
      then: illegalMoveForfeited,
    }),

  m
    .slice()
    .projection(GameResult)
    .event(GameResigned)
    .event(DrawAgreed)
    .event(BoardOutcomeAdjudicated)
    .event(TimeForfeited)
    .event(IllegalMoveForfeited)
    .note("Five ways a game ends. Each one carries the result and how it came about.")
    .test("Settled after a resignation", {
      given: gameResigned,
      then: GameResult({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "resignation",
      }),
    })
    .test("Settled after a draw agreement", {
      given: drawAgreed,
      then: GameResult({
        gameId: "otb-2024-ct-r5-b1",
        result: "draw",
        termination: "agreement",
      }),
    })
    .test("Settled after checkmate on the board", {
      given: checkmate,
      then: GameResult({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "checkmate",
      }),
    })
    .test("Settled after a time forfeit", {
      given: timeForfeited,
      then: GameResult({
        gameId: "otb-2024-ct-r5-b1",
        result: "white_won",
        termination: "time_forfeit",
      }),
    })
    .test("Settled after a second illegal move", {
      given: illegalMoveForfeited,
      then: GameResult({
        gameId: "otb-2024-ct-r5-b1",
        result: "black_won",
        termination: "illegal_move_forfeit",
      }),
    }),

  m
    .slice()
    .command(RecordResult)
    .readModel(GameResult)
    .readModel(GamePairing)
    .event(ResultRecorded)
    .actor(Arbiter)
    .service(ChessService)
    .test("The arbiter records the signed draw on the pairing sheet", {
      given: [gameStarted, drawAgreed],
      when: RecordResult({
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
    .projection(GameRecord)
    .event(ResultRecorded)
    .test("The recorded game enters the crosstable", {
      given: resultRecorded,
      then: GameRecord({
        gameId: "otb-2024-ct-r5-b1",
        round: 5,
        boardNumber: 1,
        whitePlayerId: "gm-carlsen",
        blackPlayerId: "gm-nepo",
        result: "draw",
        termination: "agreement",
      }),
    }),
]

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
