import { useCallback, useRef } from "react";

/**
 * Window (in milliseconds) within which a second hardware back press is
 * considered a deliberate "double press to exit".
 */
const DOUBLE_PRESS_WINDOW_MS = 2000;

/**
 * Pure double-press-to-exit timing logic. No React Native imports, so this
 * module is safe to import on any platform (Android, iOS, web, preview).
 *
 * - First `registerPress()` returns `false` → caller should show a hint toast.
 * - A second `registerPress()` within the window returns `true` → caller
 *   should exit the app.
 */
export function useHomeExitBehavior() {
  const lastPressRef = useRef<number>(0);

  const registerPress = useCallback((): boolean => {
    const now = Date.now();

    if (now - lastPressRef.current <= DOUBLE_PRESS_WINDOW_MS) {
      // Second press inside the window — this is the "exit" press.
      lastPressRef.current = 0;
      return true;
    }

    // First press (or previous press was too long ago) — only a hint.
    lastPressRef.current = now;
    return false;
  }, []);

  const reset = useCallback(() => {
    lastPressRef.current = 0;
  }, []);

  return { registerPress, reset };
}

