// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, CommandDecl, EventDecl, Field, Service } from "#em"

declare module "#em" {
  interface Registry {
    CreateNote: CommandDecl<"CreateNote", { title: Field<string> }>
    NoteCreated: EventDecl<"NoteCreated", { title: Field<string> }>
    Notes: Service
    User: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
