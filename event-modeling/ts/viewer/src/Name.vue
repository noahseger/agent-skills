<script setup lang="ts">
import { words } from "../../src/types.ts"
import type { Kind } from "./layout.ts"

// An element's name as the viewer shows it everywhere: as words, bold, in its kind's ink.
defineProps<{ name: string; kind?: Kind | "error" | "description" }>()
</script>

<template>
  <strong class="named" :class="kind">{{ words(name) }}</strong>
</template>
