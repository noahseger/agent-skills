import { z } from "zod"
import { m } from "#em"

export const Mail = m.external()
export const Received = m.event({ id: z.string() }).external(Mail)
export const Record = m.command({ id: z.string() })
export const Recorded = m.event({ id: z.string() })
export const Calendar = m.chapter()
m.slice().trigger(Received, Record, Recorded).chapter(Calendar)
