// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, Field, Service, Stream, ViewDecl } from "#em"

declare module "#em" {
  interface Registry {
    Capture: Chapter
    CreateNote: CommandDecl<"CreateNote", { noteId: Field<string>; text: Field<string> }>
    FileNote: CommandDecl<"FileNote", { noteId: Field<string> }>
    Filing: Chapter
    Inbox: ViewDecl<"Inbox", { noteId: Field<string, string, true>; text: Field<string>; status: Field<"inbox" | "filed"> }, false, { status: Field<string> }>
    NoteCreated: EventDecl<"NoteCreated", { noteId: Field<string>; text: Field<string> }>
    NoteFiled: EventDecl<"NoteFiled", { noteId: Field<string> }>
    NoteService: Service
    Notes: Stream
    Writer: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
