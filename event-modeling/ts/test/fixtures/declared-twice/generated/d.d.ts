// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Chapter, Event, Field, View } from "#em"

declare module "#em" {
  interface Registry {
    Ch: Chapter
    Created: Event<"Created", { id: Field<string> }> & Event<"Created", { id: Field<string>; at: Field<string, "datetime"> }>
    Table: View<"Table", { id: Field<string, string, true> }, false>
  }
}
//# sourceMappingURL=d.d.ts.map
