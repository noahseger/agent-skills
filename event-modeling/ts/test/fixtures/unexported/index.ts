// A model whose event is used but never exported, so assembly cannot name it.

import { z } from "zod"
import { m } from "#em"

const Created = m.event({ id: z.string() })
export const Table = m.readModel({ id: z.string() }).key("id")
export const Ch = m.chapter()
m.slice().view(Table, Created).chapter(Ch)
export default m.model("x")
