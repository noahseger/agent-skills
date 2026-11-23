// A player may offer a draw, accept one, or resign. None of these touches the clock.

import { d, m, t } from "#em"
import { e4 } from "./play.ts"

// The result of a game, and how it came about, as they go on the scoresheet.
export const Result = t.enum(["white_won", "black_won", "draw"])
export const Termination = t.enum([
  "checkmate",
  "stalemate",
  "dead_position",
  "resignation",
  "agreement",
  "time_forfeit",
  "illegal_move_forfeit",
])

// FIDE 9.1.2.1: a player offers a draw after making a move, before pressing the clock.
m.command("OfferDraw", {
  gameId: t.string(),
  offeringSide: t.enum(["white", "black"]),
  ply: t.int(),
})
m.event("DrawOffered", {
  gameId: t.string(),
  offeringSide: t.enum(["white", "black"]),
  ply: t.int(),
}).stream(d.Game)

// The offer standing on the opponent. One offer at a time, and only the latest counts.
m.view("PendingDrawOffer", {
  gameId: t.string().key(),
  offeringSide: t.enum(["white", "black"]),
  ply: t.int(),
  status: t.enum(["pending", "declined", "accepted"]),
})

// FIDE 9.1.2.3: the offer stands until the opponent accepts it, moves, or claims a draw.
m.command("AcceptDraw", {
  gameId: t.string(),
  offeringSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
m.event("DrawAgreed", {
  gameId: t.string(),
  offeringSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
}).stream(d.Game)

// FIDE 5.1.2: a player may resign at any time.
m.command("Resign", {
  gameId: t.string(),
  resigningSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
})
m.event("GameResigned", {
  gameId: t.string(),
  resigningSide: t.enum(["white", "black"]),
  result: Result,
  termination: Termination,
}).stream(d.Game)

const MIDDLEGAME_FEN = "r4rk1/pp3ppp/2p5/8/8/2P5/PP3PPP/R4RK1 b - - 0 21"
const ENDGAME_FEN = "8/8/8/4k3/8/4K3/4P3/8 b - - 0 39"

// A state change is specified from events, so the position comes as the move that reached it.
const rd1 = d.MovePlayed({
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

const kf6 = d.MovePlayed({
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

export const drawOffered = d.DrawOffered({
  gameId: "otb-2024-ct-r5-b1",
  offeringSide: "white",
  ply: 41,
})

export const drawAgreed = d.DrawAgreed({
  gameId: "otb-2024-ct-r5-b1",
  offeringSide: "white",
  result: "draw",
  termination: "agreement",
})

export const gameResigned = d.GameResigned({
  gameId: "otb-2024-ct-r5-b1",
  resigningSide: "black",
  result: "white_won",
  termination: "resignation",
})

m.chapter("DrawsAndResignation", 3)

m.slice()
  .command(d.OfferDraw)
  .query(d.GameState, "gameId")
  .event(d.DrawOffered, (c) => c.OfferDraw)
  .chapter(d.DrawsAndResignation)
  .actor(d.Player)
  .service(d.ChessService)
  .spec("White offers a draw on move 21", {
    given: rd1,
    when: d.OfferDraw({ gameId: "otb-2024-ct-r5-b1", offeringSide: "white", ply: 41 }),
    then: drawOffered,
  })

m.slice()
  .view(d.PendingDrawOffer)
  .event(d.DrawOffered, () => ({ status: t.literal("pending") }))
  .event(d.MovePlayed, () => ({ status: t.literal("declined") }))
  .event(d.DrawAgreed, () => ({ status: t.literal("accepted") }))
  .chapter(d.DrawsAndResignation)
  .note("A move by the opponent declines the offer. FIDE 9.1.2.3.")
  .spec("The offer is pending on the opponent", {
    given: drawOffered,
    then: d.PendingDrawOffer({
      gameId: "otb-2024-ct-r5-b1",
      offeringSide: "white",
      ply: 41,
      status: "pending",
    }),
  })
  .spec("The offer is declined when the opponent replies with a move", {
    given: [drawOffered, e4],
    then: d.PendingDrawOffer({
      gameId: "otb-2024-ct-r5-b1",
      offeringSide: "white",
      ply: 1,
      status: "declined",
    }),
  })
  .spec("The offer is closed once the draw is agreed", {
    given: [drawOffered, drawAgreed],
    then: d.PendingDrawOffer({
      gameId: "otb-2024-ct-r5-b1",
      offeringSide: "white",
      ply: 41,
      status: "accepted",
    }),
  })

m.slice()
  .command(d.AcceptDraw)
  .query(d.PendingDrawOffer, "gameId")
  .event(d.DrawAgreed, (c) => c.AcceptDraw)
  .chapter(d.DrawsAndResignation)
  .actor(d.Player)
  .service(d.ChessService)
  .spec("Black accepts the pending draw offer", {
    given: drawOffered,
    when: d.AcceptDraw({
      gameId: "otb-2024-ct-r5-b1",
      offeringSide: "white",
      result: "draw",
      termination: "agreement",
    }),
    then: drawAgreed,
  })
  .spec("Accepting with no offer pending is rejected", {
    given: e4,
    when: d.AcceptDraw({
      gameId: "otb-2024-ct-r5-b1",
      offeringSide: "white",
      result: "draw",
      termination: "agreement",
    }),
    reject: "no draw offer is pending",
  })

m.slice()
  .command(d.Resign)
  .query(d.GameState, "gameId")
  .event(d.GameResigned)
  .chapter(d.DrawsAndResignation)
  .actor(d.Player)
  .service(d.ChessService)
  .spec("Black resigns a lost endgame", {
    given: kf6,
    when: d.Resign({
      gameId: "otb-2024-ct-r5-b1",
      resigningSide: "black",
      result: "white_won",
      termination: "resignation",
    }),
    then: gameResigned,
  })
