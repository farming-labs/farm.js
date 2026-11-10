import type { Metadata, PageProps } from "@farm.js/core";
import { List, Text, TextInput, View } from "@farm.js/ui";
import { REPORT_MAX, reportsFor } from "../../reports";
import { getTrail, trails } from "../../trails";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return { title: getTrail(String(params?.id))?.name ?? "Trail" };
}

// A dynamic route stays portable: params resolve on the server, so the analyzer keeps this on
// the native tier and the shell draws each trail as its own native screen. The report form is a
// plain HTML form: a browser submits it, and so does the native screen, with no JavaScript.
export default function TrailPage({ params, searchParams }: PageProps) {
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
  const reports = reportsFor(trail.id);
  return (
    <View padding="md" gap="sm">
      <Text as="h1" size="2xl" weight="bold">
        {trail.name}
      </Text>
      {/* A plain table: the shell draws it as native rows whose cells share the width. */}
      <table style={{ width: "100%", tableLayout: "fixed", fontSize: 14 }}>
        <thead>
          <tr style={{ color: "#6b7280" }}>
            <th>Region</th>
            <th>Distance</th>
            <th>Climb</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ textAlign: "center" }}>
            <td>{trail.region}</td>
            <td>{trail.km} km</td>
            <td>{trail.climb}</td>
          </tr>
        </tbody>
      </table>
      <View padding="md" background="surface" radius="card" gap="xs">
        <Text>{trail.notes}</Text>
      </View>
      <Text size="sm" weight="semibold" color="muted">
        Trail reports
      </Text>
      {reports.length === 0 ? <Text color="muted">No reports yet.</Text> : null}
      {reports.map((report, index) => (
        <View key={index} padding="sm" background="surface" radius="card" gap="xs">
          <Text weight="semibold">{report.name}</Text>
          <Text>{report.text}</Text>
        </View>
      ))}
      <form method="post" action="/api/reports" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input type="hidden" name="trail" value={trail.id} />
        <TextInput name="name" placeholder="Your name" padding="sm" radius="card" background="surface" />
        <textarea
          name="text"
          required
          maxLength={REPORT_MAX}
          placeholder="How was the trail?"
          style={{ padding: 8, borderRadius: 8, backgroundColor: "#f6f6f6" }}
        />
        {searchParams?.error === "empty" ? <Text color="#b91c1c">Write a report first.</Text> : null}
        <button type="submit" style={{ padding: 10, borderRadius: 8, backgroundColor: "#2f6f4f", color: "#ffffff" }}>
          Post report
        </button>
      </form>
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
