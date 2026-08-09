import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { setSelectedAddress } from "../../lib/login/addressSelectionStore";

const CITY_SUFFIX = ", Toledo City";

const BARANGAYS: string[] = [
  "Awihao",
  "Bagakay",
  "Bato",
  "Biga",
  "Bulongan",
  "Bunga",
  "Cabitoonan",
  "Calongcalong",
  "Cambang-ug",
  "Camp 8",
  "Canlumampao",
  "Cantabaco",
  "Capitan Claudio",
  "Carmen",
  "Daanglungsod",
  "Don Andres Soriano (Lutopan)",
  "Dumlog",
  "General Climaco",
  "Ibo",
  "Ilihan",
  "Juan Climaco, Sr. (formerly Malubog)",
  "Landahan",
  "Loay",
  "Luray II",
  "Magdugo",
  "Matab-ang",
  "Media Once",
  "Pangamihan",
  "Pandong Bato",
  "Poblacion",
  "Poog",
  "Putingbato",
  "Sam-ang",
  "Sangi",
  "Santo Ni\u00f1o",
  "Subayon",
  "Tancor",
  "Tubod",
];

const normalizeAddress = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.toLowerCase().endsWith(CITY_SUFFIX.toLowerCase())) {
    return trimmed;
  }

  return `${trimmed}${CITY_SUFFIX}`;
};

export default function AddressSelectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ currentAddress?: string }>();
  const [query, setQuery] = useState<string>("");

  const currentAddress =
    typeof params.currentAddress === "string" ? params.currentAddress : "";

  const filteredBarangays = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return BARANGAYS;
    }

    return BARANGAYS.filter((item) =>
      item.toLowerCase().includes(normalized),
    );
  }, [query]);

  const selectAddress = (selectedAddress: string): void => {
    setSelectedAddress(normalizeAddress(selectedAddress));
    router.back();
  };

  const cancelSelection = (): void => {
    setSelectedAddress(currentAddress);
    router.back();
  };

  return (
    <View style={styles.screen}>
      <Pressable style={styles.backdrop} onPress={cancelSelection} />

      <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
        <View style={styles.sheet}>
          <Text style={styles.title}>Select Address</Text>

          <TextInput
            style={styles.searchInput}
            placeholder="Search barangay"
            value={query}
            onChangeText={setQuery}
          />

<FlashList
            data={filteredBarangays}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.itemButton}
                onPress={() => selectAddress(item)}
              >
                <Text style={styles.itemText}>{item}</Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          />

          <TouchableOpacity style={styles.cancelButton} onPress={cancelSelection}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5, 22, 38, 0.45)",
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 16,
    maxHeight: "88%",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
    color: "#0f172a",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  listContent: {
    paddingBottom: 8,
  },
  itemButton: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
  },
  itemText: {
    color: "#334155",
  },
  cancelButton: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
  },
  cancelText: {
    textAlign: "center",
    color: "#475569",
    fontWeight: "600",
  },
});
