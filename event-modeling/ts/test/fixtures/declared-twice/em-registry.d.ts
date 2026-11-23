// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Chapter, EventDecl, Field, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    Ch: Chapter
    Created: EventDecl<"Created", { id: Field<string> }>
    Table: ViewDecl<"Table", { id: Field<string, string, true> }, false>
  }
}
//# sourceMappingURL=em-registry.d.ts.map
