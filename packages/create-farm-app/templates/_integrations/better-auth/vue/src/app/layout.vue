<script lang="ts">
import type { Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS Vue Better Auth Starter",
  description: "Better Auth with FARMJS and Vue",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};
</script>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <slot />
</template>
