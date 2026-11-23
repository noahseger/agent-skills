// A model whose event is used but never exported, so assembly cannot name it.

import { m, t } from "#em"

const Created = m.event({ id: t.string() })
export const Table = m.view({ id: t.string() }).key("id")
export const Ch = m.chapter(1)
m.slice().view({ Table }).event({ Created }).chapter(Ch)
export default m.model("x")
