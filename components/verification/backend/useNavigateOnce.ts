import { useCallback, useRef } from "react";
import { type Href, useFocusEffect, useRouter } from "expo-router";

// ---------------------------------------------------------------------------
// Single-flight forward-navigation guard — shared by EVERY verification
// screen that does a forward router.push().
//
// Why this exists: rapid taps on a card/button each fired router.push() per
// tap (3 taps = 3 stacked copies of the same screen, so backing out had to
// pop 3 times). A ref (not state) flips synchronously on the FIRST tap, so
// taps 2..N in the same gesture are dropped before the navigation animation
// unmounts the screen.
//
// Why it works identically in dev AND preview builds: no timers, animation
// frames, or debounce delays drive the dedup — the synchronous ref check
// runs the same under Hermes in a minified preview bundle as under the dev
// client. The flag is re-armed on refocus (returning via back re-runs the
// focus effect) plus a fallback timeout so a failed push never dead-ends
// the button.
// ---------------------------------------------------------------------------

// How long before a push that never unmounted this screen (thrown error,
// focus event that never arrives) re-arms the button on its own.
const NAVIGATE_ONCE_FALLBACK_MS = 1500;

export default function useNavigateOnce() {
  const router = useRouter();
  const isNavigatingRef = useRef(false);

  // Re-arm every time this screen regains focus (back pop from the pushed
  // screen) so the button is tappable again exactly once per visit.
  useFocusEffect(
    useCallback(() => {
      isNavigatingRef.current = false;
      return undefined;
    }, []),
  );

  const navigateOnce = useCallback(
    (route: Href) => {
      if (isNavigatingRef.current) {
        return;
      }
      isNavigatingRef.current = true;
      // Fallback release — if the push throws (or the focus event never
      // arrives), re-arm after a short delay instead of leaving the button
      // permanently disabled.
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, NAVIGATE_ONCE_FALLBACK_MS);
      try {
        router.push(route);
      } catch {
        // Navigation must never crash the app — re-arm immediately so the
        // user can retry the tap.
        isNavigatingRef.current = false;
      }
    },
    [router],
  );

  return navigateOnce;
}
