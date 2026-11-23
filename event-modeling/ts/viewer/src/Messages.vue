<script setup lang="ts">
import { computed } from "vue"
import type { Message } from "../../src/types.ts"
import { type Box, grouped, KIND, wording } from "./layout.ts"
import Mark from "./Mark.vue"
import Name from "./Name.vue"

// What is wrong or unfinished, under the element each message is about.
const props = defineProps<{ messages: Message[]; boxes: Box[] }>()
const groups = computed(() => grouped(props.messages, props.boxes))
</script>

<template>
  <section v-if="groups.length" aria-label="What is left to do">
    <div v-for="g in groups" :key="g.element" class="about">
      <div v-if="g.element" class="element">
        <span v-if="g.kind" class="kind" :class="g.kind">{{ KIND[g.kind] }}</span>
        <Name :name="g.element" :kind="g.kind" />
      </div>
      <p v-for="m in g.messages" :key="m.message" class="message">
        <Mark :mark="m.kind" />
        <span><template v-for="(part, i) in wording(m)" :key="i"><b v-if="part.field">{{ part.text }}</b><template v-else>{{ part.text }}</template></template></span>
      </p>
    </div>
  </section>
</template>
