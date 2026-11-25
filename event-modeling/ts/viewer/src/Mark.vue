<script setup lang="ts">
import type { NoteKind } from "../../src/types.ts"
import { MARK_R, type Mark, type Pt } from "./layout.ts"

// One badge for whatever is said about an element: a model issue (error, warning) is a plain circle,
// a note (critical, question, info) the same circle with its letter. Its fill and line are its note's:
// an error a critical note's, a warning a question note's. In a drawing, `at` is its centre.
defineProps<{ mark?: Mark | NoteKind | undefined; at?: Pt }>()

const LETTER: Partial<Record<Mark | NoteKind, string>> = { critical: "!", question: "?", info: "i" }
const SAID: Record<Mark | NoteKind, string> = {
  error: "Has an error",
  warning: "Unfinished",
  critical: "Critical note",
  question: "Question",
  info: "Note",
}
const R = MARK_R
</script>

<template>
  <g v-if="mark && at" class="badge" :class="mark" :transform="`translate(${at[0]} ${at[1]})`" role="img" :aria-label="SAID[mark]">
    <circle :r="R - 0.5" />
    <text v-if="LETTER[mark]" text-anchor="middle" dominant-baseline="central">{{ LETTER[mark] }}</text>
  </g>
  <svg v-else-if="mark" class="badge" :class="mark" :viewBox="`${-R} ${-R} ${2 * R} ${2 * R}`" :width="2 * R" :height="2 * R" role="img" :aria-label="SAID[mark]">
    <circle :r="R - 0.5" />
    <text v-if="LETTER[mark]" text-anchor="middle" dominant-baseline="central">{{ LETTER[mark] }}</text>
  </svg>
</template>
