import { m } from "#em"

export default m.model("RootedProductivity")

export const WeekPlanning = m.chapter(1)

export const WeekPlanned = m.event({})

export const User = m.actor()

export const Service = m.service("Foo")

export const PlanWeek = m.command({})

m.slice()
  .command({ PlanWeek })
  .event({ WeekPlanned })
  .chapter(WeekPlanning)
  .actor(User)
  .service(Service)
