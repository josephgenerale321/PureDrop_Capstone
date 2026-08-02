import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import SaveLoginSync from "../components/main_layout/save_loginfunc";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorContainer}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{error.message}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.85}>
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RootLayout() {
  return (
    <>
      <SaveLoginSync />
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#55A3F0",
    padding: 24,
  },
  errorTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  errorMessage: {
    color: "#0f172a",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: "center",
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: "#A8F0C6",
    borderRadius: 24,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 24,
  },
  retryText: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "600",
  },
});
