// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, Field, Stream, View } from "#em"

declare module "#em" {
  interface Registry {
    Archive: Stream
    Capture: Chapter
    CreateNote: Command<"CreateNote", { noteId: Field<string> }>
    FileNote: Command<"FileNote", { noteId: Field<string> }>
    Filing: Chapter
    Inbox: View<"Inbox", { noteId: Field<string, string, true>; filed: Field<boolean> }, false>
    NoteCreated: Event<"NoteCreated", { noteId: Field<string> }>
    NoteFiled: Event<"NoteFiled", { noteId: Field<string> }>
    Notes: Stream
    Writer: Actor
  }
}
//# sourceMappingURL=d.d.ts.map
