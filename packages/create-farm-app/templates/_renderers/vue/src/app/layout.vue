<script lang="ts">
import type { Metadata } from "@farm.js/core";
import "./globals.css";
import "./vue.css";

export const metadata: Metadata = {
  title: "FARMJS Vue App",
  description: "A framework for product-integrated apps",
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
