// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Chapter, Command, Event, External, ExternalEvent, Field } from "#em"

declare module "#em" {
  interface Registry {
    Bounced: ExternalEvent<"Bounced", { id: Field<string> }>
    Calendar: Chapter
    Inbox: Chapter
    Mail: External
    Note: Command<"Note", { id: Field<string> }>
    Noted: Event<"Noted", { id: Field<string> }>
    Received: ExternalEvent<"Received", { id: Field<string> }>
    Record: Command<"Record", { id: Field<string> }>
    Recorded: Event<"Recorded", { id: Field<string> }>
  }
}
//# sourceMappingURL=d.d.ts.map
