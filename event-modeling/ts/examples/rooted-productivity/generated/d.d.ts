// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, Command, Event, Service } from "#em"

declare module "#em" {
  interface Registry {
    PlanWeek: Command<"PlanWeek", {}>
    Service: Service
    User: Actor
    WeekPlanned: Event<"WeekPlanned", {}>
    WeekPlanning: Chapter
  }
}
//# sourceMappingURL=d.d.ts.map
