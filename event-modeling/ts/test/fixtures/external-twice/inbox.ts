import { d, m, t } from "#em"

// The same system, declared again: one lane by name.
m.external("Mail")
m.event("Bounced", { id: t.string() }).external(d.Mail)
m.command("Note", { id: t.string() })
m.event("Noted", { id: t.string() })
m.chapter("Inbox", 2)
m.slice().translation(d.Bounced).command(d.Note).event(d.Noted).chapter(d.Inbox)
