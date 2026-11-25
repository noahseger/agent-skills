<script setup lang="ts">
import type { Mark, Pt } from "./layout.ts"

// An error is a red dot; a warning, a yellow one; done, nothing. In a drawing, `at` places it.
defineProps<{ mark?: Mark | undefined; at?: Pt }>()

const SAID: Record<Mark, string> = { error: "Has an error", warning: "Unfinished" }
</script>

<template>
  <circle v-if="mark && at" :class="`mark-${mark}`" :cx="at[0]" :cy="at[1]" r="4" role="img" :aria-label="SAID[mark]" />
  <span v-else-if="mark" :class="`mark-${mark}`" role="img" :aria-label="SAID[mark]"></span>
</template>
