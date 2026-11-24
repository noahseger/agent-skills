<script setup lang="ts">
import { computed } from "vue"
import { words } from "../../src/types.ts"
import Fit from "./Fit.vue"
import {
  type Box,
  BUTTON_H,
  FIELD_H,
  INPUT_H,
  KIND,
  TABLE_PAD,
  TITLE_H,
  TITLE_LINE,
  titleDrop,
} from "./layout.ts"
import Mark from "./Mark.vue"
import { measure } from "./measure.ts"

const props = defineProps<{ box: Box }>()
defineEmits<{ link: [canonical: string]; pick: [] }>()

/** A card with nothing under its name centres the name. */
const centred = computed(
  () =>
    props.box.compact ||
    (props.box.kind !== "ui" && props.box.fields.length === 0 && props.box.detail === undefined),
)
/** The room a key field leaves its `KEY` tag, and a gap before it. */
const keyW = measure("KEY", "tag") + 6
/** Where what is under the title starts. */
const top = computed(() => TITLE_H + titleDrop(props.box))
/** Where what is under the service line starts. */
const body = computed(() => top.value + (props.box.detail ? 14 : 0))
</script>

<template>
  <g
    class="card"
    :class="[box.kind, { compact: box.compact }]"
    :transform="`translate(${box.x} ${box.y})`"
    role="button"
    tabindex="0"
    :aria-label="`${KIND[box.kind]} ${words(box.name)}${box.notes ? ', has notes' : ''}${box.mark === 'error' ? ', has an error' : box.mark ? ', unfinished' : ''}`"
    @keydown.enter.stop="$emit('pick')"
  >
    <title v-if="box.canonical">Full details are on its first card</title>
    <rect class="shape" :width="box.w" :height="box.h" rx="8" />
    <text class="title" :y="centred ? (box.h - titleDrop(box)) / 2 + 4.5 : 20">
      <tspan v-for="(line, i) in box.title" :key="i" :x="12" :dy="i === 0 ? 0 : TITLE_LINE">{{ line }}</tspan>
    </text>
    <Fit v-if="box.detail" class="detail" :text="box.detail" :room="box.w - 24" font="detail" :x="12" :y="top + 4" />

    <!-- A screen is a wireframe: inputs, a button, a table. -->
    <template v-if="box.kind === 'ui' && !box.compact">
      <g
        v-for="(field, i) in box.form ?? []"
        :key="field"
        class="input"
        :transform="`translate(12 ${body + 2 + i * INPUT_H})`"
      >
        <rect :width="box.w - 24" :height="INPUT_H - 5" rx="4" />
        <Fit :text="field" :room="box.w - 38" font="input" :x="7" :y="12" />
      </g>
      <g
        v-if="box.button"
        class="button"
        :transform="`translate(12 ${body + 4 + (box.form?.length ?? 0) * INPUT_H})`"
      >
        <rect :width="box.w - 24" :height="BUTTON_H - 8" rx="4" />
        <Fit text-anchor="middle" :text="box.button" :room="box.w - 36" font="button" :x="(box.w - 24) / 2" :y="14" />
      </g>
      <g
        v-if="box.table"
        class="table"
        :transform="`translate(12 ${body + 4 + (box.form?.length ?? 0) * INPUT_H})`"
      >
        <rect class="head" :width="box.w - 24" :height="16" rx="3" />
        <Fit
          v-for="col in box.tableColumns ?? []"
          :key="col.name"
          class="col"
          :text="col.name"
          :room="col.w - TABLE_PAD"
          font="table"
          :x="col.x + 6"
          :y="11"
        />
        <template v-for="r in box.tableRows ?? 2" :key="r">
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
        <Fit
          class="field"
          :class="{ key: box.keys.includes(field) }"
          :text="field"
          :room="box.w - 24 - (box.keys.includes(field) ? keyW : 0)"
          :font="box.keys.includes(field) ? 'key' : 'field'"
          :x="12"
          :y="body + 6 + i * FIELD_H"
        />
        <text
          v-if="box.keys.includes(field)"
          class="key-mark"
          text-anchor="end"
          :x="box.w - 12"
          :y="body + 6 + i * FIELD_H"
        >
          KEY
        </text>
      </template>
    </template>

    <g
      v-if="box.canonical"
      class="link"
      role="link"
      tabindex="0"
      aria-label="Go to its first card"
      @click.stop="$emit('link', box.canonical)"
      @keydown.enter.stop="$emit('link', box.canonical)"
    >
      <title>Go to its first card</title>
      <rect :x="box.w - 26" :y="box.h / 2 - 9" width="18" height="18" rx="4" />
      <text text-anchor="middle" :x="box.w - 17" :y="box.h / 2 + 4">↗</text>
    </g>
    <Mark :mark="box.mark" :at="[1, 1]" />
  </g>
</template>
