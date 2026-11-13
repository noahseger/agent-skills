// A model in one file, read top to bottom: nothing is used above where it is declared, and a
// later chapter extends a view's state view next to the event that changes it.

import { z } from "zod"
import { m } from "#em"

export const Writer = m.actor()
export const NoteService = m.service("notes.v1")
export const Notes = m.stream()

// Capture: a note lands in the inbox.
export const Capture = m.chapter()
export const CreateNote = m.command({ noteId: z.string(), text: z.string() })
export const NoteCreated = m.event({ noteId: z.string(), text: z.string() }).stream(Notes)
export const Inbox = m
  .view({
    noteId: z.string(),
    text: z.string(),
    status: z.enum(["inbox", "filed"]),
  })
  .key("noteId")

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
  .view(
    Inbox,
    NoteCreated(() => ({ status: z.literal("inbox") })),
  )
  .chapter(Capture)
  .query({ status: z.string() })
  .actor(Writer)
  .service(NoteService, "ListInbox")
  .test("A new note is in the inbox", {
    given: NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
    when: { status: "inbox" },
    then: Inbox({ noteId: "note-1", text: "Call the plumber", status: "inbox" }),
  })

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
  .view(
    Inbox,
    NoteFiled(() => ({ status: z.literal("filed") })),
  )
  .query({ status: z.string() })
  .test("A filed note leaves the inbox", {
    given: [
      NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
      NoteFiled({ noteId: "note-1" }),
    ],
    when: { status: "filed" },
    then: Inbox({ noteId: "note-1", text: "Call the plumber", status: "filed" }),
  })
  .test("Only open notes show", {
    given: [
      NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
      NoteCreated({ noteId: "note-2", text: "Buy milk" }),
      NoteFiled({ noteId: "note-2" }),
    ],
    when: { status: "inbox" },
    then: Inbox({ noteId: "note-1", text: "Call the plumber", status: "inbox" }),
  })

export default m.model("Notes")
