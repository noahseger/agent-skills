<script setup lang="ts">
import { computed } from "vue"
import type { ModelJson, SliceJson } from "../../src/json.ts"
import { type Box, type Layout, parse } from "./layout.ts"

const props = defineProps<{ box: Box; layout: Layout; model: ModelJson }>()
defineEmits<{ close: [] }>()

const KIND: Record<Box["kind"], string> = {
  ui: "screen",
  external: "external event",
  command: "command",
  event: "event",
  readModel: "read model",
  automation: "automation",
}

const slice = computed<SliceJson | undefined>(() => props.layout.columns[props.box.column]?.slice)

// A compact card is a reference; its fields are wherever the read model is drawn in full.
const fields = computed(() => {
  if (!props.box.compact) return { fields: props.box.fields, keys: props.box.keys }
  const full = props.layout.boxes.find((b) => b.name === props.box.name && !b.compact)
  return full ? { fields: full.fields, keys: full.keys } : { fields: [], keys: [] }
})

const note = computed(() => props.model.notes[props.box.name])
const actor = computed(() => props.model.actors.find((a) => a.id === slice.value?.actor)?.name)
const mapping = computed(() =>
  props.box.kind === "event" ? slice.value?.mapping?.[props.box.name] : undefined,
)

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
      <span class="kind" :class="box.kind">{{ KIND[box.kind] }}</span>
      <h2>{{ box.name }}</h2>
      <button class="close" type="button" title="Close (Esc)" @click="$emit('close')">×</button>
    </header>

    <p v-if="note" class="note">{{ note }}</p>

    <template v-if="fields.fields.length">
      <h3>{{ box.kind === "ui" ? "Query" : "Fields" }}</h3>
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

    <template v-if="slice">
      <h3>Slice</h3>
      <dl>
        <template v-if="slice.name"><dt>Name</dt><dd>{{ slice.name }}</dd></template>
        <template v-if="actor"><dt>Actor</dt><dd>{{ actor }}</dd></template>
        <template v-if="slice.ui"><dt>Service</dt><dd>{{ slice.ui }}</dd></template>
        <template v-if="slice.polls"><dt>Polls</dt><dd>{{ slice.polls }}</dd></template>
        <template v-if="slice.reads?.length"><dt>Reads</dt><dd>{{ slice.reads.join(", ") }}</dd></template>
        <template v-if="slice.trigger">
          <dt>On</dt>
          <dd>{{ (Array.isArray(slice.trigger) ? slice.trigger : [slice.trigger]).map((t) => parse(t).name).join(", ") }}</dd>
        </template>
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
    </template>
  </aside>
</template>
