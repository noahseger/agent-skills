// Written by em types from what the model declares, so d is typed. Do not edit.
import type { Actor, Chapter, CommandDecl, EventDecl, Service } from "#em"

declare module "#em" {
  interface Registry {
    PlanWeek: CommandDecl<"PlanWeek", {}>
    Service: Service
    User: Actor
    WeekPlanned: EventDecl<"WeekPlanned", {}>
    WeekPlanning: Chapter
  }
}
//# sourceMappingURL=em-registry.d.ts.map
