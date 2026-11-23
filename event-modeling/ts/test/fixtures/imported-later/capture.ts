// The first chapter's file imports the second's, so the second's module runs first.

import { m, t } from "#em"
import { NoteFiled } from "./filing.ts"

export const Writer = m.actor()
export const Notes = m.stream()
export const Capture = m.chapter(1)
export const CreateNote = m.command({ noteId: t.string() })
export const NoteCreated = m.event({ noteId: t.string() }).stream(Notes)
export const Inbox = m.view({ noteId: t.string().key(), filed: t.boolean() })

m.slice()
  .command({ CreateNote })
  .event({ NoteCreated })
  .chapter(Capture)
  .test("A note is created", {
    when: CreateNote({ noteId: "note-1" }),
    then: NoteCreated({ noteId: "note-1" }),
  })

m.slice()
  .view({ Inbox })
  .event({ NoteCreated }, () => ({ filed: t.literal(false) }))
  .event({ NoteFiled }, () => ({ filed: t.literal(true) }))
  .chapter(Capture)
  .actor(Writer)
  .test("A filed note shows filed", {
    given: [NoteCreated({ noteId: "note-1" }), NoteFiled({ noteId: "note-1" })],
    then: Inbox({ noteId: "note-1", filed: true }),
  })

export default m.model("Imported later")
