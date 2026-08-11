<script>
  import {
    ErrorBoundary,
    Fragment,
    Suspense,
    createElement,
    getFarmSvelteChildren,
    isFarmSvelteElement,
    normalizeFarmSvelteProps,
  } from "../runtime";

  let { element } = $props();
</script>

{#snippet renderNode(value)}
  {#if Array.isArray(value)}
    {#each value as child}
      {@render renderNode(child)}
    {/each}
  {:else if isFarmSvelteElement(value)}
    {@const type = value.type}
    {@const childNodes = getFarmSvelteChildren(value)}
    {#if type === Fragment || type === Suspense}
      {#each childNodes as child}
        {@render renderNode(child)}
      {/each}
    {:else if type === ErrorBoundary}
      {@const boundaryProps = value.props || {}}
      <svelte:boundary>
        {#each childNodes as child}
          {@render renderNode(child)}
        {/each}
        {#snippet failed(error, reset)}
          {@render renderNode(createElement(boundaryProps.Fallback, {
            ...(boundaryProps.fallbackProps || {}),
            error,
            reset,
          }))}
        {/snippet}
      </svelte:boundary>
    {:else if typeof type === "string"}
      {@const props = normalizeFarmSvelteProps(value)}
      <svelte:element this={type} {...props}>
        {#each childNodes as child}
          {@render renderNode(child)}
        {/each}
      </svelte:element>
    {:else}
      {@const Component = type}
      {@const props = normalizeFarmSvelteProps(value)}
      {#if childNodes.length > 0}
        <Component {...props}>
          {#each childNodes as child}
            {@render renderNode(child)}
          {/each}
        </Component>
      {:else}
        <Component {...props} />
      {/if}
    {/if}
  {:else if value !== null && value !== undefined && value !== false && value !== true}
    {value}
  {/if}
{/snippet}

{@render renderNode(element)}
