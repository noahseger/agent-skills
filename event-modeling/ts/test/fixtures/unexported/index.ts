// A model whose event is used but never exported, so assembly cannot name it.

import { z } from "zod"
import { m } from "#em"

const Created = m.event({ id: z.string() })
export const Table = m.readModel({ id: m.key(z.string()) })
export default m.model("x", { chapters: { Ch: [m.slice().projection(Table, Created)] } })
