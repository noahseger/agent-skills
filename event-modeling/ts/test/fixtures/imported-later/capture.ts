// The first chapter's file imports an example from the second's, so the second's module runs first.

import { d, m, t } from "#em"
import { filed } from "./filing.ts"

m.actor("Writer")
m.stream("Notes")
m.chapter("Capture", 1)
m.command("CreateNote", { noteId: t.string() })
m.event("NoteCreated", { noteId: t.string() }).stream(d.Notes)
m.view("Inbox", { noteId: t.string().key(), filed: t.boolean() })

m.slice()
  .command(d.CreateNote)
  .event(d.NoteCreated)
  .chapter(d.Capture)
  .spec("A note is created", {
    when: d.CreateNote({ noteId: "note-1" }),
    then: d.NoteCreated({ noteId: "note-1" }),
  })

m.slice()
  .view(d.Inbox)
  .event(d.NoteCreated, () => ({ filed: t.literal(false) }))
  .event(d.NoteFiled, () => ({ filed: t.literal(true) }))
  .chapter(d.Capture)
  .actor(d.Writer)
  .spec("A filed note shows filed", {
    given: [d.NoteCreated({ noteId: "note-1" }), filed],
    then: d.Inbox({ noteId: "note-1", filed: true }),
  })

export default m.model("Imported later")
