// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, External, ExternalEventDecl, Field, Screen, Service, Stream, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    AcceptDraw: CommandDecl<"AcceptDraw", { gameId: Field<string>; offeringSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    AdjudicateOutcome: CommandDecl<"AdjudicateOutcome", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Arbiter: Actor
    ArbiterRulings: Chapter
    BoardOutcomeAdjudicated: EventDecl<"BoardOutcomeAdjudicated", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Broadcast: Screen
    ChessService: Service
    ClaimFlagFall: CommandDecl<"ClaimFlagFall", { gameId: Field<string>; flaggedSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Clock: Stream
    ClockPressed: EventDecl<"ClockPressed", { gameId: Field<string>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    ClockStarted: EventDecl<"ClockStarted", { gameId: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    ClockState: ViewDecl<"ClockState", { gameId: Field<string, string, true>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }, false>
    Conclusion: Chapter
    DrawAgreed: EventDecl<"DrawAgreed", { gameId: Field<string>; offeringSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    DrawOffered: EventDecl<"DrawOffered", { gameId: Field<string>; offeringSide: Field<"white" | "black">; ply: Field<number> }>
    DrawsAndResignation: Chapter
    ForfeitGame: CommandDecl<"ForfeitGame", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number> }>
    Game: Stream
    GameEnded: EventDecl<"GameEnded", { gameId: Field<string>; ply: Field<number>; fen: Field<string>; ending: Field<"checkmate" | "stalemate" | "dead_position"> }>
    GamePairing: ViewDecl<"GamePairing", { gameId: Field<string, string, true>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string> }, false>
    GameRecord: ViewDecl<"GameRecord", { gameId: Field<string, string, true>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }, false, { round: Field<number> }>
    GameResigned: EventDecl<"GameResigned", { gameId: Field<string>; resigningSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    GameResult: ViewDecl<"GameResult", { gameId: Field<string, string, true>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }, false>
    GameSetup: Chapter
    GameStarted: EventDecl<"GameStarted", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number>; fen: Field<string>; sideToMove: Field<"white" | "black">; ply: Field<number> }>
    GameState: ViewDecl<"GameState", { gameId: Field<string, string, true>; ply: Field<number>; sideToMove: Field<"white" | "black">; fen: Field<string> }, false, { gameId: Field<string> }>
    IllegalMoveForfeited: EventDecl<"IllegalMoveForfeited", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    IllegalMoveRuled: EventDecl<"IllegalMoveRuled", { gameId: Field<string>; ply: Field<number>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; addedTimeMs: Field<number>; penalty: Field<"opponent_time_added" | "loss">; fen: Field<string>; sideToMove: Field<"white" | "black"> }>
    IllegalMoveTally: ViewDecl<"IllegalMoveTally", { gameId: Field<string, string, true>; offendingSide: Field<"white" | "black", string, true>; illegalMoveCount: Field<number> }, false>
    MoveList: ViewDecl<"MoveList", { gameId: Field<string, string, true>; ply: Field<number, string, true>; san: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean>; status: Field<"recorded" | "struck"> }, false, { gameId: Field<string> }>
    MovePlayed: EventDecl<"MovePlayed", { gameId: Field<string>; ply: Field<number>; san: Field<string>; fromSquare: Field<string>; toSquare: Field<string>; piece: Field<"pawn" | "knight" | "bishop" | "rook" | "queen" | "king">; fen: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean> }>
    OfferDraw: CommandDecl<"OfferDraw", { gameId: Field<string>; offeringSide: Field<"white" | "black">; ply: Field<number> }>
    PairingPublished: ExternalEventDecl<"PairingPublished", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    PairingSystem: External
    PendingDrawOffer: ViewDecl<"PendingDrawOffer", { gameId: Field<string, string, true>; offeringSide: Field<"white" | "black">; ply: Field<number>; status: Field<"pending" | "declined" | "accepted"> }, false>
    Play: Chapter
    PlayMove: CommandDecl<"PlayMove", { gameId: Field<string>; ply: Field<number>; san: Field<string>; fromSquare: Field<string>; toSquare: Field<string>; piece: Field<"pawn" | "knight" | "bishop" | "rook" | "queen" | "king">; fen: Field<string>; sideToMove: Field<"white" | "black">; isCheck: Field<boolean>; isCapture: Field<boolean>; ending: Field<"checkmate" | "stalemate" | "dead_position" | undefined> }>
    Player: Actor
    PressClock: CommandDecl<"PressClock", { gameId: Field<string>; whiteTimeMs: Field<number>; blackTimeMs: Field<number>; runningSide: Field<"white" | "black"> }>
    RecordResult: CommandDecl<"RecordResult", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    Resign: CommandDecl<"Resign", { gameId: Field<string>; resigningSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    ResultRecorded: EventDecl<"ResultRecorded", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
    RuleIllegalMove: CommandDecl<"RuleIllegalMove", { gameId: Field<string>; ply: Field<number>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number>; addedTimeMs: Field<number>; penalty: Field<"opponent_time_added" | "loss">; fen: Field<string>; sideToMove: Field<"white" | "black"> }>
    SecondIllegalMoveRuled: EventDecl<"SecondIllegalMoveRuled", { gameId: Field<string>; offendingSide: Field<"white" | "black">; illegalMoveCount: Field<number> }>
    Spectator: Actor
    StartClock: CommandDecl<"StartClock", { gameId: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    StartGame: CommandDecl<"StartGame", { gameId: Field<string>; round: Field<number>; boardNumber: Field<number>; whitePlayerId: Field<string>; blackPlayerId: Field<string>; timeControl: Field<string>; baseMinutes: Field<number>; incrementSeconds: Field<number> }>
    TimeForfeited: EventDecl<"TimeForfeited", { gameId: Field<string>; flaggedSide: Field<"white" | "black">; result: Field<"white_won" | "black_won" | "draw">; termination: Field<"checkmate" | "stalemate" | "dead_position" | "resignation" | "agreement" | "time_forfeit" | "illegal_move_forfeit"> }>
  }
}
//# sourceMappingURL=em-registry.d.ts.map
