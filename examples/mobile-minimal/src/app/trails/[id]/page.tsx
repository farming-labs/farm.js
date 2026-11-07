import type { Metadata, PageProps } from "@farm.js/core";
import { List, Text, View } from "@farm.js/ui";
import { getTrail, trails } from "../../trails";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return { title: getTrail(String(params?.id))?.name ?? "Trail" };
}

// A dynamic route stays portable: params resolve on the server, so the analyzer keeps this on
// the native tier and the shell draws each trail as its own native screen.
export default function TrailPage({ params }: PageProps) {
  const trail = getTrail(String(params?.id));
  if (!trail) {
    return (
      <View padding="md" gap="sm">
        <Text as="h1" size="xl" weight="bold">
          Not found
        </Text>
        <Text color="muted">No trail with id {String(params?.id)}.</Text>
      </View>
    );
  }
  const others = trails.filter((other) => other.id !== trail.id);
  return (
    <View padding="md" gap="sm">
      <Text as="h1" size="2xl" weight="bold">
        {trail.name}
      </Text>
      <Text color="muted">
        {trail.region} · {trail.km} km · {trail.climb}
      </Text>
      <View padding="md" background="surface" radius="card" gap="xs">
        <Text>{trail.notes}</Text>
      </View>
      <Text size="sm" weight="semibold" color="muted">
        More trails
      </Text>
      <List
        items={others}
        keyExtractor={(other) => other.id}
        row={(other) => ({ title: other.name, subtitle: other.region, href: `/trails/${other.id}` })}
      />
    </View>
  );
}
