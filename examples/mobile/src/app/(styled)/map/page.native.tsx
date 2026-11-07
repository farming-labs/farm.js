// The React Native screen for /map (module id app/map) on Android and iOS. Web builds never read
// this file: it is not a route, not in the generated route types, and not in any web bundle.
import { useNavigate, useServerQuery } from "@farm.js/native";
import { useNetInfo } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { apiClient } from "../../../lib/api";
import Device from "../../../native/NativeDevice";

/** GET /api/stations: the typed call the web makes, sent to mobile.server with the device session. */
async function listStations() {
  const { data, error } = await apiClient.stations.get();
  if (error) throw error;
  return data;
}

export const metadata = { title: "Map" };

export default function MapScreen() {
  const navigate = useNavigate();
  // A community native module, linked into the Android app from the app's dependencies.
  const network = useNetInfo();
  // The app's own native module (src/native/NativeDevice.ts and DeviceModule.kt).
  const [model, setModel] = useState("...");
  const [vibrateError, setVibrateError] = useState<string>();
  useEffect(() => {
    Device.model().then(setModel, (error: Error) => setModel(`unavailable (${error.message})`));
  }, []);
  const { data: stations = [], error, refetch } = useServerQuery(listStations, undefined);
  // `pending` is true only for the first load, so pull-to-refresh tracks its own state.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    refetch()
      .catch(() => {}) // the failure shows through `error`
      .finally(() => setRefreshing(false));
  };

  return (
    <View style={styles.screen} testID="map-screen">
      <Text style={styles.lead}>Native screen. Stations come from GET /api/stations.</Text>
      <Text style={styles.network} testID="network-status">
        Network: {network.type}, connected:{" "}
        {network.isConnected === null ? "unknown" : String(network.isConnected)}
      </Text>
      <View style={styles.device}>
        <Text style={styles.deviceText} testID="device-model">
          Device: {model}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setVibrateError(undefined);
            Device.vibrate(200).catch((error: Error) => setVibrateError(error.message));
          }}
          style={({ pressed }) => [styles.vibrate, pressed && styles.pressed]}
          testID="vibrate"
        >
          <Text style={styles.vibrateText}>Vibrate</Text>
        </Pressable>
      </View>
      {vibrateError ? <Text style={styles.error}>{vibrateError}</Text> : null}
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      <FlatList
        data={stations}
        keyExtractor={(station) => station.id}
        refreshing={refreshing}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="link"
            onPress={() => navigate(`/stations/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`station-${item.id}`}
          >
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.subtitle}>{item.elevationM} m</Text>
          </Pressable>
        )}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => navigate("/about")}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        testID="open-about"
      >
        <Text style={styles.buttonText}>About this app (web screen)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f7f5" },
  lead: { padding: 16, color: "#55524c" },
  network: { paddingHorizontal: 16, paddingBottom: 12, color: "#55524c" },
  device: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  deviceText: { flex: 1, color: "#55524c" },
  vibrate: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2f6b3f",
  },
  vibrateText: { color: "#2f6b3f", fontWeight: "600" },
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
  subtitle: { marginTop: 2, color: "#6b6760" },
  button: {
    margin: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#2f6b3f",
  },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
