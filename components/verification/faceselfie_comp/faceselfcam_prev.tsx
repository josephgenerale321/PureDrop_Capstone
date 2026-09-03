import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

export type FaceSelfieCameraPreviewHandle = {
  /** Requests camera permission and starts the front-facing camera preview. */
  startCamera: () => Promise<void>;
};

type FaceSelfieCameraPreviewProps = {
  /** Called with the captured photo URI once a face photo is taken (mockup). */
  onCapture?: (uri: string) => void;
};

/**
 * Face selfie camera preview.
 *
 * Mockup stage — `startCamera` handles the camera permission flow and renders
 * the live front-facing camera. Capturing a photo is simulated for now; the
 * real face-scan backend will be wired up later.
 */
const FaceSelfieCameraPreview = forwardRef<
  FaceSelfieCameraPreviewHandle,
  FaceSelfieCameraPreviewProps
>(function FaceSelfieCameraPreview({ onCapture }, ref) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const startCamera = async () => {
    if (isStarting || permission?.granted) {
      return;
    }

    setIsStarting(true);
    try {
      const result = await requestPermission();

      if (!result.granted) {
        Alert.alert(
          "Camera Permission",
          "Camera access is required for face verification. Please enable it in your device settings.",
        );
      }
    } catch {
      Alert.alert("Error", "Unable to request camera permission.");
    } finally {
      setIsStarting(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      startCamera,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStarting, permission?.granted],
  );

  // Mockup capture — the real face scan flow will be wired up later.
  const handleCapture = async () => {
    if (isCapturing) {
      return;
    }

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
      });

      Alert.alert(
        "Mockup Capture",
        photo?.uri ?? "Face photo captured (mockup).",
      );

      if (photo?.uri) {
        onCapture?.(photo.uri);
      }
    } catch {
      Alert.alert("Error", "Failed to capture photo.");
    } finally {
      setIsCapturing(false);
    }
  };

  if (permission?.granted) {
    return (
      <View style={styles.previewFrame}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="front"
          enableTorch={false}
        />

        <TouchableOpacity
          style={styles.captureButton}
          onPress={handleCapture}
          disabled={isCapturing}
          activeOpacity={0.8}
        >
          {isCapturing ? (
            <ActivityIndicator size="small" color="#0EA5E9" />
          ) : (
            <View style={styles.captureButtonInner} />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.previewFrame}>
      <Ionicons name="person-circle-outline" size={110} color="#94A3B8" />
      <Text style={styles.previewText}>
        {permission && !permission.granted
          ? "Camera access is needed to scan your face"
          : "Press “Start Camera” to scan your face"}
      </Text>
    </View>
  );
});

export default FaceSelfieCameraPreview;

const styles = StyleSheet.create({
  previewFrame: {
    width: "85%",
    aspectRatio: 3 / 4,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "#0EA5E9",
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  previewText: {
    fontSize: 15,
    color: "#64748B",
    marginTop: 12,
    marginHorizontal: 16,
    textAlign: "center",
  },
  captureButton: {
    position: "absolute",
    bottom: 20,
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
  },
});

