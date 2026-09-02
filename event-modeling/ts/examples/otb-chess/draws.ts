// A player may offer a draw, accept one, or resign. None of these touches the clock.

import { z } from "zod"
import { m } from "#em"
import { e4, GameState, MovePlayed } from "./play.ts"
import { ChessService, Player } from "./setup.ts"

// The result of a game, and how it came about, as they go on the scoresheet.
export const Result = z.enum(["white_won", "black_won", "draw"])
export const Termination = z.enum([
  "checkmate",
  "stalemate",
  "dead_position",
  "resignation",
  "agreement",
  "time_forfeit",
  "illegal_move_forfeit",
])

// FIDE 9.1.2.1: a player offers a draw after making a move, before pressing the clock.
export const OfferDraw = m.command({
  gameId: z.string(),
  offeringSide: z.enum(["white", "black"]),
  ply: z.number().int(),
})
export const DrawOffered = m.event({
  gameId: z.string(),
  offeringSide: z.enum(["white", "black"]),
  ply: z.number().int(),
})

// The offer standing on the opponent. One offer at a time, and only the latest counts.
export const PendingDrawOffer = m.readModel({
  gameId: m.key(z.string()),
  offeringSide: z.enum(["white", "black"]),
  ply: z.number().int(),
  status: z.enum(["pending", "declined", "accepted"]),
})

// FIDE 9.1.2.3: the offer stands until the opponent accepts it, moves, or claims a draw.
export const AcceptDraw = m.command({
  gameId: z.string(),
  offeringSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
export const DrawAgreed = m.event({
  gameId: z.string(),
  offeringSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
export const NoOfferPending = m.rejected("no draw offer is pending")

// FIDE 5.1.2: a player may resign at any time.
export const Resign = m.command({
  gameId: z.string(),
  resigningSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
export const GameResigned = m.event({
  gameId: z.string(),
  resigningSide: z.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})

const MIDDLEGAME_FEN = "r4rk1/pp3ppp/2p5/8/8/2P5/PP3PPP/R4RK1 b - - 0 21"
const ENDGAME_FEN = "8/8/8/4k3/8/4K3/4P3/8 b - - 0 39"

// A state change is specified from events, so the position comes as the move that reached it.
const rd1 = MovePlayed.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 41,
  san: "Rd1",
  fromSquare: "a1",
  toSquare: "d1",
  piece: "rook",
  fen: MIDDLEGAME_FEN,
  sideToMove: "black",
  isCheck: false,
  isCapture: false,
})

const kf6 = MovePlayed.with({
  gameId: "otb-2024-ct-r5-b1",
  ply: 76,
  san: "Ke3",
  fromSquare: "d3",
  toSquare: "e3",
  piece: "king",
  fen: ENDGAME_FEN,
  sideToMove: "black",
  isCheck: false,
  isCapture: false,
})

export const drawOffered = DrawOffered.with({
  gameId: "otb-2024-ct-r5-b1",
  offeringSide: "white",
  ply: 41,
})

export const drawAgreed = DrawAgreed.with({
  gameId: "otb-2024-ct-r5-b1",
  offeringSide: "white",
  result: "draw",
  termination: "agreement",
})

export const gameResigned = GameResigned.with({
  gameId: "otb-2024-ct-r5-b1",
  resigningSide: "black",
  result: "white_won",
  termination: "resignation",
})

export const DrawsAndResignation = m.chapter([
  m
    .slice()
    .actor(Player)
    .reads(GameState)
    .service(ChessService)
    .command(OfferDraw)
    .emits(DrawOffered)
    .test("White offers a draw on move 21", {
      given: rd1,
      when: OfferDraw.with({ gameId: "otb-2024-ct-r5-b1", offeringSide: "white", ply: 41 }),
      then: drawOffered,
    }),

  m
    .slice()
    .projects(PendingDrawOffer)
    .on(DrawOffered, () => ({ status: "pending" }))
    .on(MovePlayed, () => ({ status: "declined" }))
    .on(DrawAgreed, () => ({ status: "accepted" }))
    .note("A move by the opponent declines the offer. FIDE 9.1.2.3.")
    .test("The offer is pending on the opponent", {
      given: drawOffered,
      then: PendingDrawOffer.with({
        gameId: "otb-2024-ct-r5-b1",
        offeringSide: "white",
        ply: 41,
        status: "pending",
      }),
    })
    .test("The offer is declined when the opponent replies with a move", {
      given: [drawOffered, e4],
      then: PendingDrawOffer.with({
        gameId: "otb-2024-ct-r5-b1",
        offeringSide: "white",
        ply: 1,
        status: "declined",
      }),
    })
    .test("The offer is closed once the draw is agreed", {
      given: [drawOffered, drawAgreed],
      then: PendingDrawOffer.with({
        gameId: "otb-2024-ct-r5-b1",
        offeringSide: "white",
        ply: 41,
        status: "accepted",
      }),
    }),

  m
    .slice()
    .actor(Player)
    .reads(PendingDrawOffer)
    .service(ChessService)
    .command(AcceptDraw)
    .emits(DrawAgreed)
    .test("Black accepts the pending draw offer", {
      given: drawOffered,
      when: AcceptDraw.with({
        gameId: "otb-2024-ct-r5-b1",
        offeringSide: "white",
        result: "draw",
        termination: "agreement",
      }),
      then: drawAgreed,
    })
    .test("Accepting with no offer pending is rejected", {
      given: e4,
      when: AcceptDraw.with({
        gameId: "otb-2024-ct-r5-b1",
        offeringSide: "white",
        result: "draw",
        termination: "agreement",
      }),
      then: NoOfferPending,
    }),

  m
    .slice()
    .actor(Player)
    .reads(GameState)
    .service(ChessService)
    .command(Resign)
    .emits(GameResigned)
    .test("Black resigns a lost endgame", {
      given: kf6,
      when: Resign.with({
        gameId: "otb-2024-ct-r5-b1",
        resigningSide: "black",
        result: "white_won",
        termination: "resignation",
      }),
      then: gameResigned,
    }),
])

export const Game = m.stream({
  OfferDraw,
  DrawOffered,
  AcceptDraw,
  DrawAgreed,
  Resign,
  GameResigned,
})
