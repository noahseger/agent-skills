// A model being stormed: a slice written before it is in a chapter.

import { z } from "zod"
import { m } from "#em"

export const User = m.actor()
export const Notes = m.service("notes.v1")

m.slice()
  .actor(User)
  .service(Notes)
  .command("CreateNote", { title: z.string() })
  .emits("NoteCreated", { title: z.string() })

export default m.model("Storm")
