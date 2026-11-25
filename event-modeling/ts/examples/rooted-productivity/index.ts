import { d, m } from "#em"

export default m.model("RootedProductivity")

m.chapter("WeekPlanning", 1)

m.event("WeekPlanned", {})

m.actor("User")

m.service("Service", "Foo")

m.command("PlanWeek", {})

m.slice()
  .command(d.PlanWeek)
  .event(d.WeekPlanned)
  .chapter(d.WeekPlanning)
  .actor(d.User)
  .service(d.Service)
