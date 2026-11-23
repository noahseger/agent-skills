// A model being stormed: a slice written before it is in a chapter.

import { d, m, t } from "#em"

m.actor("User")
m.service("Notes", "notes.v1")
m.command("CreateNote", { title: t.string() })
m.event("NoteCreated", { title: t.string() })

m.slice().command(d.CreateNote).event(d.NoteCreated).actor(d.User).service(d.Notes)

export default m.model("Storm")
