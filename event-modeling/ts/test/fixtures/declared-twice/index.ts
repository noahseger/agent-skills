// A model that declares one name twice, which only assembly can tell.

import { d, m, t } from "#em"

m.event("Created", { id: t.string() })
m.event("Created", { id: t.string(), at: t.datetime() })
m.view("Table", { id: t.string().key() })
m.chapter("Ch", 1)
m.slice().view(d.Table).event(d.Created).chapter(d.Ch)
export default m.model("x")
