// A model in one file, read top to bottom: nothing is used above where it is declared, and a
// later chapter extends a view's state view next to the event that changes it.

import { m, t } from "#em"

export const Writer = m.actor()
export const NoteService = m.service("notes.v1")
export const Notes = m.stream()

// Capture: a note lands in the inbox.
export const Capture = m.chapter(1)
export const CreateNote = m.command({ noteId: t.string(), text: t.string() })
export const NoteCreated = m.event({ noteId: t.string(), text: t.string() }).stream(Notes)
export const Inbox = m
  .view({
    noteId: t.string(),
    text: t.string(),
    status: t.enum(["inbox", "filed"]),
  })
  .key("noteId")

m.slice()
  .command({ CreateNote })
  .event({ NoteCreated })
  .chapter(Capture)
  .actor(Writer)
  .service(NoteService)
  .test("A note lands in the inbox", {
    when: CreateNote({ noteId: "note-1", text: "Call the plumber" }),
    then: NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
  })

m.slice()
  .view({ Inbox })
  .event({ NoteCreated }, () => ({ status: t.literal("inbox") }))
  .context({ status: t.string() })
  .chapter(Capture)
  .actor(Writer)
  .service(NoteService, "ListInbox")
  .test("A new note is in the inbox", {
    given: NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
    when: { status: "inbox" },
    then: Inbox({ noteId: "note-1", text: "Call the plumber", status: "inbox" }),
  })

// Filing: the writer files a note, and the inbox shows it filed.
export const Filing = m.chapter(2)
export const FileNote = m.command({ noteId: t.string() })
export const NoteFiled = m.event({ noteId: t.string() }).stream(Notes)

m.slice()
  .command({ FileNote })
  .event({ NoteFiled })
  .chapter(Filing)
  .actor(Writer)
  .service(NoteService)
  .test("The writer files a note", {
    when: FileNote({ noteId: "note-1" }),
    then: NoteFiled({ noteId: "note-1" }),
  })

m.slice()
  .view({ Inbox })
  .event({ NoteFiled }, () => ({ status: t.literal("filed") }))
  .context({ status: t.string() })
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
