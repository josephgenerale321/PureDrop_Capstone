/**
 * ImmersiveNavBar — hides the Android system navigation bar (◁ ○ □) app-wide so
 * it never overlaps the floating tab bar on phones that use 3-button navigation.
 *
 * Mount it once in the root layout (`app/_layout.tsx`): that layout stays
 * mounted across every navigation, so the hidden state survives route changes.
 *
 * BEHAVIOUR (full policy lives in useImmersiveNavBar)
 * - Hidden from the first frame: `app.json` configures the expo-navigation-bar
 *   config plugin with `visibility: "hidden"`, which the native module applies
 *   while the Activity is created — before the JS engine starts.
 * - AUTO HIDE: when the user swipes the bar up (Android reveals it transiently
 *   for 3-button navigation) or the ROM restores it, it hides itself again after
 *   ~2.5s. If the device keeps forcing the bar back up the delay grows (5s, 10s)
 *   and the hook finally gives up instead of flicker-fighting — tune that with
 *   `escalateAfter`, `backoffFactor` and `maxAutoHides`.
 * - Re-applied whenever the app returns to the foreground.
 *
 * SAFETY: Android only. The native module is loaded lazily inside try/catch, so
 * iOS, web, Expo Go builds without the module, and Jest never crash — worst case
 * the bar simply stays visible.
 */
import {
  useImmersiveNavBar,
  type UseImmersiveNavBarOptions,
} from "./useImmersiveNavBar";

export type ImmersiveNavBarProps = UseImmersiveNavBarOptions;

export default function ImmersiveNavBar(props: ImmersiveNavBarProps) {
  useImmersiveNavBar(props);
  return null;
}