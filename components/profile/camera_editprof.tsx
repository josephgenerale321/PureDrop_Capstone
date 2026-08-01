import * as ImagePicker from "expo-image-picker";
import { Alert, Platform } from "react-native";

export const takeProfilePhoto = async (): Promise<ImagePicker.ImagePickerAsset | null> => {
  if (Platform.OS === "web") {
    Alert.alert(
      "Not available",
      "Camera capture is not supported on web. Please choose from your library instead."
    );
    return null;
  }

  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access to take a profile photo.");
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) {
      return null;
    }

    return result.assets[0];
  } catch {
    Alert.alert("Camera error", "Unable to open the camera. Please try again.");
    return null;
  }
};

