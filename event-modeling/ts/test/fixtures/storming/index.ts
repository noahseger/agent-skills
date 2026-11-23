// A model being stormed: a slice written before it is in a chapter.

import { m, t } from "#em"

export const User = m.actor()
export const Notes = m.service("notes.v1")
export const CreateNote = m.command({ title: t.string() })
export const NoteCreated = m.event({ title: t.string() })

m.slice().command({ CreateNote }).event({ NoteCreated }).actor(User).service(Notes)

export default m.model("Storm")
