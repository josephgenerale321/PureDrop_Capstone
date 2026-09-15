import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyClsR7XWwvYHQtRfFQTiw9Ob41fMD9elbA",
  authDomain: "puredrop-capstone-project.firebaseapp.com",
  projectId: "puredrop-capstone-project",
  storageBucket: "puredrop-capstone-project.firebasestorage.app",
  messagingSenderId: "781886256531",
  appId: "1:781886256531:web:e50ab386d9a4453d95a466",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

export const db = (() => {
  try {
    // NOTE: the Firestore JS SDK has NO IndexedDB on React Native / Hermes,
    // so `persistentLocalCache()` always warns ("missing IndexedDB ... falling
    // back to memory cache") and buys nothing on native. It is deliberately
    // NOT used here. Offline fast-path lives in the AsyncStorage tier
    // (`components/main_layout/offline_profile_cache.ts` -> `getProfileFast`
    // `async-cache`, measured 27ms on 2nd boot): the 1st-boot 10-13s server
    // handshake is unavoidable, but every later boot resolves from disk.
    // `experimentalAutoDetectLongPolling` is kept: it shortens the cold
    // WebChannel handshake on emulator / Vivo-class networks.
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    return getFirestore(app);
  }
})();
