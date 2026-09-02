// Players move on the board and press the clock. The board and the clock are separate lanes.

import { z } from "zod"
import { m } from "#em"

import { ChessService, ClockStarted, GameStarted, gameStarted, Player } from "./setup.ts"

// A player moves. FIDE 1.1: the two players move alternately.
export const PlayMove = m.command({
  gameId: z.string(),
  ply: z.number().int(),
  san: z.string(),
  fromSquare: z.string(),
  toSquare: z.string(),
  piece: z.enum(["pawn", "knight", "bishop", "rook", "queen", "king"]),
  fen: z.string(),
  sideToMove: z.enum(["white", "black"]),
  isCheck: z.boolean(),
  isCapture: z.boolean(),
})
export const MovePlayed = m.event({
  gameId: z.string(),
  ply: z.number().int(),
  san: z.string(),
  fromSquare: z.string(),
  toSquare: z.string(),
  piece: z.enum(["pawn", "knight", "bishop", "rook", "queen", "king"]),
  fen: z.string(),
  sideToMove: z.enum(["white", "black"]),
  isCheck: z.boolean(),
  isCapture: z.boolean(),
})
export const NotYourMove = m.rejected("the other side is to move")

// The position on the board right now.
export const GameState = m.readModel({
  gameId: m.key(z.string()),
  ply: z.number().int(),
  sideToMove: z.enum(["white", "black"]),
  fen: z.string(),
})

// A player presses the clock. FIDE 6.2.1: the increment is added on the press.
export const PressClock = m.command({
  gameId: z.string(),
  whiteTimeMs: z.number().int(),
  blackTimeMs: z.number().int(),
  runningSide: z.enum(["white", "black"]),
})
export const ClockPressed = m.event({
  gameId: z.string(),
  whiteTimeMs: z.number().int(),
  blackTimeMs: z.number().int(),
  runningSide: z.enum(["white", "black"]),
})
export const NotYourClock = m.rejected("only the side that has just moved may press the clock")

// Whose clock runs, and how much time each side has left.
export const ClockState = m.readModel({
  gameId: m.key(z.string()),
  whiteTimeMs: z.number().int(),
  blackTimeMs: z.number().int(),
  runningSide: z.enum(["white", "black"]),
})

// The arbiter's ruling is declared here, in the chapter where the board first reads it.
// A projection names every event that writes it in one chain, so the ruling cannot wait for
// the Arbiter Rulings chapter that emits it.
export const RuleIllegalMove = m.command({
  gameId: z.string(),
  ply: z.number().int(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
  addedTimeMs: z.number().int(),
  penalty: z.enum(["opponent_time_added", "loss"]),
  fen: z.string(),
  sideToMove: z.enum(["white", "black"]),
})
export const IllegalMoveRuled = m.event({
  gameId: z.string(),
  ply: z.number().int(),
  offendingSide: z.enum(["white", "black"]),
  illegalMoveCount: z.number().int(),
  addedTimeMs: z.number().int(),
  penalty: z.enum(["opponent_time_added", "loss"]),
  fen: z.string(),
  sideToMove: z.enum(["white", "black"]),
})

// The scoresheet: one row per ply. A struck move stays on the sheet, marked.
export const MoveList = m.readModel({
  gameId: m.key(z.string()),
  ply: m.key(z.number().int()),
  san: z.string(),
  sideToMove: z.enum(["white", "black"]),
  isCheck: z.boolean(),
  isCapture: z.boolean(),
  status: z.enum(["recorded", "struck"]),
})

const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
const FORK_FEN = "r1bqk2r/pppp1Qpp/2n2n2/2b1p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 7"
export const STRUCK_FEN = "r4rk1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R4RK1 w - - 4 17"

const kf1 = MovePlayed.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 32,
  san: "Kf1",
  fromSquare: "g1",
  toSquare: "f1",
  piece: "king",
  fen: STRUCK_FEN,
  sideToMove: "white",
  isCheck: false,
  isCapture: false,
})

export const illegalMoveRuled = IllegalMoveRuled.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 32,
  offendingSide: "white",
  illegalMoveCount: 1,
  addedTimeMs: 120000,
  penalty: "opponent_time_added",
  fen: STRUCK_FEN,
  sideToMove: "white",
})

export const e4 = MovePlayed.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 1,
  san: "e4",
  fromSquare: "e2",
  toSquare: "e4",
  piece: "pawn",
  fen: OPENING_FEN,
  sideToMove: "black",
  isCheck: false,
  isCapture: false,
})

const clockStarted = ClockStarted.with({
  gameId: "otb-2024-ct-r5-b1",
  baseMinutes: 90,
  incrementSeconds: 30,
  whiteTimeMs: 5400000,
  blackTimeMs: 5400000,
  runningSide: "white",
})

