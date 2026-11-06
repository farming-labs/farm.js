// The React Native screen for /camera on iOS (module id app/camera). Android has its own file,
// page.android.tsx, which replaces this one there.
import { useNavigate } from "@farm.js/native";
import { Pressable, Text, View } from "react-native";

export const metadata = { title: "Camera" };

export default function CameraScreen() {
  const navigate = useNavigate();
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text>page.native.tsx: the /camera screen on iOS.</Text>
      <Pressable accessibilityRole="button" onPress={() => navigate("/notes")}>
        <Text>Open notes</Text>
      </Pressable>
    </View>
  );
}
