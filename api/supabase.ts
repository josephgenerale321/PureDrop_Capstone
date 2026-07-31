import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

const MISSING_SUPABASE_CONFIG_MESSAGE =
  "Missing Supabase config. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (or EXPO_PUBLIC_SUPABASE_KEY) in the EAS preview environment, then rebuild the app.";

const manifestExtra = (Constants as any).manifest2?.extra as Record<string, string | undefined> | undefined;
const extra = (Constants.expoConfig?.extra ?? manifestExtra ?? {}) as Record<string, string | undefined>;

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.EXPO_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  extra.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ??
  extra.EXPO_PUBLIC_SUPABASE_KEY;

const createMissingConfigClient = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error(MISSING_SUPABASE_CONFIG_MESSAGE);
      },
    },
  ) as ReturnType<typeof createClient>;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : createMissingConfigClient();
