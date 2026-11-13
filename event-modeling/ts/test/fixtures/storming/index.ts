// A model being stormed: a slice written before it is in a chapter.

import { z } from "zod"
import { m } from "#em"

export const User = m.actor()
export const Notes = m.service("notes.v1")
export const CreateNote = m.command({ title: z.string() })
export const NoteCreated = m.event({ title: z.string() })

m.slice().command(CreateNote, NoteCreated).actor(User).service(Notes)

export default m.model("Storm")
