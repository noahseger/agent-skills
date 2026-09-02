<script setup lang="ts">
import { type Box, FIELD_H, TITLE_H } from "./layout.ts"

defineProps<{ box: Box }>()
defineEmits<{ link: [canonical: string] }>()
</script>

<template>
  <g class="card" :class="[box.kind, { compact: box.compact }]" :transform="`translate(${box.x} ${box.y})`">
    <title v-if="box.canonical">Shown in full where it first appears</title>
    <rect class="shape" :width="box.w" :height="box.h" rx="8" />
    <text class="title" :x="12" :y="box.compact ? box.h / 2 + 4.5 : 20">{{ box.name }}</text>
    <text v-if="box.detail" class="detail" :x="12" :y="TITLE_H + 4">{{ box.detail }}</text>
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
