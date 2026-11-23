<script setup lang="ts">
import type { Spec, SpecCard } from "./layout.ts"
import Name from "./Name.vue"

// Specifications as cards, the same in the slice's detail and in the opened slice.
defineProps<{
  specs: Spec[]
  /** The element whose cards are set apart: the one selected. */
  mark?: string
}>()
defineEmits<{ hover: [name: string | null] }>()

// A line is `field = value`, the value in its own column so it wraps under itself; a rejection's
// or a described outcome's is words.
const field = (line: string) => line.split(" = ")[0] ?? line
const value = (line: string) => line.slice(field(line).length + 3)
const said = (kind: SpecCard["kind"]) => kind === "error" || kind === "description"
</script>

<template>
  <div class="specs-grid">
    <article v-for="spec in specs" :key="spec.title" class="hspec">
      <h4>{{ spec.title }}</h4>
      <div v-for="step in spec.steps" :key="step.word" class="hstep">
        <span class="word">{{ step.word }}</span>
        <div class="hcards">
          <div
            v-for="(card, i) in step.cards"
            :key="i"
            class="hcard"
            :class="[card.kind, { mark: card.name === mark }]"
            @pointerenter="$emit('hover', card.name)"
            @pointerleave="$emit('hover', null)"
          >
            <div class="hname"><Name :name="card.name" :kind="card.kind" /></div>
            <template v-for="(line, li) in card.lines" :key="li">
              <div v-if="said(card.kind)" class="hsaid">{{ line }}</div>
              <div v-else class="hline">
                <span class="k">{{ field(line) }}</span>
                <span class="v">{{ value(line) }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
