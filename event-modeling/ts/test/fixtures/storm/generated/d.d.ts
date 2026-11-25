// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Event, Field, Stream } from "#em"

declare module "#em" {
  interface Registry {
    GameEnded: Event<"GameEnded", { gameId: Field<string>; result: Field<string> }>
    GameStarted: Event<"GameStarted", { gameId: Field<string> }>
    Games: Stream
    MoveMade: Event<"MoveMade", { gameId: Field<string>; san: Field<string> }>
  }
}
//# sourceMappingURL=d.d.ts.map
