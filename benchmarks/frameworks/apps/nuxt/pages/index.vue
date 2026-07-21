<script setup lang="ts">
import { benchmarkItems } from "../benchmark-data";

const renderedAt = useState("benchmark-rendered-at", () => Date.now());
const items = benchmarkItems;
</script>

<template>
  <main
    data-benchmark-marker="framework-benchmark-v1"
    :data-item-count="items.length"
    :data-rendered-at="renderedAt"
  >
    <header>
      <p>Dynamic SSR fixture</p>
      <h1>Framework benchmark fixture</h1>
      <time :datetime="new Date(renderedAt).toISOString()">{{ renderedAt }}</time>
    </header>
    <ul>
      <li v-for="item in items" :key="item.id">
        <span>{{ item.id }}</span
        ><strong>{{ item.label }}</strong>
      </li>
    </ul>
  </main>
</template>
