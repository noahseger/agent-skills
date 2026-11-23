// A tournament pairing arrives from outside and starts a game on a board and a clock.

import { m, t } from "#em"

// The two players at the board. Either may act; the side is a field, not an actor.
export const Player = m.actor()

// The official who rules on incidents and signs the scoresheet.
export const Arbiter = m.actor({ icon: "admin" })

// Anyone following the game who never touches the board.
export const Spectator = m.actor()

// The API the board, the clock and the scoresheet all go through.
export const ChessService = m.service("otb.v1")

// Two lanes: what happens to the game, and what happens to the clock.
export const Game = m.stream()
export const Clock = m.stream()

// The tournament pairing system publishes the round. We do not own it.
export const PairingSystem = m.external()

export const PairingPublished = m
  .event({
    gameId: t.string(),
    round: t.int(),
    boardNumber: t.int(),
    whitePlayerId: t.string(),
    blackPlayerId: t.string(),
    timeControl: t.string(),
    baseMinutes: t.int(),
    incrementSeconds: t.int(),
  })
  .external(PairingSystem)

// The pairing becomes a game at the starting position, White to move.
export const StartGame = m.command({
  gameId: t.string(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
  timeControl: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
})
export const GameStarted = m
  .event({
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
  })
  .stream(Game)

// Who is playing whom, on which board, in which round.
export const GamePairing = m.view({
  gameId: t.string().key(),
  round: t.int(),
  boardNumber: t.int(),
  whitePlayerId: t.string(),
  blackPlayerId: t.string(),
})

// The arbiter starts White's clock. FIDE 6.7.1: the clock runs from the start signal.
export const StartClock = m.command({
  gameId: t.string(),
  baseMinutes: t.int(),
  incrementSeconds: t.int(),
})
export const ClockStarted = m
  .event({
    gameId: t.string(),
    baseMinutes: t.int(),
    incrementSeconds: t.int(),
    whiteTimeMs: t.int(),
    blackTimeMs: t.int(),
    runningSide: t.enum(["white", "black"]),
  })
  .stream(Clock)

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

const pairing = PairingPublished({
  gameId: "otb-2024-ct-r5-b1",
  round: 5,
  boardNumber: 1,
  whitePlayerId: "gm-carlsen",
  blackPlayerId: "gm-nepo",
  timeControl: "classical",
  baseMinutes: 90,
  incrementSeconds: 30,
})

export const gameStarted = GameStarted({
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

export const GameSetup = m.chapter(1)

m.slice("ReceivePairing")
  .translation({ PairingPublished })
  .command({ StartGame })
  .event({ GameStarted }, () => ({
    fen: t.literal(START_FEN),
    sideToMove: t.literal("white"),
    ply: t.literal(0),
  }))
  .chapter(GameSetup)
  .note("The pairing is translated, never stored. The starting position is ours to supply.")
  .test("Round 5 board 1 pairing starts a classical game", {
    given: pairing,
    when: StartGame({
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
  .view({ GamePairing })
  .event({ GameStarted })
  .chapter(GameSetup)
  .test("Pairing identity available after the game starts", {
    given: gameStarted,
    then: GamePairing({
      gameId: "otb-2024-ct-r5-b1",
      round: 5,
      boardNumber: 1,
      whitePlayerId: "gm-carlsen",
      blackPlayerId: "gm-nepo",
    }),
  })

m.slice("ClockStarter")
  .automation({ GameStarted })
  .command({ StartClock })
  .event({ ClockStarted }, (c) => ({
    whiteTimeMs: m.generate(c.StartClock.baseMinutes),
    blackTimeMs: m.generate(c.StartClock.baseMinutes),
    runningSide: t.literal("white"),
  }))
  .chapter(GameSetup)
  .test("White's clock starts at 90 minutes", {
    given: gameStarted,
    when: StartClock({ gameId: "otb-2024-ct-r5-b1", baseMinutes: 90, incrementSeconds: 30 }),
    then: ClockStarted({
      gameId: "otb-2024-ct-r5-b1",
      baseMinutes: 90,
      incrementSeconds: 30,
      whiteTimeMs: 5400000,
      blackTimeMs: 5400000,
      runningSide: "white",
    }),
  })
