import { useCallback, useState } from "react";
import { Alert, BackHandler, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { getVerificationLaterOutcome } from "../../../login/backend/postEmailVerificationGate";
import { performLogout } from "../../../../lib/auth/performLogout";
import { START_ROUTE } from "../verificationmainroutes";

export interface VerificationMainBack {
  isBackConfirmOpen: boolean;
  isLoggingOut: boolean;
  handleBack: () => void;
  handleStayBack: () => void;
  handleConfirmBack: () => Promise<void>;
  handleLogout: () => Promise<void>;
}

// Back navigation for the verification hub — extracted verbatim from
// VerificationMainScreen. A single back press opens the lightbox; the user
// makes an explicit choice there.
//
// NOTE: deliberately NO clear of the "continue later" marker on mount.
export default function useVerificationMainBack(): VerificationMainBack {
  const router = useRouter();
  // Lightbox confirmation for the back action — opened by both the on-screen
  // arrow and the Android hardware back button.
  const [isBackConfirmOpen, setIsBackConfirmOpen] = useState(false);
  // Guard against double taps while the shared logout sequence runs.
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // A single back press opens the lightbox; the user makes an explicit
  // choice there. Returns true because the press is always consumed (used
  // to consume Android hardware back events).
  //
  // For rejected users, the lightbox still opens but both buttons explain why
  // leaving is blocked: STAY returns to the hub, and LATER shows a
  // "Re-verification required" alert since getVerificationLaterOutcome()
  // refuses to write the marker for a rejected account. The only way out is
  // to resubmit via the Face Recognition / Verify your id cards.
  const attemptBack = useCallback((): boolean => {
    setIsBackConfirmOpen(true);
    return true;
  }, []);

  // Android hardware back opens the same lightbox; while it is open,
  // hardware back just dismisses it. Active only while this screen is
  // focused, so back navigation from nested screens keeps working.
  // (The forward-navigation guard re-arms itself on refocus inside
  // useNavigateOnce — on return via back pop its focus effect re-runs and
  // clears the flag, so the cards are tappable again exactly once per visit
  // with no timers or animation-frame races to differ between builds.)
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") {
        return undefined;
      }

      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (isBackConfirmOpen) {
            setIsBackConfirmOpen(false);
            return true;
          }
          return attemptBack();
        }
      );

      return () => {
        subscription.remove();
      };
    }, [attemptBack, isBackConfirmOpen])
  );

  const handleBack = () => {
    attemptBack();
  };

  // [ STAY ] — close the lightbox and stay on this screen.
  const handleStayBack = () => {
    setIsBackConfirmOpen(false);
  };


  // [ GO BACK ] — leave for the start screen ("continue verification later").
  // Records the "later" choice — PERSISTED across app restarts: the auto-
  // redirect sync (SaveLoginSync) then leaves the user on index/start/
  // login/register instead of bouncing them back into this screen, whether
  // both steps are submitted or not. The marker is cleared once the admin
  // verifies the account (or re-recorded if they back out again).
  //
  // AWAITED (never fire-and-forget): SaveLoginSync + the realtime decision
  // watcher re-run the moment the route changes, so navigating before this
  // write lands made them read a stale "no later choice" and bounce
  // straight back into this hub — the "Later goes back to verificationmain"
  // loop.
  //
  // Rejected accounts can NEVER use this marker: getVerificationLaterOutcome()
  // refuses to write while the account's live verificationStatus is
  // "rejected", and reports whether the account was EVER previously verified
  // (via the verifiedAt timestamp the admin panel writes on every approval)
  // so the right wording is shown:
  //   - first-time rejection (no verifiedAt): "Your verification was
  //     rejected. Please resubmit your ID to continue."
  //   - was-verified-then-rejected (verifiedAt exists): "Re-verification
  //     required — your account was approved before but has been rejected.
  //     Finish re-verifying to continue."
  //   - error (doc read / storage failed): same as rejected — keep the user
  //     in the verification flow, the safe default.
  //
  // SINGLE replace() (never dismissAll()+replace back-to-back): the two
  // calls race — dismissAll() unmounts this screen mid-flight, so the
  // replace() never runs and the hub stays put ("Later goes back to
  // verificationmain"). replace() alone swaps this hub for /start in place,
  // keeping index underneath — so the NEXT back press from /start exits to
  // the welcome screen instead of popping back into the hub.
  const handleConfirmBack = async () => {
    setIsBackConfirmOpen(false);

    const outcome = await getVerificationLaterOutcome();
    if (outcome.kind !== "allowed") {
      // Rejected (or error — treat as rejected, the safe default).
      const wasPreviouslyVerified =
        outcome.kind === "rejected" && outcome.wasPreviouslyVerified;
      Alert.alert(
        "Re-verification required",
        wasPreviouslyVerified
          ? "Your account was approved before but has been rejected. Finish re-verifying before leaving this screen."
          : "Your verification was rejected. Please resubmit your ID to continue.",
        [{ text: "OK" }]
      );
      return;
    }

    try {
      router.replace(START_ROUTE);
    } catch {
      // Navigation must never crash the app.
    }
  };

  // [ LOG OUT ] — the only exit for an EXISTING user that was approved before
  // and re-rejected later: getVerificationLaterOutcome() refuses the "later"
  // marker for ANY rejected account (so LATER is a dead end for them), and the
  // regular_user layout is fail-closed for rejected accounts, making even the
  // sign-out modal unreachable. This runs the FULL shared logout sequence
  // (presence, saved login, caches, push token, notification state, "later"
  // marker, Firebase signOut) and lands on /start ("Let's get started") where
  // the user can sign in with a different account.
  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsBackConfirmOpen(false);
    setIsLoggingOut(true);
    try {
      await performLogout(router, START_ROUTE);
    } finally {
      // performLogout releases the module-level logout flag itself on
      // failure; this only clears this hook's UI guard.
      setIsLoggingOut(false);
    }
  };

  return { isBackConfirmOpen, isLoggingOut, handleBack, handleStayBack, handleConfirmBack, handleLogout };
}