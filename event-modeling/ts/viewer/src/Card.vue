<script setup lang="ts">
import { computed } from "vue"
import { type Box, BUTTON_H, FIELD_H, INPUT_H, TITLE_H } from "./layout.ts"

const props = defineProps<{ box: Box }>()
defineEmits<{ link: [canonical: string]; pick: [] }>()

const LABEL: Record<Box["kind"], string> = {
  ui: "screen",
  external: "external event",
  command: "command",
  event: "event",
  readModel: "read model",
  automation: "automation",
}

/** A card with nothing under its name centres the name. */
const centred = computed(
  () =>
    props.box.compact ||
    (props.box.kind !== "ui" && props.box.fields.length === 0 && props.box.detail === undefined),
)
</script>

<template>
  <g
    class="card"
    :class="[box.kind, { compact: box.compact }]"
    :transform="`translate(${box.x} ${box.y})`"
    role="button"
    tabindex="0"
    :aria-label="`${LABEL[box.kind]} ${box.name}${box.noted ? ', has a note' : ''}`"
    @keydown.enter.stop="$emit('pick')"
  >
    <title v-if="box.canonical">Shown in full where it first appears</title>
    <rect class="shape" :width="box.w" :height="box.h" rx="8" />
    <text class="title" :x="12" :y="centred ? box.h / 2 + 4.5 : 20">{{ box.name }}</text>
    <text v-if="box.detail" class="detail" :x="12" :y="TITLE_H + 4">{{ box.detail }}</text>

    <!-- A screen is a wireframe: inputs, a button, a table. -->
    <template v-if="box.kind === 'ui' && !box.compact">
      <g
        v-for="(field, i) in box.form ?? []"
        :key="field"
        class="input"
        :transform="`translate(12 ${TITLE_H + (box.detail ? 14 : 0) + 2 + i * INPUT_H})`"
      >
        <rect :width="box.w - 24" :height="INPUT_H - 5" rx="4" />
        <text :x="7" :y="12">{{ field }}</text>
      </g>
      <g
        v-if="box.button"
        class="button"
        :transform="`translate(12 ${TITLE_H + (box.detail ? 14 : 0) + 4 + (box.form?.length ?? 0) * INPUT_H})`"
      >
        <rect :width="box.w - 24" :height="BUTTON_H - 8" rx="4" />
        <text text-anchor="middle" :x="(box.w - 24) / 2" :y="14">{{ box.button }}</text>
      </g>
      <g
        v-if="box.table"
        class="table"
        :transform="`translate(12 ${TITLE_H + (box.detail ? 14 : 0) + 4 + (box.form?.length ?? 0) * INPUT_H})`"
      >
        <rect class="head" :width="box.w - 24" :height="16" rx="3" />
        <text v-for="col in box.tableColumns ?? []" :key="col.name" class="col" :x="col.x + 6" :y="11">
          {{ col.name }}
        </text>
        <template v-for="r in 2" :key="r">
          <line :x1="0" :x2="box.w - 24" :y1="16 + r * 14" :y2="16 + r * 14" />
          <rect
            v-for="col in box.tableColumns ?? []"
            :key="col.name"
            class="cell"
            :x="col.x + 6"
            :y="16 + (r - 1) * 14 + 5"
            :width="Math.max(8, col.w - 14)"
            height="4"
            rx="2"
          />
        </template>
        <text v-if="box.tableMore" class="more" text-anchor="end" :x="box.w - 28" :y="11">
          +{{ box.tableMore }}
        </text>
      </g>
    </template>

    <template v-else>
      <template v-for="(field, i) in box.compact ? [] : box.fields" :key="field">
        <text
          class="field"
          :class="{ key: box.keys.includes(field) }"
          :x="12"
          :y="TITLE_H + (box.detail ? 14 : 0) + 6 + i * FIELD_H"
        >
          {{ field }}
        </text>
        <text
          v-if="box.keys.includes(field)"
          class="key-mark"
          text-anchor="end"
          :x="box.w - 12"
          :y="TITLE_H + (box.detail ? 14 : 0) + 6 + i * FIELD_H"
        >
          key
        </text>
      </template>
    </template>

    <g
      v-if="box.canonical"
      class="link"
      role="link"
      tabindex="0"
      aria-label="Go to where it is drawn in full"
      @click.stop="$emit('link', box.canonical)"
      @keydown.enter.stop="$emit('link', box.canonical)"
    >
      <title>Drawn in full where it first appears</title>
      <rect :x="box.w - 26" :y="box.h / 2 - 9" width="18" height="18" rx="4" />
      <text text-anchor="middle" :x="box.w - 17" :y="box.h / 2 + 4">↗</text>
    </g>
    <g v-if="box.noted" class="note-badge">
      <title>Has a note</title>
      <circle :cx="box.w - 1" :cy="1" r="6.5" />
      <text text-anchor="middle" :x="box.w - 1" :y="4">i</text>
    </g>
  </g>
</template>
