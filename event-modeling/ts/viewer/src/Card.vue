<script setup lang="ts">
import { computed } from "vue"
import { words } from "../../src/types.ts"
import Fit from "./Fit.vue"
import {
  type Box,
  BUTTON_H,
  face,
  INPUT_H,
  KIND,
  markAt,
  PAD,
  TABLE_PAD,
  TITLE_LINE,
} from "./layout.ts"
import Mark from "./Mark.vue"
import { measure } from "./measure.ts"

const props = defineProps<{ box: Box }>()
defineEmits<{ link: [canonical: string]; pick: [] }>()

/** Where each line stands: the one rule that also sizes the card. */
const at = computed(() => face(props.box))
/** The room a key field leaves its `KEY` tag, and a gap before it. */
const keyW = measure("KEY", "tag") + 6
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
    <text class="title" :y="at.title">
      <tspan v-for="(line, i) in box.title" :key="i" :x="PAD" :dy="i === 0 ? 0 : TITLE_LINE">{{ line }}</tspan>
    </text>
    <Fit v-if="at.detail !== undefined" class="detail" :text="box.detail ?? ''" :room="box.w - 2 * PAD" font="detail" :x="PAD" :y="at.detail" />

    <!-- A screen is a wireframe: inputs, a button, a table. -->
    <g v-for="input in at.inputs" :key="input.y" class="input" :transform="`translate(${PAD} ${input.y})`">
      <rect :width="box.w - 2 * PAD" :height="INPUT_H - 5" rx="4" />
      <Fit :text="input.text" :room="box.w - 38" font="input" :x="7" :y="12" />
    </g>
    <g v-if="at.button !== undefined" class="button" :transform="`translate(${PAD} ${at.button})`">
      <rect :width="box.w - 2 * PAD" :height="BUTTON_H - 8" rx="4" />
      <Fit text-anchor="middle" :text="box.button ?? ''" :room="box.w - 36" font="button" :x="(box.w - 2 * PAD) / 2" :y="14" />
    </g>
    <g v-if="at.table !== undefined" class="table" :transform="`translate(${PAD} ${at.table})`">
      <rect class="head" :width="box.w - 2 * PAD" :height="16" rx="3" />
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
        <line :x1="0" :x2="box.w - 2 * PAD" :y1="16 + r * 14" :y2="16 + r * 14" />
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

    <template v-for="f in at.fields" :key="f.y">
      <Fit
        class="field"
        :class="{ key: box.keys.includes(f.text) }"
        :text="f.text"
        :room="box.w - 2 * PAD - (box.keys.includes(f.text) ? keyW : 0)"
        :font="box.keys.includes(f.text) ? 'key' : 'field'"
        :x="PAD"
        :y="f.y"
      />
      <text v-if="box.keys.includes(f.text)" class="key-mark" text-anchor="end" :x="box.w - PAD" :y="f.y">KEY</text>
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
    <Mark :mark="box.mark" :at="markAt(PAD + measure(box.title[0] ?? '', 'title'), at.title)" />
  </g>
</template>
