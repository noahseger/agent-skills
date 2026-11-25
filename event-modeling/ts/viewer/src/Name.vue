<script setup lang="ts">
import { words } from "../../src/types.ts"
import type { Kind } from "./layout.ts"

// An element's name as the viewer shows it everywhere: as words, bold. One that goes somewhere when
// clicked is a link, the same everywhere; one that does not is in its kind's ink, never a link's.
defineProps<{ name: string; kind?: Kind | "error" | "description"; link?: boolean }>()
</script>

<template>
  <button v-if="link" type="button" class="named link">{{ words(name) }}</button>
  <strong v-else class="named" :class="kind">{{ words(name) }}</strong>
</template>
