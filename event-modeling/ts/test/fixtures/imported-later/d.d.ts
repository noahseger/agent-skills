// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, Field, Stream, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    Archive: Stream
    Capture: Chapter
    CreateNote: CommandDecl<"CreateNote", { noteId: Field<string> }>
    FileNote: CommandDecl<"FileNote", { noteId: Field<string> }>
    Filing: Chapter
    Inbox: ViewDecl<"Inbox", { noteId: Field<string, string, true>; filed: Field<boolean> }, false>
    NoteCreated: EventDecl<"NoteCreated", { noteId: Field<string> }>
    NoteFiled: EventDecl<"NoteFiled", { noteId: Field<string> }>
    Notes: Stream
    Writer: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
