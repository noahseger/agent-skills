<script setup lang="ts">
import type { NoteKind } from "../../src/types.ts"
import { MARK_R, type Mark, type Pt } from "./layout.ts"

// One badge for whatever is said about an element: a solid circle in its note's colour (an error a
// critical note's, a warning a question note's), a note's with its letter in white. In a drawing, `at`
// is its centre; in a page it stands in a box one line tall, so it centres on the line it starts.
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
// The letter's baseline: its 8px glyph's cap height (0.72 em) centred on the circle's.
const GLYPH_Y = (8 * 0.72) / 2
</script>

<template>
  <g v-if="mark && at" class="badge" :class="mark" :transform="`translate(${at[0]} ${at[1]})`" role="img" :aria-label="SAID[mark]">
    <circle :r="R" />
    <text v-if="LETTER[mark]" text-anchor="middle" :y="GLYPH_Y">{{ LETTER[mark] }}</text>
  </g>
  <span v-else-if="mark" class="badge-line"><svg class="badge" :class="mark" :viewBox="`${-R} ${-R} ${2 * R} ${2 * R}`" :width="2 * R" :height="2 * R" role="img" :aria-label="SAID[mark]">
    <circle :r="R" />
    <text v-if="LETTER[mark]" text-anchor="middle" :y="GLYPH_Y">{{ LETTER[mark] }}</text>
  </svg></span>
</template>
