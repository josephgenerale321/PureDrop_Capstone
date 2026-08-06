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
├── app/                        # expo-router file-based screens (routes)
│   ├── _layout.tsx             # Root layout
│   ├── index.tsx               # Entry / splash
│   ├── start.jsx
│   └── login/                  # Login, register, forgot password, OTP, address select
│       ├── _layout.tsx
│       ├── index.tsx
│       ├── register.tsx
│       ├── forgot_password.tsx
│       ├── address_select.tsx
│       └── email_verification/ # verify_email, success
│   └── regular_user/           # Main authenticated user screens
│       ├── _layout.jsx         # Tab layout + notification providers
│       ├── home.jsx            # Home dashboard
│       ├── notifications.tsx   # Notifications tab
│       ├── profile.tsx         # Profile tab
│       ├── report.tsx / reports-list.tsx / view-reports.tsx
│       ├── view_reportuser.tsx # Report detail (user)
│       ├── directory.tsx / about.tsx
│       ├── create_report/      # createreport, submitted
│       ├── my_report/          # index, share_reportmain
│       ├── all_reports/        # all_reportlist
│       ├── view_allrep/        # viewallreports, attachment_lightbox
│       ├── notifications/      # notification_main
│       ├── profile/            # profileview
│       ├── assistant/          # assistant_main
│       ├── status/             # RegularUserPresenceSync
│       └── signout/            # signout modal/page
├── components/                 # Reusable UI + feature components
│   ├── create_report/          # Form, map picker, GPS modal, gestures, ML validation
│   ├── home/                   # Home dashboard (styles, hook, content)
│   ├── notifications/          # floating_notif, system_notif, push_notificationfunc, notif_func, styles
│   ├── profile/                # Profile editing, avatar camera/resize/validation
│   ├── my_report/              # share_reports
│   ├── all_reports/            # all_repcomponent
│   ├── loading/                # homepage + restore_session loaders
│   ├── login/                  # login backend helpers
│   └── main_layout/            # save_loginfunc, home_exit_handler
├── api/                        # Backend service wrappers (Supabase, storage, auth)
├── lib/                        # Business logic
│   ├── auth/                   # logoutState
│   ├── login/                  # login/register/password/OTP logic
│   └── regular_user/           # creategps, assistant_api
├── supabase/                   # Supabase config, migrations, storage policies
│   └── functions/              # Edge functions (e.g. send-report-push)
├── functions/                  # Firebase Cloud Functions (admin SDK)
├── assets/                     # Images, icons, splash
├── scripts/                    # Utility scripts (avatar migration)
├── app.json / app.config.js
├── firebase.json / firestore.rules / storage.rules
├── google-services.json        # Gitignored (Android builds)
├── eas.json
├── package.json
└── README.md
```

---

## 📱 System Requirements (Device Specs)

Recommended hardware for running the PureDrop mobile app smoothly on a physical
device.

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **RAM** | 4 GB | 6 GB |
| **Storage (free)** | 2 GB | 4 GB+ |
| **App install size** | — | ~150–250 MB |
| **CPU / Chipset** | Modern mid-range (Snapdragon 600-series / Dimensity 700 or equivalent) | Flagship / upper-mid range |
| **OS (Android)** | Android 8.0 (API 26) | Android 10+ |
| **OS (iOS)** | iOS 15+ | Latest stable |
| **Network** | 4G | 5G / Wi‑Fi |
| **Google Play Services** | Required (maps + FCM push) | Required |

Other requirements:
- Working **GPS / Location** for map-based report creation
- **Camera** and **photo library** access for attachments & avatars
- **Notification permission** enabled to receive report-status updates

> ℹ️ The heaviest RAM consumers are Google Maps (`react-native-maps`), image
> attachment handling, real-time Firestore listeners, and Reanimated animations —
> so 4 GB is the floor, 6 GB is comfortable.

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

### 1. Clone the repository

```bash
# Over HTTPS
git clone https://github.com/josephgenerale321/PureDrop_Capstone.git

# Or over SSH (if you have SSH keys configured)
# git clone git@github.com:josephgenerale321/PureDrop_Capstone.git

cd PureDrop_Capstone-main
```

> The repository folder is `PureDrop_Capstone-main` (the app lives inside it).
> The admin web panel is a separate repo and is not included here.

#### Cloning directly in VS Code (no terminal needed)

1. Open **VS Code** and open the Source Control panel
   (`View → Source Control`, or press `Ctrl+Shift+G`).
2. Click **"Clone Repository"**.
3. Paste the repository URL:
   ```
   https://github.com/josephgenerale321/PureDrop_Capstone.git
   ```
4. Choose a folder on your computer, then click **"Clone from URL"**.
5. When prompted, select the `PureDrop_Capstone-main` folder to open.
6. Done — the files are now on your machine. Open a VS Code integrated
   terminal (`Ctrl+``) and continue with the steps below.

> 💡 VS Code's Source Control panel also lets you **pull**, **commit**, **push**,
> and **switch branches** without the command line.

#### Forking the repository (for contributors)

> 👋 **Please let the owner know if you fork this repository.** This is a
> capstone project, and it's helpful (and appreciated) to be aware of forks and
> any intended use. If you fork, you can open an issue, mention the owner, or
> message them on GitHub so they're notified. Contributions are welcome through
> pull requests.

If you want your own copy to make changes and open pull requests, **fork** the
repo first:

1. Go to the repository on GitHub:
   `https://github.com/josephgenerale321/PureDrop_Capstone`
2. Click the **"Fork"** button (top-right), then **"Create fork"**. This creates
   a copy under **your** GitHub account.
3. Clone **your** fork instead of the original:
   ```bash
   git clone https://github.com/YOUR_USERNAME/PureDrop_Capstone.git
   cd PureDrop_Capstone-main
   ```
4. Add the original repo as an **upstream** remote so you can pull the latest
   changes from the owner:
   ```bash
   git remote add upstream https://github.com/josephgenerale321/PureDrop_Capstone.git
   ```
5. Keep your fork up to date:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```
6. Make your changes on a **feature branch**, push to your fork, then open a
   **Pull Request** back to the original repo:
   ```bash
   git checkout -b my-feature
   # ... make your changes ...
   git push origin my-feature
   ```
   Then click **"Compare & pull request"** on GitHub.

> 💡 **Forking in VS Code:** open the Source Control panel → **"Clone
> Repository"** → paste your fork's URL
> (`https://github.com/YOUR_USERNAME/PureDrop_Capstone.git`). After cloning,
> you can fetch/merge from `upstream` through the Source Control branches menu.

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

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

### 4. Build & run the development client

Because this app uses native modules, you must first build a **development
client** (it cannot run in Expo Go). Install and launch it on an emulator or a
connected device:

```bash
# Start the Metro bundler
npx expo start
```

Then, in another terminal, build and install the development client:

```bash
# Android (builds native app and opens it on the emulator/device)
npx expo run:android
```

Alternatively, build a development client with EAS and run it on a device:

```bash
eas build --profile development
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

> ⚠️ **For contributors — request the APK from the owner.** Running `eas build`
> connects to the **owner's EAS project** and needs the owner's credentials
> (EAS project access, `google-services.json`, and API keys). A contributor
> generally **cannot** trigger a successful EAS build on their own. Instead,
> **request a development or preview APK from the project owner**, who will run
> the build and share the downloadable APK/install link with you. (If the owner
> explicitly adds you to their EAS project and hands you the required
> credentials, then you may build yourself.)

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
