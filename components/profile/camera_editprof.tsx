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
      Alert.alert(
        "Permission needed",
        "Please allow camera access to take a profile photo. You can also choose a photo from your library instead."
      );
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
  } catch (error) {
    // Never crash on camera launch. Surface the error so the user can fall
    // back to choosing from their library instead.
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "The camera could not be opened. Please choose a photo from your library instead.";
    Alert.alert("Camera error", message);
    return null;
  }
};

