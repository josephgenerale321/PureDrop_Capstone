import { useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { FlashList } from "@shopify/flash-list";

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
  "Ibo",
  "Ilihan",
  "Landahan",
  "Loay",
  "Luray II",
  "Juan Climaco, Sr. (formerly Malubog)",
  "Magdugo",
  "Matab-ang",
  "Media Once",
  "Pangamihan",
  "Pandong Bato",
  "Poog",
  "Putingbato",
  "Sam-ang",
  "Sangi",
  "Santo Ni�o",
  "Subayon",
  "Tancor",
  "Tubod",
  "General Climaco",
  "Poblacion",
];

type LightboxCreateReportProps = {
  selectedAddress: string;
  visible: boolean;
  onClose: () => void;
  onSelectAddress: (value: string) => void;
};

const getBaseBarangay = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const suffixIndex = trimmed.toLowerCase().indexOf(CITY_SUFFIX.toLowerCase());
  if (suffixIndex >= 0) {
    return trimmed.slice(0, suffixIndex).replace(/,\s*$/, "").trim();
  }

  return trimmed;
};

export function LightboxCreateReport({
  selectedAddress,
  visible,
  onClose,
  onSelectAddress,
}: LightboxCreateReportProps) {
const selectedBarangay = getBaseBarangay(selectedAddress);
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredBarangays = normalizedQuery
    ? BARANGAYS.filter((barangay) =>
        barangay.toLowerCase().includes(normalizedQuery)
      )
    : BARANGAYS;

  const handlePick = (barangay: string) => {
    onSelectAddress(`${barangay}${CITY_SUFFIX}`);
    onClose();
  };

  const handleClear = () => {
    onSelectAddress("");
    onClose();
  };

return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.lightbox}>
          <Text style={styles.title}>Select Barangay</Text>
          <Text style={styles.subtitle}>Toledo City only</Text>

          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search barangay..."
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Search barangay"
          />

          <FlashList
            data={filteredBarangays}
            keyExtractor={(item) => item}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            renderItem={({ item }) => {
              const isSelected = item === selectedBarangay;

              return (
                <TouchableOpacity
                  style={[styles.item, isSelected && styles.itemSelected]}
                  onPress={() => handlePick(item)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.itemText, isSelected && styles.itemTextSelected]}>{item}</Text>
                </TouchableOpacity>
              );
            }}
          />

          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleClear}>
              <Text style={styles.actionText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={onClose}>
              <Text style={styles.actionText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  lightbox: {
    maxHeight: "90%",
    width: "100%",
    maxWidth: 520,
    minHeight: 420,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    padding: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 2,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "center",
    marginBottom: 12,
  },
  searchInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#0f172a",
    marginBottom: 12,
  },
  list: {
    flex: 1,
    minHeight: 240,
  },
  listContent: {
    paddingBottom: 8,
    paddingTop: 2,
  },
  item: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  itemSelected: {
    borderColor: "#0284c7",
    backgroundColor: "#f0f9ff",
  },
  itemText: {
    color: "#475569",
    fontSize: 14,
  },
  itemTextSelected: {
    fontWeight: "700",
    color: "#0284c7",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 8,
  },
  actionButton: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
  },
  actionText: {
    color: "#475569",
    fontWeight: "600",
    fontSize: 13,
  },
});
