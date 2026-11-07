// A native-only route (RFC 0004, 7.3): there is no page.tsx next to this file, so /kit exists
// only in the app, on both OSes, with no web screen and no web fallback. A packing checklist is
// a device-side tool; the web site has no use for it. Built from @farm.js/ui, which Metro
// resolves to native views on a React Native screen.
import { useNavigate } from "@farm.js/native";
import { Image, List, PhotoPicker, Pressable, Text, TextInput, View } from "@farm.js/ui";
import { useState } from "react";
import Device from "../../../native/NativeDevice";

export const metadata = { title: "Field kit" };

const DEFAULT_KIT = ["Notebook", "Soil probe", "Water bottle"];

export default function KitScreen() {
  const navigate = useNavigate();
  const [items, setItems] = useState(DEFAULT_KIT);
  const [packed, setPacked] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // A file:// URI from the Device module, which Image loads as is on a native screen.
  const [photo, setPhoto] = useState<string>();
  const add = () => {
    const name = draft.trim();
    if (name && !items.includes(name)) setItems((current) => [...current, name]);
    setDraft("");
  };
  return (
    <View padding="md" gap="sm" grow>
      <Text size="lg" weight="semibold">
        Before you head out
      </Text>
      <Text color="muted">
        Native-only: a page.native.tsx with no page.tsx. The route exists only in the app.
      </Text>
      <View direction="row" gap="sm">
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder="Add gear"
          aria-label="Add gear"
          grow
        />
        <Pressable onPress={add} padding="sm" background="accent" radius="md" aria-label="add">
          <Text color="accentText" weight="semibold">
            Add
          </Text>
        </Pressable>
      </View>
      <List
        items={items}
        keyExtractor={(item) => item}
        row={(item) => ({
          title: item,
          badge: packed.includes(item) ? "packed" : undefined,
          onPress: () =>
            setPacked((current) =>
              current.includes(item)
                ? current.filter((name) => name !== item)
                : [...current, item],
            ),
        })}
        empty="Kit packed."
      />
      <Text color="muted" size="sm">
        {packed.length}/{items.length} packed
      </Text>
      {/* The same picker as the web /settings screen; here it calls the module directly. */}
      <PhotoPicker pick={() => Device.pickPhoto()} onPick={setPhoto} padding="sm" aria-label="kit photo">
        <Text color="accent">Photo of the kit</Text>
      </PhotoPicker>
      {photo ? <Image src={photo} alt="Your kit" height={160} radius="card" /> : null}
      <Pressable onPress={() => navigate("/notes")} padding="sm" aria-label="open notes">
        <Text color="accent">Open Notes (web screen)</Text>
      </Pressable>
    </View>
  );
}
