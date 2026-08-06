# 💧 PureDrop — Mobile App

> **PureDrop (Capstone)** — A community-based reporting platform for residents of
> **Toledo City** to report and monitor water-related problems in their area.

PureDrop empowers citizens to take an active role in improving local water
services by providing a simple and accessible way to raise concerns. Residents
can report issues such as **no water supply**, **dirty or discolored water**, and
**water leaks** in just a few steps — enter a short description, select their
barangay, and optionally upload a photo as supporting evidence.

> **Note:** This repository contains the **mobile application** only. The admin
> web panel is maintained separately and is not part of this project.

---

## ✨ Features

### Account
- User registration, login, and **email verification (OTP)**
- Password reset / forgot password
- Persistent session handling

### Reporting
- Create water-related reports (**no supply**, **dirty/discolored water**, **leaks**)
- Select barangay and provide a short description
- Optional photo attachments with validation & resize
- GPS-based location capture with an interactive map picker
- Map gestures: tap-to-focus, two-finger pinch zoom, slider zoom

### Tracking & Awareness
- Organized list of reports showing **type**, **location**, **date**, and **status**
- View report details, my reports, and all reports
- Report status tracking

### Notifications
- Push notifications (report updates) via Supabase edge function
- In-app floating & system notifications
- Unread badge indicators

### Profile
- View / edit profile
- Avatar photo via camera or gallery (with resize & validation)

---

## 🧰 Tech Stack

| Layer        | Technology |
|--------------|------------|
| Framework    | [Expo](https://expo.dev) SDK 54 |
| UI           | React Native 0.81, React 19 |
| Navigation   | [expo-router](https://docs.expo.dev/router/introduction) (file-based routing) |
| Auth         | Firebase Authentication |
| Database     | Firebase Firestore (via Firebase Admin functions) |
| Storage      | Supabase Storage (buckets: `reports`, `regular_user`) |
| Realtime / Edge | Supabase Realtime + Edge Functions (e.g. `send-report-push`) |
| Maps         | `react-native-maps`, MapLibre/OSM tiles, MapTiler |
| Animations   | `react-native-reanimated`, `react-native-gesture-handler` |
| Build / EAS  | Expo Application Services (EAS) |

---

## 📁 Project Structure

```
PureDrop_Capstone-main/
├── app/                    # expo-router file-based screens
│   ├── index.tsx           # Entry / splash
│   ├── start.jsx
│   ├── login/              # Login, register, forgot password, OTP, address select
│   └── regular_user/       # Main user screens (home, create_report, profile, reports…)
├── components/             # Reusable UI + feature components
│   ├── create_report/      # Report form, map picker, GPS modal, gestures
│   ├── home/               # Home dashboard (styles, hook, content)
│   ├── notifications/      # Push, floating, system notifications
│   ├── profile/            # Profile editing, avatar camera/resize/validation
│   └── main_layout/        # Layout & exit handler
├── api/                    # Backend service wrappers (Supabase, storage, auth)
├── lib/                    # Business logic (auth, login, regular_user helpers)
├── supabase/               # Supabase config, migrations, edge functions
│   └── functions/          # Edge functions (e.g. send-report-push)
├── functions/              # Firebase Cloud Functions (admin SDK)
├── assets/                 # Images, icons, splash
├── app.json / app.config.js
├── eas.json
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (LTS recommended)
- **npm** or **yarn**
- [Expo CLI](https://docs.expo.dev) / Expo account (for EAS builds)
- **Android Studio / emulator** or a physical Android device

> ⚠️ **Expo Go is not supported.** This app uses native modules
> (`react-native-maps`, `react-native-reanimated`,
> `react-native-gesture-handler`, `expo-notifications`, etc.) and a custom
> **development build** via `expo-dev-client`. Expo Go does not bundle these
> native libraries, so the app **cannot run in Expo Go**. You must build and run
> a development client instead.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

> ⚠️ **For contributors:** The backend services (Firebase, Supabase, Google
> Maps, MapTiler) belong to the **project owner**. If you are a contributor and
> would like to run the app locally, please **contact the owner and request
> permission / access** to these services first. With the owner's approval,
> request the necessary API keys and credentials, then create a `.env` file in
> the project root (or set them in your shell / EAS) with the following values:

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET` | Storage bucket for report photos (`reports`) |
| `EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET` | Storage bucket for avatars (`regular_user`) |
| `EXPO_PUBLIC_SUPABASE_AVATAR_FOLDER` | Avatar folder path (`users`) |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` | Google Maps Android API key |
| `EXPO_PUBLIC_MAPTILER_API_KEY` | MapTiler API key |
| `GOOGLE_SERVICES_JSON` | Path to `google-services.json` (`@./google-services.json` for EAS cloud builds) |

> ⚠️ `google-services.json` is **gitignored** and must be provided for Android
> builds. `app.config.js` reads it from the `GOOGLE_SERVICES_JSON` env var.

### 3. Start the app

```bash
npx expo start
```

Then press:
- `a` — open on an **Android emulator**
- `i` — open on an **iOS simulator**
- Scan the QR code with **Expo Go** on a physical device

### 4. Run on Android (native build)

```bash
npx expo run:android
```

---

## ⚙️ Environment Configuration

`app.config.js` merges `app.json` with runtime environment variables. It sets up
the Android `google-services.json` path and the Google Maps API key so that both
local and EAS cloud builds work correctly.

---

## 📦 Building with EAS

The project uses **EAS Build** with three profiles defined in `eas.json`:

```bash
# Development client (internal)
eas build --profile development

# Preview build (internal distribution)
eas build --profile preview

# Production build (auto-increments version)
eas build --profile production
```

Each build profile ships the required `EXPO_PUBLIC_SUPABASE_*`,
`GOOGLE_MAPS_ANDROID_API_KEY`, `MAPTILER_API_KEY`, and `GOOGLE_SERVICES_JSON`
environment variables.

---

## 🗄️ Backend Services

### Firebase
- **Authentication** — user sign-up, sign-in, and email verification
- **Firestore** — user and report data (admin SDK in `functions/index.js`)
- Rules are defined in `firestore.rules` and `storage.rules`

### Supabase
- **Storage** — report attachments and user avatars
- **Realtime** — live report updates
- **Edge Functions** — e.g. `send-report-push` for push notifications
- Policies in `supabase/storage_policies_regular_user.sql`

---

## 🧪 Linting & Type Checking

```bash
# Lint the project
npm run lint

# Type check (TypeScript)
npx tsc --noEmit
```

---

## 📄 License

This project is a capstone project and is not licensed for public distribution.
© PureDrop Capstone.
