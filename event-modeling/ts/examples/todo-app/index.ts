// The model of tests/fixtures/todo_app_brief.md.
import { m } from "#em"

import { ListManagement } from "./list-management.ts"
import { Automations, Integrations, Views } from "./views.ts"

export default m.model("Todo List Application", {
  description: "Users manage personal todo lists.",
  chapters: [ListManagement, Views, Automations, Integrations],
})
