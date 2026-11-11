// A tournament pairing arrives from outside and starts a game on a board and a clock.

import { m, z } from "#em"

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
    gameId: z.string(),
    round: z.number().int(),
    boardNumber: z.number().int(),
    whitePlayerId: z.string(),
    blackPlayerId: z.string(),
    timeControl: z.string(),
    baseMinutes: z.number().int(),
    incrementSeconds: z.number().int(),
  })
  .external(PairingSystem)

// The pairing becomes a game at the starting position, White to move.
export const StartGame = m.command({
  gameId: z.string(),
  round: z.number().int(),
  boardNumber: z.number().int(),
  whitePlayerId: z.string(),
  blackPlayerId: z.string(),
  timeControl: z.string(),
  baseMinutes: z.number().int(),
  incrementSeconds: z.number().int(),
})
export const GameStarted = m
  .event({
    gameId: z.string(),
    round: z.number().int(),
    boardNumber: z.number().int(),
    whitePlayerId: z.string(),
    blackPlayerId: z.string(),
    timeControl: z.string(),
    baseMinutes: z.number().int(),
    incrementSeconds: z.number().int(),
    fen: z.string(),
    sideToMove: z.enum(["white", "black"]),
    ply: z.number().int(),
  })
  .stream(Game)

// Who is playing whom, on which board, in which round.
export const GamePairing = m
  .readModel({
    gameId: z.string(),
    round: z.number().int(),
    boardNumber: z.number().int(),
    whitePlayerId: z.string(),
    blackPlayerId: z.string(),
  })
  .key("gameId")

// The arbiter starts White's clock. FIDE 6.7.1: the clock runs from the start signal.
export const StartClock = m.command({
  gameId: z.string(),
  baseMinutes: z.number().int(),
  incrementSeconds: z.number().int(),
})
export const ClockStarted = m
  .event({
    gameId: z.string(),
    baseMinutes: z.number().int(),
    incrementSeconds: z.number().int(),
    whiteTimeMs: z.number().int(),
    blackTimeMs: z.number().int(),
    runningSide: z.enum(["white", "black"]),
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

export const GameSetup = m.chapter()

m.slice("ReceivePairing")
  .translation(
    PairingPublished,
    StartGame,
    GameStarted(() => ({ fen: START_FEN, sideToMove: "white", ply: 0 })),
  )
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
  .view(GamePairing, GameStarted)
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
  .automation(
    GameStarted,
    StartClock,
    ClockStarted((c) => ({
      whiteTimeMs: m.generate(c.baseMinutes),
      blackTimeMs: m.generate(c.baseMinutes),
      runningSide: "white",
    })),
  )
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
