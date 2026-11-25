// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, Field, Service, Stream, View } from "#em"

declare module "#em" {
  interface Registry {
    Capture: Chapter
    CreateNote: Command<"CreateNote", { noteId: Field<string>; text: Field<string> }>
    FileNote: Command<"FileNote", { noteId: Field<string> }>
    Filing: Chapter
    Inbox: View<"Inbox", { noteId: Field<string, string, true>; text: Field<string>; status: Field<"inbox" | "filed"> }, false, { status: Field<string> }>
    NoteCreated: Event<"NoteCreated", { noteId: Field<string>; text: Field<string> }>
    NoteFiled: Event<"NoteFiled", { noteId: Field<string> }>
    NoteService: Service
    Notes: Stream
    Writer: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
