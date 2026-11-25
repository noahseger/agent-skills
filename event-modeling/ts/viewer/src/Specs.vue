<script setup lang="ts">
import { type Spec, shortIds, valueLines } from "./layout.ts"
import Name from "./Name.vue"

// Specifications as cards, the same in the slice's detail and in the opened slice.
defineProps<{
  specs: Spec[]
  /** The element whose cards are set apart: the one selected. */
  mark?: string
}>()
defineEmits<{ hover: [name: string | null] }>()

// A line is `field = value`, the value in its own column so it wraps under itself, a list of records
// one per line, a UUID by its first group with the whole as a tooltip; a rejection's is words. A
// described outcome, or the "no rows" or "nothing happens" of an empty then, is no element: a card's
// box with no name, in neutral colours, its sentence the content.
const field = (line: string) => line.split(" = ")[0] ?? line
const value = (line: string) => line.slice(field(line).length + 3)
</script>

<template>
  <div class="specs-grid">
    <article v-for="spec in specs" :key="spec.title" class="hspec">
      <h4>{{ spec.title }}</h4>
      <div v-for="step in spec.steps" :key="step.word" class="hstep">
        <span class="word">{{ step.word }}</span>
        <div class="hcards">
          <template v-for="(card, i) in step.cards" :key="i">
            <div v-if="card.kind === 'description'" class="hcard outcome">{{ card.lines.join(" ") }}</div>
            <div
              v-else
              class="hcard"
              :class="[card.kind, { mark: card.name === mark }]"
              @pointerenter="$emit('hover', card.name)"
              @pointerleave="$emit('hover', null)"
            >
              <div class="hname"><Name :name="card.name" :kind="card.kind" /></div>
              <template v-for="(line, li) in card.lines" :key="li">
                <div v-if="card.kind === 'error'" class="hsaid">{{ line }}</div>
                <div v-else class="hline">
                  <span class="k">{{ field(line) }}</span>
                  <span class="v"><span v-for="(item, ii) in valueLines(value(line))" :key="ii" :title="shortIds(item) === item ? undefined : item">{{ shortIds(item) }}</span></span>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </article>
  </div>
</template>
