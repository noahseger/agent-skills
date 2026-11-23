// Players move on the board and press the clock. The board and the clock are separate lanes.

import { d, m, t } from "#em"

import { gameStarted } from "./setup.ts"

// A player moves. FIDE 1.1: the two players move alternately.
m.command("PlayMove", {
  gameId: t.string(),
  ply: t.int(),
  san: t.string(),
  fromSquare: t.string(),
  toSquare: t.string(),
  piece: t.enum(["pawn", "knight", "bishop", "rook", "queen", "king"]),
  fen: t.string(),
  sideToMove: t.enum(["white", "black"]),
  isCheck: t.boolean(),
  isCapture: t.boolean(),
  ending: t.enum(["checkmate", "stalemate", "dead_position"]).optional(),
})
m.event("MovePlayed", {
  gameId: t.string(),
  ply: t.int(),
  san: t.string(),
  fromSquare: t.string(),
  toSquare: t.string(),
  piece: t.enum(["pawn", "knight", "bishop", "rook", "queen", "king"]),
  fen: t.string(),
  sideToMove: t.enum(["white", "black"]),
  isCheck: t.boolean(),
  isCapture: t.boolean(),
}).stream(d.Game)

// A move that mates, stalemates, or leaves a dead position ends the game as it is played.
// FIDE 5.1.1, 5.2.1 and 5.2.2: the game is over at that moment, before anyone rules on it.
m.event("GameEnded", {
  gameId: t.string(),
  ply: t.int(),
  fen: t.string(),
  ending: t.enum(["checkmate", "stalemate", "dead_position"]),
}).stream(d.Game)

// The position on the board right now.
m.view("GameState", {
  gameId: t.string().key(),
  ply: t.int(),
  sideToMove: t.enum(["white", "black"]),
  fen: t.string(),
})

// A player presses the clock. FIDE 6.2.1: the increment is added on the press.
m.command("PressClock", {
  gameId: t.string(),
  whiteTimeMs: t.int(),
  blackTimeMs: t.int(),
  runningSide: t.enum(["white", "black"]),
})
m.event("ClockPressed", {
  gameId: t.string(),
  whiteTimeMs: t.int(),
  blackTimeMs: t.int(),
  runningSide: t.enum(["white", "black"]),
}).stream(d.Clock)

// Whose clock runs, and how much time each side has left.
m.view("ClockState", {
  gameId: t.string().key(),
  whiteTimeMs: t.int(),
  blackTimeMs: t.int(),
  runningSide: t.enum(["white", "black"]),
})

// The arbiter's ruling is declared here, in the chapter where the board first reads it.
m.command("RuleIllegalMove", {
  gameId: t.string(),
  ply: t.int(),
  offendingSide: t.enum(["white", "black"]),
  illegalMoveCount: t.int(),
  addedTimeMs: t.int(),
  penalty: t.enum(["opponent_time_added", "loss"]),
  fen: t.string(),
  sideToMove: t.enum(["white", "black"]),
})
m.event("IllegalMoveRuled", {
  gameId: t.string(),
  ply: t.int(),
  offendingSide: t.enum(["white", "black"]),
  illegalMoveCount: t.int(),
  addedTimeMs: t.int(),
  penalty: t.enum(["opponent_time_added", "loss"]),
  fen: t.string(),
  sideToMove: t.enum(["white", "black"]),
}).stream(d.Game)

// The scoresheet: one row per ply. A struck move stays on the sheet, marked.
m.view("MoveList", {
  gameId: t.string().key(),
  ply: t.int().key(),
  san: t.string(),
  sideToMove: t.enum(["white", "black"]),
  isCheck: t.boolean(),
  isCapture: t.boolean(),
  status: t.enum(["recorded", "struck"]),
})

const OPENING_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
export const MATE_FEN = "r1bqkb1r/pppp1Qpp/2n2n2/8/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4"
const FORK_FEN = "r1bqk2r/pppp1Qpp/2n2n2/2b1p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 7"
export const STRUCK_FEN = "r4rk1/pp3ppp/2p5/8/8/2P2N2/PP3PPP/R4RK1 w - - 4 17"

