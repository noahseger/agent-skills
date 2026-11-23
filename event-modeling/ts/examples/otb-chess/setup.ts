// A tournament pairing arrives from outside and starts a game on a board and a clock.

import { d, m, t } from "#em"

// The two players at the board. Either may act; the side is a field, not an actor.
m.actor("Player")

// The official who rules on incidents and signs the scoresheet.
m.actor("Arbiter", { icon: "admin" })

// Anyone following the game who never touches the board.
m.actor("Spectator")

// The API the board, the clock and the scoresheet all go through.
m.service("ChessService", "otb.v1")

// Two lanes: what happens to the game, and what happens to the clock.
m.stream("Game")
m.stream("Clock")

// The tournament pairing system publishes the round. We do not own it.
m.external("PairingSystem")

m.event("PairingPublished", {
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  timeControl: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
}).external(d.PairingSystem)

// The pairing becomes a game at the starting position, White to move.
m.command("StartGame", {
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  timeControl: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
})
m.event("GameStarted", {
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  timeControl: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
  fen: t.string(),
  sideToMove: t.enum(["white", "black"]),
  ply: t.int(),
}).stream(d.Game)

// Who is playing whom, on which board, in which round.
m.view("GamePairing", {
  gameId: t.string().key(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
})

// The arbiter starts White's clock. FIDE 6.7.1: the clock runs from the start signal.
m.command("StartClock", {
  gameId: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
})
m.event("ClockStarted", {
  gameId: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
  whiteTimeMs: t.int(),
  blackTimeMs: t.int(),
  runningSide: t.enum(["white", "black"]),
}).stream(d.Clock)

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

const pairing = d.PairingPublished({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  timeControl: "classical",
  baseMinutes: 90,
  incrementSeconds: 30,
})

export const gameStarted = d.GameStarted({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  timeControl: "classical",
  baseMinutes: 90,
  incrementSeconds: 30,
  fen: START_FEN,
  sideToMove: "white",
  ply: 0,
})

m.chapter("GameSetup", 1)

m.slice("ReceivePairing")
  .translation(d.PairingPublished)
  .command(d.StartGame)
  .event(d.GameStarted, () => ({
    fen: t.literal(START_FEN),
    sideToMove: t.literal("white"),
    ply: t.literal(0),
  }))
  .chapter(d.GameSetup)
  .note("The pairing is translated, never stored. The starting position is ours to supply.")
  .spec("Round 5 board 1 pairing starts a classical game", {
    given: pairing,
    when: d.StartGame({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
      timeControl: "classical",
      baseMinutes: 90,
      incrementSeconds: 30,
    }),
    then: gameStarted,
  })

m.slice()
  .view(d.GamePairing)
  .event(d.GameStarted)
  .chapter(d.GameSetup)
  .spec("Pairing identity available after the game starts", {
    given: gameStarted,
    then: d.GamePairing({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
    }),
  })

m.slice("ClockStarter")
  .automation(d.GameStarted)
  .command(d.StartClock)
  .event(d.ClockStarted, (c) => ({
    whiteTimeMs: m.generate(c.StartClock.baseMinutes),
    blackTimeMs: m.generate(c.StartClock.baseMinutes),
    runningSide: t.literal("white"),
  }))
  .chapter(d.GameSetup)
  .spec("White's clock starts at 90 minutes", {
    given: gameStarted,
    when: d.StartClock({ gameId: "otb-2024-ct-r5-b1", baseMinutes: 90, incrementSeconds: 30 }),
    then: d.ClockStarted({
      gameId: "otb-2024-ct-r5-b1",
      baseMinutes: 90,
      incrementSeconds: 30,
      whiteTimeMs: 5400000,
      blackTimeMs: 5400000,
      runningSide: "white",
    }),
  })
