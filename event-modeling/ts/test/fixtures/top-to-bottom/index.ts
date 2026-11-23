// A model in one file, read top to bottom: nothing is used above where it is declared, and a
// later chapter extends a view's state view next to the event that changes it.

import { d, m, t } from "#em"

m.actor("Writer")
m.service("NoteService", "notes.v1")
m.stream("Notes")

// Capture: a note lands in the inbox.
m.chapter("Capture", 1)
m.command("CreateNote", { noteId: t.string(), text: t.string() })
m.event("NoteCreated", { noteId: t.string(), text: t.string() }).stream(d.Notes)
m.view("Inbox", {
  noteId: t.string().key(),
  text: t.string(),
  status: t.enum(["inbox", "filed"]),
})

m.slice()
  .command(d.CreateNote)
  .event(d.NoteCreated)
  .chapter(d.Capture)
  .actor(d.Writer)
  .service(d.NoteService)
  .test("A note lands in the inbox", {
    when: d.CreateNote({ noteId: "note-1", text: "Call the plumber" }),
    then: d.NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
  })

m.slice()
  .view(d.Inbox)
  .event(d.NoteCreated, () => ({ status: t.literal("inbox") }))
  .context({ status: t.string() })
  .chapter(d.Capture)
  .actor(d.Writer)
  .service(d.NoteService, "ListInbox")
  .test("A new note is in the inbox", {
    given: d.NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
    when: { status: "inbox" },
    then: d.Inbox({ noteId: "note-1", text: "Call the plumber", status: "inbox" }),
  })

// Filing: the writer files a note, and the inbox shows it filed.
m.chapter("Filing", 2)
m.command("FileNote", { noteId: t.string() })
m.event("NoteFiled", { noteId: t.string() }).stream(d.Notes)

m.slice()
  .command(d.FileNote)
  .event(d.NoteFiled)
  .chapter(d.Filing)
  .actor(d.Writer)
  .service(d.NoteService)
  .test("The writer files a note", {
    when: d.FileNote({ noteId: "note-1" }),
    then: d.NoteFiled({ noteId: "note-1" }),
  })

m.slice()
  .view(d.Inbox)
  .event(d.NoteFiled, () => ({ status: t.literal("filed") }))
  .context({ status: t.string() })
  .test("A filed note leaves the inbox", {
    given: [
      d.NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
      d.NoteFiled({ noteId: "note-1" }),
    ],
    when: { status: "filed" },
    then: d.Inbox({ noteId: "note-1", text: "Call the plumber", status: "filed" }),
  })
  .test("Only open notes show", {
    given: [
      d.NoteCreated({ noteId: "note-1", text: "Call the plumber" }),
      d.NoteCreated({ noteId: "note-2", text: "Buy milk" }),
      d.NoteFiled({ noteId: "note-2" }),
    ],
    when: { status: "inbox" },
    then: d.Inbox({ noteId: "note-1", text: "Call the plumber", status: "inbox" }),
  })

export default m.model("Notes")
