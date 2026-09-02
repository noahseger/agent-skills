<script setup lang="ts">
import { computed } from "vue"
import type { ModelJson } from "../../src/json.ts"
import { type Box, type Column, type Layout, parse } from "./layout.ts"

const props = defineProps<{ box: Box | null; column: Column; layout: Layout; model: ModelJson }>()
defineEmits<{ close: [] }>()

const KIND: Record<Box["kind"], string> = {
  ui: "screen",
  external: "external event",
  command: "command",
  event: "event",
  readModel: "read model",
  automation: "automation",
}

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
const actor = computed(() => props.model.actors.find((a) => a.id === slice.value.actor)?.name)
const mapping = computed(() =>
  props.box?.kind === "event" ? slice.value.mapping?.[props.box.name] : undefined,
)
const triggers = computed(() => {
  const t = slice.value.trigger
  return t ? (Array.isArray(t) ? t : [t]).map((x) => parse(x).name).join(", ") : ""
})

function source(s: { from?: string; value?: unknown; count?: string }): string {
  if (s.from !== undefined) return `← ${s.from}`
  if (s.count !== undefined) return `count of ${s.count}`
  return `= ${JSON.stringify(s.value)}`
}
const isError = (clause: string) => clause.startsWith("Error:")
</script>

<template>
  <aside class="detail">
    <header>
      <span class="kind" :class="box?.kind ?? 'slice'">{{ box ? KIND[box.kind] : "slice" }}</span>
      <h2>{{ box ? box.name : column.label }}</h2>
      <button class="close" type="button" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <p v-if="note" class="note">{{ note }}</p>

    <template v-if="fields.fields.length">
      <h3>{{ box?.kind === "ui" ? "Query" : "Fields" }}</h3>
      <table>
        <tr v-for="f in fields.fields" :key="f">
          <td class="name">{{ f }}</td>
          <td class="hint">
            <template v-if="fields.keys.includes(f)">key</template>
            <template v-else-if="mapping?.[f]">{{ source(mapping[f]!) }}</template>
          </td>
        </tr>
      </table>
    </template>

    <h3>Slice</h3>
    <dl>
      <template v-if="slice.name"><dt>Name</dt><dd>{{ slice.name }}</dd></template>
      <template v-if="actor"><dt>Actor</dt><dd>{{ actor }}</dd></template>
      <template v-if="slice.ui"><dt>Service</dt><dd>{{ slice.ui }}</dd></template>
      <template v-if="slice.polls"><dt>Polls</dt><dd>{{ slice.polls }}</dd></template>
      <template v-if="slice.reads?.length"><dt>Reads</dt><dd>{{ slice.reads.join(", ") }}</dd></template>
      <template v-if="triggers"><dt>On</dt><dd>{{ triggers }}</dd></template>
    </dl>
    <p v-if="slice.note" class="note" style="margin-top: 10px">{{ slice.note }}</p>

    <template v-if="slice.tests.length">
      <h3>Specifications</h3>
      <div v-for="t in slice.tests" :key="t.name" class="spec">
        <div class="name">{{ t.name }}</div>
        <div v-if="t.given.length" class="step">
          <span class="word">given</span>
          <span><code v-for="g in t.given" :key="g">{{ g }}</code></span>
        </div>
        <div v-if="t.when" class="step">
          <span class="word">when</span>
          <span><code>{{ t.when }}</code></span>
        </div>
        <div class="step">
          <span class="word">then</span>
          <span><code v-for="c in t.then" :key="c" :class="{ rejected: isError(c) }">{{ c }}</code></span>
        </div>
      </div>
    </template>
  </aside>
</template>
