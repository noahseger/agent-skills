import { d, m, t } from "#em"

m.external("Mail")
m.event("Received", { id: t.string() }).external(d.Mail)
m.command("Record", { id: t.string() })
m.event("Recorded", { id: t.string() })
m.chapter("Calendar", 1)
m.slice().translation(d.Received).command(d.Record).event(d.Recorded).chapter(d.Calendar)
