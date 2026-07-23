<script module lang="ts">
  const items = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1,
    label: `Benchmark item ${String(index + 1).padStart(3, "0")}`,
  }));
</script>

<script lang="ts">
  let { data } = $props();
</script>

<main
  data-benchmark-marker="framework-benchmark-v1"
  data-item-count={items.length}
  data-rendered-at={data.renderedAt}
>
  <header>
    <p>Dynamic SSR fixture</p>
    <h1>Framework benchmark fixture</h1>
    <time datetime={new Date(data.renderedAt).toISOString()}>{data.renderedAt}</time>
  </header>
  <ul>
    {#each items as item (item.id)}
      <li><span>{item.id}</span><strong>{item.label}</strong></li>
    {/each}
  </ul>
</main>
