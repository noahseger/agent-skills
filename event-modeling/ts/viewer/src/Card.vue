<script setup lang="ts">
import { type Box, FIELD_H, TITLE_H } from "./layout.ts"

defineProps<{ box: Box }>()
</script>

<template>
  <g class="card" :class="box.kind" :transform="`translate(${box.x} ${box.y})`">
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
  </g>
</template>
