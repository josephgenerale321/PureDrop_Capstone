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
    const normalized = normalizeAddress(selectedAddress);
    setSelectedAddress(normalized);
    router.back();
  };

  const cancelSelection = (): void => {
    const normalizedCurrentAddress = normalizeAddress(currentAddress);
    setSelectedAddress(normalizedCurrentAddress);
    router.back();
  };

  return (
    <View style={styles.screen}>
      <Pressable style={styles.backdrop} onPress={cancelSelection} />

      <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Select Barangay</Text>
            <Text style={styles.subtitle}>Toledo City only</Text>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search barangay"
            placeholderTextColor="#94a3b8"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
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
            style={styles.list}
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
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    maxHeight: "90%",
    width: "100%",
    maxWidth: 480,
    minHeight: 420,
    alignSelf: "center",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    marginBottom: 12,
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 2,
    textAlign: "center",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },
  list: {
    flex: 1,
    minHeight: 220,
  },
  listContent: {
    paddingBottom: 8,
    paddingTop: 2,
  },
  itemButton: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 0,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
    minHeight: 48,
    justifyContent: "center",
  },
  itemText: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 20,
  },
  cancelButton: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  cancelText: {
    textAlign: "center",
    color: "#475569",
    fontWeight: "600",
  },
});
