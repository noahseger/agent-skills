import { z } from "zod"
import { m } from "#em"

// The same system, declared again instead of imported.
export const Mail = m.external({ Bounced: m.event({ id: z.string() }) })
export const Note = m.command({ id: z.string() })
export const Noted = m.event({ id: z.string() })
export const Inbox = [m.slice().on(Mail.Bounced).command(Note).emits(Noted)]