const kf1 = d.MovePlayed({
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

export const illegalMoveRuled = d.IllegalMoveRuled({
  gameId: "otb-2024-ct-r5-b1",
  ply: 32,
  offendingSide: "white",
  illegalMoveCount: 1,
  addedTimeMs: 120000,
  penalty: "opponent_time_added",
  fen: STRUCK_FEN,
  sideToMove: "white",
})

export const mated = d.GameEnded({
  gameId: "otb-2024-ct-r5-b1",
  ply: 7,
  fen: MATE_FEN,
  ending: "checkmate",
})

export const e4 = d.MovePlayed({
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

const clockStarted = d.ClockStarted({
  gameId: "otb-2024-ct-r5-b1",
  baseMinutes: 90,
  incrementSeconds: 30,
  whiteTimeMs: 5400000,
  blackTimeMs: 5400000,
  runningSide: "white",
})

m.chapter("Play", 2)

// What a spectator follows: the board and the scoresheet, side by side.
m.screen("Broadcast")

m.slice()
  .command(d.PlayMove)
  .query(d.GameState, "gameId")
  .event(d.MovePlayed, (c) => c.PlayMove)
  .event(d.GameEnded, (c) => ({
    ply: c.PlayMove.ply,
    fen: c.PlayMove.fen,
    ending: m.generate(c.PlayMove.ending),
  }))
  .chapter(d.Play)
  .actor(d.Player)
  .service(d.ChessService)
  .test("White opens with 1. e4", {
    given: gameStarted,
    when: d.PlayMove({
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
    when: d.PlayMove({
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
    then: d.MovePlayed({
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
  .test("Qxf7 mates, so the move ends the game", {
    given: gameStarted,
    when: d.PlayMove({
      gameId: "otb-2024-ct-r5-b1",
      ply: 7,
      san: "Qxf7#",
      fromSquare: "h5",
      toSquare: "f7",
      piece: "queen",
      fen: MATE_FEN,
      sideToMove: "black",
      isCheck: true,
      isCapture: true,
      ending: "checkmate",
    }),
    then: [
      d.MovePlayed({
        gameId: "otb-2024-ct-r5-b1",
        ply: 7,
        san: "Qxf7#",
        fromSquare: "h5",
        toSquare: "f7",
        piece: "queen",
        fen: MATE_FEN,
        sideToMove: "black",
        isCheck: true,
        isCapture: true,
      }),
      mated,
    ],
  })
  .test("Black cannot move while it is White's turn", {
    given: gameStarted,
    when: d.PlayMove({
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
    reject: "the other side is to move",
  })

m.slice()
  .view(d.GameState)
  .event(d.GameStarted)
  .event(d.MovePlayed)
  .event(d.IllegalMoveRuled)
  .context({ gameId: t.string() })
  .chapter(d.Play)
  .actor(d.Spectator)
  .screen(d.Broadcast)
  .service(d.ChessService, "WatchBoard")
  .note("The live position, as the broadcast shows it.")
  .test("The board advances after the opening move", {
    given: [gameStarted, e4],
    when: { gameId: "otb-2024-ct-r5-b1" },
    then: d.GameState({
      gameId: "otb-2024-ct-r5-b1",
      ply: 1,
      sideToMove: "black",
      fen: OPENING_FEN,
    }),
  })
  .test("The board reverts when an illegal move is struck", {
    given: [gameStarted, e4, illegalMoveRuled],
    when: { gameId: "otb-2024-ct-r5-b1" },
    then: d.GameState({
      gameId: "otb-2024-ct-r5-b1",
      ply: 32,
      sideToMove: "white",
      fen: STRUCK_FEN,
    }),
  })

m.slice()
  .command(d.PressClock)
  .query(d.ClockState, "gameId")
  .event(d.ClockPressed, (c) => c.PressClock)
  .chapter(d.Play)
  .actor(d.Player)
  .service(d.ChessService)
  .note("FIDE 6.2.1: pressing banks the increment and starts the opponent's clock.")
  .test("White presses the clock, the increment is banked, Black's clock runs", {
    given: clockStarted,
    when: d.PressClock({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 5412000,
      blackTimeMs: 5400000,
      runningSide: "black",
    }),
    then: d.ClockPressed({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 5412000,
      blackTimeMs: 5400000,
      runningSide: "black",
    }),
  })
  .test("Black cannot press the clock while White's clock runs", {
    given: clockStarted,
    when: d.PressClock({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 5400000,
      blackTimeMs: 5412000,
      runningSide: "white",
    }),
    reject: "only the side that has just moved may press the clock",
  })

m.slice()
  .view(d.ClockState)
  .event(d.ClockStarted)
  .event(d.ClockPressed)
  .chapter(d.Play)
  .test("The clock starts with White's time running", {
    given: clockStarted,
    then: d.ClockState({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 5400000,
      blackTimeMs: 5400000,
      runningSide: "white",
    }),
  })
  .test("The running side follows the press", {
    given: [
      clockStarted,
      d.ClockPressed({
        gameId: "otb-2024-ct-r5-b1",
        whiteTimeMs: 5412000,
        blackTimeMs: 5400000,
        runningSide: "black",
      }),
    ],
    then: d.ClockState({
      gameId: "otb-2024-ct-r5-b1",
      whiteTimeMs: 5412000,
      blackTimeMs: 5400000,
      runningSide: "black",
    }),
  })

m.slice()
  .view(d.MoveList)
  .event(d.MovePlayed, () => ({ status: t.literal("recorded") }))
  .event(d.IllegalMoveRuled, () => ({ status: t.literal("struck") }))
  .context({ gameId: t.string() })
  .chapter(d.Play)
  .actor(d.Spectator)
  .screen(d.Broadcast)
  .service(d.ChessService, "WatchMoves")
  .note("The moves so far, as the broadcast shows them.")
  .test("A move is recorded on the scoresheet", {
    given: e4,
    when: { gameId: "otb-2024-ct-r5-b1" },
    then: d.MoveList({
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
    when: { gameId: "otb-2024-ct-r5-b1" },
    then: d.MoveList({
      gameId: "otb-2024-ct-r5-b1",
      ply: 32,
      san: "Kf1",
      sideToMove: "white",
      isCheck: false,
      isCapture: false,
      status: "struck",
    }),
  })
