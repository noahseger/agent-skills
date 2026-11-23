// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Chapter, CommandDecl, EventDecl, External, ExternalEventDecl, Field } from "#em"

declare module "#em" {
  interface Registry {
    Bounced: ExternalEventDecl<"Bounced", { id: Field<string> }>
    Calendar: Chapter
    Inbox: Chapter
    Mail: External
    Note: CommandDecl<"Note", { id: Field<string> }>
    Noted: EventDecl<"Noted", { id: Field<string> }>
    Received: ExternalEventDecl<"Received", { id: Field<string> }>
    Record: CommandDecl<"Record", { id: Field<string> }>
    Recorded: EventDecl<"Recorded", { id: Field<string> }>
  }
}
//# sourceMappingURL=em-registry.d.ts.map
