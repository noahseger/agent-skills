// A model in one file, read top to bottom: nothing is used above where it is declared, and a
// later chapter extends a read model next to the event that changes it.

import { z } from "zod"
import { m } from "#em"

export const Writer = m.actor()
export const NoteService = m.service("notes.v1")
export const Notes = m.stream()

// Capture: a note lands in the inbox.
export const Capture = m.chapter()
export const CreateNote = m.command({ noteId: z.string(), text: z.string() })
export const NoteCreated = m.event({ noteId: z.string(), text: z.string() }).stream(Notes)
export const Inbox = m.readModel({
  noteId: m.key(z.string()),
  text: z.string(),
  status: z.enum(["inbox", "filed"]),
})

m.slice()
  .command(CreateNote, NoteCreated)
  .chapter(Capture)
  .actor(Writer)
  .service(NoteService)
  .test("A note lands in the inbox", {
    when: CreateNote({ noteId: "note-1", text: "Call the plumber" }),
    then: NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
  })

m.slice()
  .projection(
    Inbox,
    NoteCreated(() => ({ status: "inbox" })),
  )
  .chapter(Capture)

// Filing: the writer files a note, and the inbox shows it filed.
export const Filing = m.chapter()
export const FileNote = m.command({ noteId: z.string() })
export const NoteFiled = m.event({ noteId: z.string() }).stream(Notes)

m.slice()
  .command(FileNote, NoteFiled)
  .chapter(Filing)
  .actor(Writer)
  .service(NoteService)
  .test("The writer files a note", {
    when: FileNote({ noteId: "note-1" }),
    then: NoteFiled({ noteId: "note-1" }),
  })

m.slice()
  .projection(
    Inbox,
    NoteFiled(() => ({ status: "filed" })),
  )
  .chapter(Filing)

m.slice().view(Inbox).chapter(Filing).actor(Writer).service(NoteService, "ListInbox")

export default m.model("Notes")
