import type { FarmMobilePageConfig } from "@farm.js/core/mobile";
import { List, Text, View } from "@farm.js/ui";
import { trails } from "./trails";

// Requires the native tier: on mobile this page is a `server` screen — the server renders it and
// the shell draws it with native views, no JavaScript on the device. If an edit ever makes the
// page unportable, the build fails and names the exact blocker instead of quietly going web.
export const mobile = { native: true } satisfies FarmMobilePageConfig;

export default function TrailsPage() {
  return (
    <View padding="md" gap="sm">
      <Text as="h1" size="2xl" weight="bold">
        Trail Guide
      </Text>
      <Text color="muted">
        One page.tsx, portable components, no native code. On the web this is HTML; in the app it
        is native views.
      </Text>
      <List
        items={trails}
        keyExtractor={(trail) => trail.id}
        row={(trail) => ({
          title: trail.name,
          subtitle: `${trail.region} · ${trail.km} km · ${trail.climb}`,
          href: `/trails/${trail.id}`,
        })}
      />
    </View>
  );
}
