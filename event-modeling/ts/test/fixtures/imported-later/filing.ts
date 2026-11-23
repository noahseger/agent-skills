import { d, m, t } from "#em"

m.stream("Archive")
m.chapter("Filing", 2)
m.command("FileNote", { noteId: t.string() })
m.event("NoteFiled", { noteId: t.string() }).stream(d.Archive)

export const filed = d.NoteFiled({ noteId: "note-1" })

m.slice()
  .command(d.FileNote)
  .event(d.NoteFiled)
  .chapter(d.Filing)
  .test("A note is filed", {
    when: d.FileNote({ noteId: "note-1" }),
    then: filed,
  })
