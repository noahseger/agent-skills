import { z } from "zod"
import { m } from "#em"

// The same system, declared again instead of imported.
export const Mail = m.external()
export const Bounced = m.event({ id: z.string() }).external(Mail)
export const Note = m.command({ id: z.string() })
export const Noted = m.event({ id: z.string() })
export const Inbox = m.chapter()
m.slice().trigger(Bounced, Note, Noted).chapter(Inbox)
