import { m, t } from "#em"

export const Mail = m.external()
export const Received = m.event({ id: t.string() }).external(Mail)
export const Record = m.command({ id: t.string() })
export const Recorded = m.event({ id: t.string() })
export const Calendar = m.chapter(1)
m.slice().translation({ Received }).command({ Record }).event({ Recorded }).chapter(Calendar)
