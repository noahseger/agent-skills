// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, External, ExternalEvent, Field, Screen, Service, Stream, View } from "#em"

declare module "#em" {
  interface Registry {
    AcceptDraw: Command<"AcceptDraw", { gameId: Field<string>; offeringSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    AdjudicateOutcome: Command<"AdjudicateOutcome", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Arbiter: Actor
    ArbiterRulings: Chapter
    BoardOutcomeAdjudicated: Event<"BoardOutcomeAdjudicated", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Broadcast: Screen
    ChessService: Service
    ClaimFlagFall: Command<"ClaimFlagFall", { gameId: Field<string>; flaggedSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Clock: Stream
    ClockPressed: Event<"ClockPressed", { gameId: Field<string>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    ClockStarted: Event<"ClockStarted", { gameId: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    ClockState: View<"ClockState", { gameId: Field<string, string, true>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }, false>
    Conclusion: Chapter
    DrawAgreed: Event<"DrawAgreed", { gameId: Field<string>; offeringSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    DrawOffered: Event<"DrawOffered", { gameId: Field<string>; offeringSide: Field<"white" | "black">; ply: Field<number> }>
    DrawsAndResignation: Chapter
    ForfeitGame: Command<"ForfeitGame", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number> }>
    Game: Stream
    GameEnded: Event<"GameEnded", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; ending: Field<"checkmate" | "stalemate" | "dead_position"> }>
    GamePairing: View<"GamePairing", { gameId: Field<string, string, true>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string> }, false>
    GameRecord: View<"GameRecord", { gameId: Field<string, string, true>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }, false, { round: Field<number> }>
    GameResigned: Event<"GameResigned", { gameId: Field<string>; resigningSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    GameResult: View<"GameResult", { gameId: Field<string, string, true>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }, false>
    GameSetup: Chapter
    GameStarted: Event<"GameStarted", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number>; fen: Field<string>; sideToMove: Field<"white" | "black">; ply: Field<number> }>
    GameState: View<"GameState", { gameId: Field<string, string, true>; ply: Field<number>; sideToMove: Field<"white" | "black">; fen: Field<string> }, false, { gameId: Field<string> }>
    IllegalMoveForfeited: Event<"IllegalMoveForfeited", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    IllegalMoveRuled: Event<"IllegalMoveRuled", { gameId: Field<string>; ply: Field<number>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; addedTimeMs: Field<number>; penalty: Field<"opponent_time_added" | "loss">; fen: Field<string>; sideToMove: Field<"white" | "black"> }>
    IllegalMoveTally: View<"IllegalMoveTally", { gameId: Field<string, string, true>; offendingSide: Field<"white" | "black", string, true>; illegalMoveCount: Field<number> }, false>
    MoveList: View<"MoveList", { gameId: Field<string, string, true>; ply: Field<number, string, true>; san: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean>; status: Field<"recorded" | "struck"> }, false, { gameId: Field<string> }>
    MovePlayed: Event<"MovePlayed", { gameId: Field<string>; ply: Field<number>; san: Field<string>; fromSquare: Field<string>; toSquare: Field<string>; piece: Field<"pawn" | "knight" | "bishop" | "rook" | "queen" | "king">; fen: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean> }>
    OfferDraw: Command<"OfferDraw", { gameId: Field<string>; offeringSide: Field<"white" | "black">; ply: Field<number> }>
    PairingPublished: ExternalEvent<"PairingPublished", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    PairingSystem: External
    PendingDrawOffer: View<"PendingDrawOffer", { gameId: Field<string, string, true>; offeringSide: Field<"white" | "black">; ply: Field<number>; status: Field<"pending" | "declined" | "accepted"> }, false>
    Play: Chapter
    PlayMove: Command<"PlayMove", { gameId: Field<string>; ply: Field<number>; san: Field<string>; fromSquare: Field<string>; toSquare: Field<string>; piece: Field<"pawn" | "knight" | "bishop" | "rook" | "queen" | "king">; fen: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean>; ending: Field<"checkmate" | "stalemate" | "dead_position" | undefined> }>
    Player: Actor
    PressClock: Command<"PressClock", { gameId: Field<string>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    RecordResult: Command<"RecordResult", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Resign: Command<"Resign", { gameId: Field<string>; resigningSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    ResultRecorded: Event<"ResultRecorded", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    RuleIllegalMove: Command<"RuleIllegalMove", { gameId: Field<string>; ply: Field<number>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; addedTimeMs: Field<number>; penalty: Field<"opponent_time_added" | "loss">; fen: Field<string>; sideToMove: Field<"white" | "black"> }>
    SecondIllegalMoveRuled: Event<"SecondIllegalMoveRuled", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number> }>
    Spectator: Actor
    StartClock: Command<"StartClock", { gameId: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    StartGame: Command<"StartGame", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    TimeForfeited: Event<"TimeForfeited", { gameId: Field<string>; flaggedSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
  }
}
//# sourceMappingURL=d.d.ts.map
