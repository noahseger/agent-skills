import { z } from "zod"
import { m } from "#em"

export const Archive = m.stream()
export const Filing = m.chapter(2)
export const FileNote = m.command({ noteId: z.string() })
export const NoteFiled = m.event({ noteId: z.string() }).stream(Archive)

m.slice()
  .command({ FileNote })
  .event({ NoteFiled })
  .chapter(Filing)
  .test("A note is filed", {
    when: FileNote({ noteId: "note-1" }),
    then: NoteFiled({ noteId: "note-1" }),
  })
