// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Command, Event, Field, Service } from "#em"

declare module "#em" {
  interface Registry {
    CreateNote: Command<"CreateNote", { title: Field<string> }>
    NoteCreated: Event<"NoteCreated", { title: Field<string> }>
    Notes: Service
    User: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
