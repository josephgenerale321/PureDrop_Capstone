export type ResizedImage = {
  uri: string;
  mimeType: string;
};

/**
 * Image resizing is handled by the image picker's built-in
 * `quality` + `allowsEditing` + `aspect: [1, 1]` options
 * (see profileview.tsx). This helper is kept as a stable,
 * dependency-free pass-through so the upload pipeline can
 * safely call it on every platform without crashing.
 */
export const resizeProfileImage = async (
  uri: string,
  mimeType?: string | null
): Promise<ResizedImage> => {
  return { uri, mimeType: mimeType || "image/jpeg" };
};

