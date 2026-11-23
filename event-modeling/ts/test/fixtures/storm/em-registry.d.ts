// Written by em types from what the model declares, so d is typed. Do not edit.
import type { EventDecl, Field, Stream } from "#em"

declare module "#em" {
  interface Registry {
    GameEnded: EventDecl<"GameEnded", { gameId: Field<string>; result: Field<string> }>
    GameStarted: EventDecl<"GameStarted", { gameId: Field<string> }>
    Games: Stream
    MoveMade: EventDecl<"MoveMade", { gameId: Field<string>; san: Field<string> }>
  }
}
//# sourceMappingURL=em-registry.d.ts.map
