// A model in one file, read top to bottom: nothing is used above where it is declared, and a
// later chapter extends a read model next to the event that changes it.

import { z } from "zod"
import { m } from "#em"

export const Writer = m.actor()
export const NoteService = m.service("notes.v1")
export const Notes = m.stream()

// Capture: a note lands in the inbox.
export const CreateNote = m.command({ noteId: z.string(), text: z.string() })
export const NoteCreated = m.event({ noteId: z.string(), text: z.string() }).stream(Notes)
export const Inbox = m.readModel({
  noteId: m.key(z.string()),
  text: z.string(),
  status: z.enum(["inbox", "filed"]),
})

const Capture = [
  m
    .slice()
    .command(CreateNote)
    .event(NoteCreated)
    .actor(Writer)
    .service(NoteService)
    .test("A note lands in the inbox", {
      when: CreateNote({ noteId: "note-1", text: "Call the plumber" }),
      then: NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
    }),
  m
    .slice()
    .projection(Inbox)
    .event(NoteCreated(() => ({ status: "inbox" }))),
]

// Filing: the writer files a note, and the inbox shows it filed.
export const FileNote = m.command({ noteId: z.string() })
export const NoteFiled = m.event({ noteId: z.string() }).stream(Notes)

const Filing = [
  m
    .slice()
    .command(FileNote)
    .event(NoteFiled)
    .actor(Writer)
    .service(NoteService)
    .test("The writer files a note", {
      when: FileNote({ noteId: "note-1" }),
      then: NoteFiled({ noteId: "note-1" }),
    }),
  m
    .slice()
    .projection(Inbox)
    .event(NoteFiled(() => ({ status: "filed" }))),
  m.slice().view(Inbox).actor(Writer).service(NoteService, "ListInbox"),
]

export default m.model("Notes", { chapters: { Capture, Filing } })
