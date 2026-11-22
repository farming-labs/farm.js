<script>
  import { FARM_LINK_OPTION_KEYS, resolveLinkAttributes } from "@farm.js/core/renderer-client";

  /** @type {import("./link").FarmSvelteLinkProps} */
  let { children, ...props } = $props();

  const anchor = $derived.by(() => {
    /** @type {Record<string, unknown>} */
    const attributes = { ...props };
    for (const key of FARM_LINK_OPTION_KEYS) delete attributes[key];
    return attributes;
  });
  const link = $derived(resolveLinkAttributes(props));
</script>

<a {...anchor} {...link}>{@render children?.()}</a>
