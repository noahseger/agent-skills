import { m } from "#em"
import { Calendar } from "./calendar.ts"
import { Inbox } from "./inbox.ts"

export default m.model("Twice", { chapters: { Calendar, Inbox } })
