import { useCallback, useEffect, useRef } from "react";
import {
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  TextInput,
} from "react-native";

export type RegisterFieldKey =
  | "fullName"
  | "email"
  | "password"
  | "confirmPassword"
  | "accountNumber";

const isMobile = Platform.OS !== "web";
const inputScrollOffset = 130;
const keyboardFollowDelayMs = 250;
const nextFieldByField: Partial<Record<RegisterFieldKey, RegisterFieldKey>> = {
  fullName: "email",
  email: "password",
  password: "confirmPassword",
  confirmPassword: "accountNumber",
};

export function useRegisterKeyboardScroll() {
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<Partial<Record<RegisterFieldKey, TextInput | null>>>({});
  const currentScrollYRef = useRef(0);
  const fieldYRef = useRef<Partial<Record<RegisterFieldKey, number>>>({});
  const activeFieldRef = useRef<RegisterFieldKey | null>(null);
  const returnYRef = useRef(0);
  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScrollTimeout = useCallback((): void => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, []);

  const registerInputRef = useCallback(
    (field: RegisterFieldKey) =>
      (input: TextInput | null): void => {
        inputRef.current[field] = input;
      },
    [],
  );

  const scrollActiveFieldAboveKeyboard = useCallback((): void => {
    const activeField = activeFieldRef.current;

    if (!activeField) {
      return;
    }

    const fieldY = fieldYRef.current[activeField] ?? 0;
    const targetY = Math.max(fieldY - inputScrollOffset, 0);

    scrollViewRef.current?.scrollTo({ y: targetY, animated: true });
  }, []);

  const followFocusedField = useCallback(
    (field: RegisterFieldKey): void => {
      if (!isMobile) {
        return;
      }

      const previousActiveField = activeFieldRef.current;

      if (!previousActiveField) {
        returnYRef.current = currentScrollYRef.current;
      }

      if (previousActiveField !== field) {
        activeFieldRef.current = field;
        userScrolledRef.current = false;
      }

      clearScrollTimeout();

      scrollTimeoutRef.current = setTimeout(() => {
        if (activeFieldRef.current === field && !userScrolledRef.current) {
          scrollActiveFieldAboveKeyboard();
        }
      }, keyboardFollowDelayMs);
    },
    [clearScrollTimeout, scrollActiveFieldAboveKeyboard],
  );

  const restoreScrollPosition = useCallback((): void => {
    clearScrollTimeout();

    if (!activeFieldRef.current) {
      return;
    }

    activeFieldRef.current = null;

    if (userScrolledRef.current) {
      userScrolledRef.current = false;
      return;
    }

    scrollViewRef.current?.scrollTo({
      y: returnYRef.current,
      animated: true,
    });
  }, [clearScrollTimeout]);

  const registerFieldLayout = useCallback(
    (field: RegisterFieldKey) =>
      (event: LayoutChangeEvent): void => {
        fieldYRef.current[field] = event.nativeEvent.layout.y;
      },
    [],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
      currentScrollYRef.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const handleScrollBeginDrag = useCallback((): void => {
    if (activeFieldRef.current) {
      userScrolledRef.current = true;
      clearScrollTimeout();
    }
  }, [clearScrollTimeout]);

  const focusNextField = useCallback((field: RegisterFieldKey): void => {
    const nextField = nextFieldByField[field];

    if (!nextField) {
      Keyboard.dismiss();
      return;
    }

    inputRef.current[nextField]?.focus();
  }, []);

  useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const keyboardShowSubscription = Keyboard.addListener("keyboardDidShow", () => {
      if (activeFieldRef.current && !userScrolledRef.current) {
        scrollActiveFieldAboveKeyboard();
      }
    });
    const keyboardHideSubscription = Keyboard.addListener(
      "keyboardDidHide",
      restoreScrollPosition,
    );

    return () => {
      keyboardShowSubscription.remove();
      keyboardHideSubscription.remove();
      clearScrollTimeout();
    };
  }, [clearScrollTimeout, restoreScrollPosition, scrollActiveFieldAboveKeyboard]);

  return {
    scrollViewRef,
    registerInputRef,
    registerFieldLayout,
    followFocusedField,
    focusNextField,
    handleScroll,
    handleScrollBeginDrag,
  };
}
