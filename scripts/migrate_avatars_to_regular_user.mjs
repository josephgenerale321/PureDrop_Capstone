#!/usr/bin/env node
/**
 * Migration script: move existing regular-user profile pictures from the
 * Supabase `reports` bucket's `users/{uid}/...` folder into the new
 * `regular_user` bucket, then update each user's Firestore doc.
 *
 * This script does NOT depend on firebase-admin (which may be broken in the
 * Expo project). It reads the Firebase service-account JSON, mints a Google
 * OAuth access token, and uses the Firestore REST API. Supabase storage is
 * accessed with the @supabase/supabase-js client + service-role key.
 *
 * Setup:
 *   npm install @supabase/supabase-js
 *
 * Run (from PureDrop_Capstone-main):
 *   node scripts/migrate_avatars_to_regular_user.mjs
 *
 * Environment variables:
 *   SUPABASE_SERVICE_KEY    (required — service_role key from Supabase dashboard)
 *   GOOGLE_APPLICATION_CREDENTIALS (optional, defaults to the adminsdk JSON path)
 *   OLD_BUCKET              (optional, defaults to "reports")
 *   NEW_BUCKET              (optional, defaults to "regular_user")
 *   AVATAR_FOLDER           (optional, defaults to "users")
 *   DELETE_OLD              (optional, "false" keeps the old object; default "true")
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createSign } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __root = path.resolve(__dirname, "..");

const PROJECT_URL = process.env.SUPABASE_URL || "https://kfanwlpemesqvquypqvh.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OLD_BUCKET = process.env.OLD_BUCKET || "reports";
const NEW_BUCKET = process.env.NEW_BUCKET || "regular_user";
const AVATAR_FOLDER = process.env.AVATAR_FOLDER || "users";
const DELETE_OLD = (process.env.DELETE_OLD || "true").toLowerCase() !== "false";
const FIRESTORE_PROJECT = "puredrop-capstone-project";

const FIREBASE_SCOPE = "https://www.googleapis.com/auth/datastore";
const JWT_ALG = "RS256";

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY. Set it to your Supabase service_role key.");
  process.exit(1);
}

// ---- Firebase service-account JWT -> Google OAuth token ----
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(__root, "puredrop-capstone-project-firebase-adminsdk-fbsvc-f5c887662b.json");

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, "utf8"));

const base64Url = (buffer) =>
  Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const getAccessToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: JWT_ALG, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FIREBASE_SCOPE,
      aud: serviceAccount.token_uri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(serviceAccount.private_key));

  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Could not mint access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
};

// ---- Firestore REST helpers ----
const listAllUsers = async (token) => {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/regular_user?pageSize=300`;
  const all = [];
  let nextUrl = url;
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Firestore list failed: ${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    all.push(...(data.documents || []));
    nextUrl = data.nextPageToken
      ? `${url}&pageToken=${data.nextPageToken}`
      : null;
  }
  return all;
};

const updateUserDoc = async (token, userId, fields) => {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/regular_user/${userId}?updateMask.fieldPaths=profileImageUrl&updateMask.fieldPaths=profileImagePath`;
  const body = {
    fields: {
      profileImageUrl: { stringValue: fields.profileImageUrl },
      profileImagePath: { stringValue: fields.profileImagePath },
    },
  };
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Firestore update failed for ${userId}: ${response.status} ${await response.text()}`);
  }
};

// ---- Supabase storage helpers ----
const supabase = createClient(PROJECT_URL, SERVICE_KEY, { auth: { persistSession: false } });

const normalizePath = (value) => String(value || "").trim().replace(/^\/+|\/+$/g, "");

const extractAvatarPath = (profileImageUrl) => {
  const raw = String(profileImageUrl || "").trim();
  if (!raw) return "";
  if (!raw.includes("://")) {
    return normalizePath(raw.startsWith(`${OLD_BUCKET}/`) ? raw.slice(OLD_BUCKET.length + 1) : raw);
  }
  try {
    const parsed = new URL(raw);
    const markers = [
      `/storage/v1/object/public/${OLD_BUCKET}/`,
      `/storage/v1/object/sign/${OLD_BUCKET}/`,
      `/storage/v1/object/authenticated/${OLD_BUCKET}/`,
      `/storage/v1/render/image/public/${OLD_BUCKET}/`,
      `/storage/v1/render/image/authenticated/${OLD_BUCKET}/`,
      `/storage/v1/object/${OLD_BUCKET}/`,
    ];
    for (const marker of markers) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx >= 0) return normalizePath(parsed.pathname.slice(idx + marker.length));
    }
  } catch {
    return "";
  }
  return "";
};

const downloadOldObject = async (fromPath) => {
  const { data, error } = await supabase.storage.from(OLD_BUCKET).download(fromPath);
  if (error) throw new Error(`download ${OLD_BUCKET}/${fromPath}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
};

const uploadNewObject = async (toPath, buffer, contentType) => {
  const { error } = await supabase.storage.from(NEW_BUCKET).upload(toPath, buffer, {
    contentType: contentType || "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(`upload ${NEW_BUCKET}/${toPath}: ${error.message}`);
};

const deleteOldObject = async (fromPath) => {
  const { error } = await supabase.storage.from(OLD_BUCKET).remove([fromPath]);
  if (error) console.warn(`  (warn) could not delete ${OLD_BUCKET}/${fromPath}: ${error.message}`);
};

const getPublicUrl = (bucket, pathVal) => {
  const { data } = supabase.storage.from(bucket).getPublicUrl(pathVal);
  return data?.publicUrl || "";
};

const main = async () => {
  console.log(`Migrating from '${OLD_BUCKET}' -> '${NEW_BUCKET}' (folder: ${AVATAR_FOLDER})`);
  console.log(`DELETE_OLD=${DELETE_OLD}`);
  console.log("Obtaining Firebase access token...");
  const token = await getAccessToken();

  console.log("Listing regular_user documents...");
  const docs = await listAllUsers(token);
  console.log(`Found ${docs.length} user document(s).`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const userId = doc.name.split("/").pop();
    const data = doc.fields || {};
    const profileImageUrl = data.profileImageUrl?.stringValue || "";
    const profileImagePath = data.profileImagePath?.stringValue || "";

    let oldPath = normalizePath(profileImagePath);
    if (!oldPath) oldPath = extractAvatarPath(profileImageUrl);

    if (!oldPath) {
      console.log(`[${userId}] no avatar to migrate (skip)`);
      skipped += 1;
      continue;
    }
    if (!oldPath.startsWith(`${AVATAR_FOLDER}/`)) {
      console.log(`[${userId}] avatar path not under '${AVATAR_FOLDER}/' (skip): ${oldPath}`);
      skipped += 1;
      continue;
    }

    const newPath = oldPath;
    const newPublicUrl = getPublicUrl(NEW_BUCKET, newPath);

    try {
      console.log(`[${userId}] migrating ${OLD_BUCKET}/${oldPath}`);
      const buffer = await downloadOldObject(oldPath);
      await uploadNewObject(newPath, buffer, "image/jpeg");
      await updateUserDoc(token, userId, { profileImageUrl: newPublicUrl, profileImagePath: newPath });
      if (DELETE_OLD) await deleteOldObject(oldPath);
      console.log(`  -> ${NEW_BUCKET}/${newPath} (OK)`);
      migrated += 1;
    } catch (error) {
      console.error(`[${userId}] FAILED:`, error.message);
      failed += 1;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
};

main().catch((error) => {
  console.error("Migration aborted:", error);
  process.exit(1);
});
