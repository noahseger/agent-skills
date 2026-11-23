import { m, t } from "#em"

// The same system, declared again instead of imported.
export const Mail = m.external()
export const Bounced = m.event({ id: t.string() }).external(Mail)
export const Note = m.command({ id: t.string() })
export const Noted = m.event({ id: t.string() })
export const Inbox = m.chapter(2)
m.slice().translation({ Bounced }).command({ Note }).event({ Noted }).chapter(Inbox)
