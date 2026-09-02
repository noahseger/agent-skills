<script setup lang="ts">
import { type Box, BUTTON_H, FIELD_H, INPUT_H, TITLE_H } from "./layout.ts"

defineProps<{ box: Box }>()
defineEmits<{ link: [canonical: string] }>()

/** Column names that fit a wireframe table row, and how many were left out. */
function columns(all: string[]): { shown: string[]; more: number } {
  const shown = all.slice(0, 4)
  return { shown, more: all.length - shown.length }
}
</script>

<template>
  <g class="card" :class="[box.kind, { compact: box.compact }]" :transform="`translate(${box.x} ${box.y})`">
    <title v-if="box.canonical">Shown in full where it first appears</title>
    <rect class="shape" :width="box.w" :height="box.h" rx="8" />
    <text class="title" :x="12" :y="box.compact ? box.h / 2 + 4.5 : 20">{{ box.name }}</text>
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
        <text
          v-for="(col, i) in columns(box.table).shown"
          :key="col"
          class="col"
          :x="6 + i * ((box.w - 24) / columns(box.table).shown.length)"
          :y="11"
        >
          {{ col.length > 8 ? `${col.slice(0, 7)}…` : col }}
        </text>
        <template v-for="r in 2" :key="r">
          <line :x1="0" :x2="box.w - 24" :y1="16 + r * 14" :y2="16 + r * 14" />
          <rect
            v-for="(col, i) in columns(box.table).shown"
            :key="col"
            class="cell"
            :x="6 + i * ((box.w - 24) / columns(box.table).shown.length)"
            :y="16 + (r - 1) * 14 + 5"
            :width="(box.w - 24) / columns(box.table).shown.length - 14"
            height="4"
            rx="2"
          />
        </template>
        <text v-if="columns(box.table).more" class="more" text-anchor="end" :x="box.w - 26" :y="11">
          +{{ columns(box.table).more }}
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

    <g v-if="box.canonical" class="link" @click.stop="$emit('link', box.canonical)">
      <rect :x="box.w - 26" :y="box.h / 2 - 9" width="18" height="18" rx="4" />
      <text text-anchor="middle" :x="box.w - 17" :y="box.h / 2 + 4">↗</text>
    </g>
    <g v-if="box.noted" class="note-badge">
      <circle :cx="box.w - 1" :cy="1" r="6.5" />
      <text text-anchor="middle" :x="box.w - 1" :y="4">i</text>
    </g>
  </g>
</template>
