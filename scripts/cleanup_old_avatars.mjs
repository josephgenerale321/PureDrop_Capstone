#!/usr/bin/env node
/**
 * Cleanup script: remove old timestamped profile-image files that accumulated
 * in the Supabase `regular_user` bucket before the stable-path + upsert fix.
 *
 * Old naming:  users/{uid}/profile-image-{timestamp}.{ext}
 * New naming:  users/{uid}/profile-image.{ext}
 *
 * This script keeps only the newest `profile-image.{ext}` per user and deletes
 * all legacy `profile-image-{timestamp}.{ext}` files.
 *
 * Setup:
 *   npm install @supabase/supabase-js
 *
 * Run (from PureDrop_Capstone-main):
 *   node scripts/cleanup_old_avatars.mjs
 *
 * Environment variables:
 *   SUPABASE_URL        (optional, defaults to the project URL)
 *   SUPABASE_SERVICE_KEY (required — service_role key from Supabase dashboard)
 *   BUCKET              (optional, defaults to "regular_user")
 *   AVATAR_FOLDER       (optional, defaults to "users")
 *   DRY_RUN             (optional, "true" only lists files without deleting; default "false")
 */
import { createClient } from "@supabase/supabase-js";

const PROJECT_URL = process.env.SUPABASE_URL || "https://kfanwlpemesqvquypqvh.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.BUCKET || "regular_user";
const AVATAR_FOLDER = process.env.AVATAR_FOLDER || "users";
const DRY_RUN = (process.env.DRY_RUN || "false").toLowerCase() === "true";

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_KEY. Set it to your Supabase service_role key.");
  process.exit(1);
}

const supabase = createClient(PROJECT_URL, SERVICE_KEY, { auth: { persistSession: false } });

const LEGACY_PATTERN = /^profile-image(-\d+)?\.(jpeg|jpg|png|webp|heic)$/;
const STABLE_STANDARD_PATTERN = /^profile-image\.(jpg|png|webp|heic)$/;

const main = async () => {
  console.log(`Cleaning up legacy avatar files in '${BUCKET}/${AVATAR_FOLDER}/'`);
  console.log(`DRY_RUN=${DRY_RUN}`);

  // List all objects under the avatar folder (paginated)
  const allObjects = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(AVATAR_FOLDER, { limit: PAGE_SIZE, offset: from, sortBy: { column: "name", order: "asc" } });

    if (error) {
      console.error("Failed to list bucket:", error.message);
      process.exit(1);
    }

    allObjects.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  console.log(`Found ${allObjects.length} top-level item(s) under '${AVATAR_FOLDER}/'.`);

  // Group by user folder
  const userFolders = allObjects.filter((obj) => obj.id === null); // folders have id === null
  const files = allObjects.filter((obj) => obj.id !== null);

  console.log(`Found ${userFolders.length} user folder(s) and ${files.length} direct file(s).`);

  let totalDeleted = 0;
  let totalKept = 0;

  // Process each user folder
  for (const folder of userFolders) {
    const folderName = folder.name;
    const prefix = `${AVATAR_FOLDER}/${folderName}`;

    const { data: userFiles, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });

    if (listError) {
      console.warn(`  (warn) could not list ${prefix}: ${listError.message}`);
      continue;
    }

    const legacyFiles = (userFiles || []).filter((f) => LEGACY_PATTERN.test(f.name));
    const stableFiles = (userFiles || []).filter((f) => !LEGACY_PATTERN.test(f.name));

    if (legacyFiles.length === 0) {
      continue;
    }

    console.log(`[${folderName}] ${legacyFiles.length} legacy file(s), ${stableFiles.length} stable file(s)`);

    for (const legacyFile of legacyFiles) {
      const fullPath = `${prefix}/${legacyFile.name}`;
      if (DRY_RUN) {
        console.log(`  (dry-run) would delete ${fullPath}`);
        totalDeleted += 1;
      } else {
        const { error: deleteError } = await supabase.storage.from(BUCKET).remove([fullPath]);
        if (deleteError) {
          console.warn(`  (warn) could not delete ${fullPath}: ${deleteError.message}`);
        } else {
          console.log(`  deleted ${fullPath}`);
          totalDeleted += 1;
        }
      }
    }

    totalKept += stableFiles.length;
  }

  // Also handle any direct legacy files at the top level (unlikely but safe)
  for (const file of files) {
    if (LEGACY_PATTERN.test(file.name)) {
      const fullPath = `${AVATAR_FOLDER}/${file.name}`;
      if (DRY_RUN) {
        console.log(`  (dry-run) would delete ${fullPath}`);
        totalDeleted += 1;
      } else {
        const { error: deleteError } = await supabase.storage.from(BUCKET).remove([fullPath]);
        if (deleteError) {
          console.warn(`  (warn) could not delete ${fullPath}: ${deleteError.message}`);
        } else {
          console.log(`  deleted ${fullPath}`);
          totalDeleted += 1;
        }
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Legacy files deleted: ${totalDeleted}`);
  console.log(`Stable files kept: ${totalKept}`);
  if (DRY_RUN) {
    console.log("(DRY RUN — no files were actually deleted)");
  }
};

main().catch((error) => {
  console.error("Cleanup aborted:", error);
  process.exit(1);
});