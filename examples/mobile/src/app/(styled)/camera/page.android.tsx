// The Android screen for /camera (module id app/camera): replaces page.native.tsx on Android only.
import { serverFetch, useNavigate, useServerQuery } from "@farm.js/native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

interface Note {
  id: string;
  title: string;
  updatedAt: string;
}

/** GET /api/notes on mobile.server: the same route the web notes form posts to. */
async function listNotes(): Promise<Note[]> {
  const response = await serverFetch("/api/notes");
  if (!response.ok) throw new Error(`GET /api/notes answered ${response.status}`);
  return (await response.json()) as Note[];
}

export const metadata = { title: "Camera roll" };

export default function AndroidCameraScreen() {
  const navigate = useNavigate();
  const { data: notes = [], error } = useServerQuery(listNotes, undefined);

  return (
    <View style={styles.screen} testID="camera-screen">
      <Text style={styles.lead}>
        page.android.tsx: a React Native screen on Android only. Notes to attach photos to:
      </Text>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      <FlatList
        data={notes}
        keyExtractor={(note) => note.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => navigate(`/notes/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.title}>{item.title}</Text>
          </Pressable>
        )}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => navigate("/notes/new")}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        testID="new-note"
      >
        <Text style={styles.buttonText}>New note (web modal)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f7f5" },
  lead: { padding: 16, color: "#55524c" },
  error: { paddingHorizontal: 16, color: "#b3261e" },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#d9d6cf",
    backgroundColor: "#ffffff",
  },
  pressed: { opacity: 0.6 },
  title: { fontSize: 17, color: "#1d1b18" },
  button: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#2f6b3f",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