export const Play = m.chapter([
  m
    .slice()
    .actor(Player)
    .reads(GameState)
    .service(ChessService)
    .command(PlayMove)
    .emits(MovePlayed)
    .test("White opens with 1. e4", {
      given: gameStarted,
      when: PlayMove.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        san: "e4",
        fromSquare: "e2",
        toSquare: "e4",
        piece: "pawn",
        fen: OPENING_FEN,
        sideToMove: "black",
        isCheck: false,
        isCapture: false,
      }),
      then: e4,
    })
    .test("A capture that gives check sets both flags", {
      given: gameStarted,
      when: PlayMove.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 15,
        san: "Qxf7+",
        fromSquare: "f5",
        toSquare: "f7",
        piece: "queen",
        fen: FORK_FEN,
        sideToMove: "black",
        isCheck: true,
        isCapture: true,
      }),
      then: MovePlayed.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 15,
        san: "Qxf7+",
        fromSquare: "f5",
        toSquare: "f7",
        piece: "queen",
        fen: FORK_FEN,
        sideToMove: "black",
        isCheck: true,
        isCapture: true,
      }),
    })
    .test("Black cannot move while it is White's turn", {
      given: gameStarted,
      when: PlayMove.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        san: "e5",
        fromSquare: "e7",
        toSquare: "e5",
        piece: "pawn",
        fen: OPENING_FEN,
        sideToMove: "white",
        isCheck: false,
        isCapture: false,
      }),
      then: NotYourMove,
    }),

  m
    .slice()
    .projects(GameState)
    .on(GameStarted)
    .on(MovePlayed)
    .on(IllegalMoveRuled)
    .test("The board advances after the opening move", {
      given: [gameStarted, e4],
      then: GameState.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        sideToMove: "black",
        fen: OPENING_FEN,
      }),
    })
    .test("The board reverts when an illegal move is struck", {
      given: [gameStarted, e4, illegalMoveRuled],
      then: GameState.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 32,
        sideToMove: "white",
        fen: STRUCK_FEN,
      }),
    }),

  m
    .slice()
    .actor(Player)
    .reads(ClockState)
    .service(ChessService)
    .command(PressClock)
    .emits(ClockPressed)
    .note("FIDE 6.2.1: pressing banks the increment and starts the opponent's clock.")
    .test("White presses the clock, the increment is banked, Black's clock runs", {
      given: clockStarted,
      when: PressClock.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5412000,
        blackTimeMs: 5400000,
        runningSide: "black",
      }),
      then: ClockPressed.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5412000,
        blackTimeMs: 5400000,
        runningSide: "black",
      }),
    })
    .test("Black cannot press the clock while White's clock runs", {
      given: clockStarted,
      when: PressClock.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5400000,
        blackTimeMs: 5412000,
        runningSide: "white",
      }),
      then: NotYourClock,
    }),

  m
    .slice()
    .projects(ClockState)
    .on(ClockStarted)
    .on(ClockPressed)
    .test("The clock starts with White's time running", {
      given: clockStarted,
      then: ClockState.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5400000,
        blackTimeMs: 5400000,
        runningSide: "white",
      }),
    })
    .test("The running side follows the press", {
      given: [
        clockStarted,
        ClockPressed.with({
          gameId: "otb-2024-ct-r5-b1",
          whiteTimeMs: 5412000,
          blackTimeMs: 5400000,
          runningSide: "black",
        }),
      ],
      then: ClockState.with({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5412000,
        blackTimeMs: 5400000,
        runningSide: "black",
      }),
    }),

  m
    .slice()
    .projects(MoveList)
    .on(MovePlayed, () => ({ status: "recorded" }))
    .on(IllegalMoveRuled, () => ({ status: "struck" }))
    .test("A move is recorded on the scoresheet", {
      given: e4,
      then: MoveList.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 1,
        san: "e4",
        sideToMove: "black",
        isCheck: false,
        isCapture: false,
        status: "recorded",
      }),
    })
    .test("An illegal move at ply 32 is struck, and stays on the sheet marked", {
      given: [kf1, illegalMoveRuled],
      then: MoveList.with({
        gameId: "otb-2024-ct-r5-b1",
        ply: 32,
        san: "Kf1",
        sideToMove: "white",
        isCheck: false,
        isCapture: false,
        status: "struck",
      }),
    }),

  m
    .slice()
    .actor(Player)
    .query({ gameId: z.string() })
    .reads(MoveList)
    .service(ChessService, "GetMoveList")
    .note("FIDE 8.1.1: each player keeps the scoresheet as the game goes on."),
])

export const Game = m.stream({ PlayMove, MovePlayed, RuleIllegalMove, IllegalMoveRuled })
export const Clock = m.stream({ PressClock, ClockPressed })
