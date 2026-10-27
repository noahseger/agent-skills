<script setup lang="ts">
import { computed } from "vue"
import type { ModelJson } from "../../src/json.ts"
import { strings } from "../../src/strings.ts"
import { type Box, type Column, type Layout, parse, parseClause, words } from "./layout.ts"

const props = defineProps<{
  box: Box | null
  column: Column
  layout: Layout
  model: ModelJson
  /** Whether the slice is already open at full width. */
  open: boolean
}>()
defineEmits<{ close: []; open: []; goto: [column: number] }>()

const say = strings.viewer

const slice = computed(() => props.column.slice)

// A compact card is a reference; its fields are where the element is drawn in full.
const fields = computed(() => {
  const box = props.box
  if (!box) return { fields: [], keys: [] }
  if (!box.compact) return { fields: box.fields, keys: box.keys }
  const full = props.layout.boxes.find((b) => b.name === box.name && !b.compact)
  return full ? { fields: full.fields, keys: full.keys } : { fields: [], keys: [] }
})

const note = computed(() => (props.box ? props.model.notes[props.box.name] : undefined))
// What is unfinished about the element, then about the rest of the slice.
const elementWarnings = computed(() =>
  (props.model.warnings ?? []).filter((w) => props.box && w.element === props.box.name),
)
const sliceWarnings = computed(() =>
  (props.model.warnings ?? []).filter(
    (w) => w.slice === slice.value.name && !elementWarnings.value.includes(w),
  ),
)
const actor = computed(() => props.model.actors.find((a) => a.id === slice.value.actor)?.name)
const mapping = computed(() =>
  props.box?.kind === "event" ? slice.value.mapping?.[props.box.name] : undefined,
)
const triggers = computed(() => {
  const t = slice.value.trigger
  return t ? (Array.isArray(t) ? t : [t]).map((x) => parse(x).name).join(", ") : ""
})

// The element's specifications, or the slice's when nothing is selected.
interface Group {
  column: number
  heading: string
  tests: { name: string; given: string[]; when: string; then: string[] }[]
}
const groups = computed<Group[]>(() => {
  const name = props.box?.name
  const out: Group[] = []
  for (const col of props.layout.columns) {
    const tests = name
      ? col.slice.tests.filter((t) =>
          [...t.given, t.when, ...t.then].some((c) => c && parseClause(c).name === name),
        )
      : col.index === props.column.index
        ? col.slice.tests
        : []
    if (tests.length === 0) continue
    const chapter = props.layout.chapters[col.chapter]?.name ?? ""
    out.push({ column: col.index, heading: say.specHeading(words(chapter), col.title), tests })
  }
  return out
})

function source(s: { from?: string; value?: unknown; count?: string }): string {
  if (s.from !== undefined) return say.source.from(s.from)
  if (s.count !== undefined) return say.source.count(s.count)
  return say.source.value(JSON.stringify(s.value))
}
const isError = (clause: string) => clause.startsWith("Error:")
/** The JSON says `Error:`; the model and the manual say rejected. */
const show = (clause: string) => clause.replace(/^Error:/, `${say.rejected}:`)
const mentions = (clause: string) =>
  props.box !== null && parseClause(clause).name === props.box.name
</script>

<template>
  <aside class="detail" :aria-label="say.details">
    <header>
      <span class="kind" :class="box?.kind ?? 'slice'">{{ box ? say.kinds[box.kind] : say.slice }}</span>
      <h2>{{ box ? box.name : column.title }}</h2>
      <button v-if="!open" class="open" type="button" :title="say.openTitle" @click="$emit('open')">{{ say.open }}</button>
      <button class="close" type="button" :title="say.closeTitle" @click="$emit('close')">×</button>
    </header>

    <p v-if="note" class="note"><span class="badge" aria-hidden="true">i</span>{{ note }}</p>
    <p v-for="w in elementWarnings" :key="w.message" class="note warning"><span class="badge" aria-hidden="true">!</span>{{ w.message }}</p>

    <template v-if="fields.fields.length">
      <h3>{{ box?.kind === "ui" ? say.headings.query : say.headings.fields }}</h3>
      <table>
        <tr v-for="f in fields.fields" :key="f">
          <td class="name">{{ f }}</td>
          <td class="hint">
            <template v-if="fields.keys.includes(f)">{{ say.key }}</template>
            <template v-else-if="mapping?.[f]">{{ source(mapping[f]!) }}</template>
          </td>
        </tr>
      </table>
    </template>

    <h3>{{ say.headings.slice }}</h3>
    <dl>
      <dt>{{ say.facts.name }}</dt>
      <dd>{{ column.label }}</dd>
      <template v-if="actor"><dt>{{ say.facts.actor }}</dt><dd>{{ actor }}</dd></template>
      <template v-if="slice.ui"><dt>{{ say.facts.service }}</dt><dd>{{ slice.ui }}</dd></template>
      <template v-if="slice.query?.length"><dt>{{ say.facts.query }}</dt><dd>{{ slice.query.join(", ") }}</dd></template>
      <template v-if="slice.polls"><dt>{{ say.facts.polls }}</dt><dd>{{ slice.polls }}</dd></template>
      <template v-if="slice.reads?.length"><dt>{{ say.facts.reads }}</dt><dd>{{ slice.reads.join(", ") }}</dd></template>
      <template v-if="triggers"><dt>{{ say.facts.on }}</dt><dd>{{ triggers }}</dd></template>
    </dl>
    <p v-if="slice.note" class="note" style="margin-top: 10px"><span class="badge" aria-hidden="true">i</span>{{ slice.note }}</p>
    <p v-for="w in sliceWarnings" :key="w.message" class="note warning" style="margin-top: 10px"><span class="badge" aria-hidden="true">!</span>{{ w.message }}</p>

    <template v-if="groups.length">
      <h3>{{ say.specifications }}</h3>
      <template v-for="g in groups" :key="g.column">
        <button v-if="box" type="button" class="group" @click="$emit('goto', g.column)">{{ g.heading }}</button>
        <div v-for="t in g.tests" :key="t.name" class="spec">
          <div class="name">{{ t.name }}</div>
          <div v-if="t.given.length" class="step">
            <span class="word">{{ say.steps.given }}</span>
            <span><code v-for="c in t.given" :key="c" :class="{ mark: mentions(c) }">{{ c }}</code></span>
          </div>
          <div v-if="t.when" class="step">
            <span class="word">{{ say.steps.when }}</span>
            <span><code :class="{ mark: mentions(t.when) }">{{ t.when }}</code></span>
          </div>
          <div class="step">
            <span class="word">{{ say.steps.then }}</span>
            <span>
              <code v-for="c in t.then" :key="c" :class="{ rejected: isError(c), mark: mentions(c) }">{{ show(c) }}</code>
            </span>
          </div>
        </div>
      </template>
    </template>
  </aside>
</template>
