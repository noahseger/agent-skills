import { z } from "zod"
import { m } from "#em"

export const Mail = m.external({ Received: m.event({ id: z.string() }) })
export const Record = m.command({ id: z.string() })
export const Recorded = m.event({ id: z.string() })
export const Calendar = [m.slice().trigger(Mail.Received).command(Record).event(Recorded)]
