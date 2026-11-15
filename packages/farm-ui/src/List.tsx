import type { CSSProperties, ReactNode } from "react";

import { Image } from "./Image";
import { Pressable } from "./Pressable";
import { Text } from "./Text";
import { View } from "./View";

/** A row template. The same shape renders as a DOM row or a native cell. */
export interface ListRow {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading image URL. */
  image?: string;
  /** Trailing content (a count, a chevron, a badge). */
  badge?: ReactNode;
  /** When set, the whole row is a link to this URL. */
  href?: string;
  onPress?: () => void;
}

export interface ListProps<T> {
  items: readonly T[];
  /** Map an item to its row template. */
  row: (item: T, index: number) => ListRow;
  keyExtractor?: (item: T, index: number) => string | number;
  /** Shown when `items` is empty. */
  empty?: ReactNode;
  /** Reserved for native pull-to-refresh. No effect yet, on the web or on native screens. */
  refreshable?: boolean;
  /** Reserved for a native search bar. No effect yet, on the web or on native screens. */
  searchable?: boolean;
  className?: string;
}

const UL: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
};

function Row({ row }: { row: ListRow }) {
  const content = (
    <View direction="row" align="center" gap="md" paddingX="md" paddingY="sm">
      {row.image != null ? <Image src={row.image} width={40} height={40} radius="md" /> : null}
      <View flex={1} gap="xs">
        <Text weight="semibold">{row.title}</Text>
        {row.subtitle != null ? (
          <Text size="sm" color="muted">
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {row.badge != null ? <View>{row.badge}</View> : null}
    </View>
  );
  if (row.href != null || row.onPress != null) {
    return (
      <Pressable href={row.href} onPress={row.onPress}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/**
 * A list rendered from data and a row template, so the same call renders as
 * `<ul>` rows on the web and as a recycling native list on a native screen.
 */
export function List<T>({ items, row, keyExtractor, empty, className }: ListProps<T>) {
  if (items.length === 0 && empty != null) {
    return <View className={className}>{empty}</View>;
  }
  return (
    <ul className={className} style={UL}>
      {items.map((item, index) => (
        <li key={keyExtractor ? keyExtractor(item, index) : index}>
          <Row row={row(item, index)} />
        </li>
      ))}
    </ul>
  );
}
