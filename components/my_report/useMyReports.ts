import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../../firebaseConfig";
import {
  getCachedReports,
  saveReports,
} from "./offlinefunc";

export type ReportItem = {
  reportId: string;
  category: string;
  issue: string;
  location: string | null;
  gpsLocation: string | null;
  status: string;
  submittedAt: string;
};

const normalizeStatus = (value: unknown): string => {
  if (typeof value !== "string") {
    return "Pending";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "resolving" || normalized === "resolved") return "Resolving";
  if (normalized === "pending" || normalized === "submitted") return "Pending";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
};

const normalizeReport = (value: unknown, fallbackId: string): ReportItem => {
  const item = (value ?? {}) as Partial<ReportItem>;
  return {
    reportId:
      typeof item.reportId === "string" && item.reportId.length > 0
        ? item.reportId
        : fallbackId,
    category: typeof item.category === "string" ? item.category : "Uncategorized",
    issue: typeof item.issue === "string" ? item.issue : "",
    location: typeof item.location === "string" ? item.location : null,
    gpsLocation: typeof item.gpsLocation === "string" ? item.gpsLocation : null,
    status: normalizeStatus(item.status),
    submittedAt: typeof item.submittedAt === "string" ? item.submittedAt : "",
  };
};

const toEpoch = (value: unknown): number => {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
};

/**
 * Loads the current user's submitted reports from Firestore, with an offline
 * fallback cache (AsyncStorage). Returns loading/reports/offline state.
 *
 * SAFETY: All async work is wrapped so it can never throw and crash the app,
 * including on preview and development builds.
 */
export function useMyReports() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let unsubscribeSubcollection: (() => void) | null = null;
    let unsubscribeUserDoc: (() => void) | null = null;
    let subcollectionReports: ReportItem[] = [];
    let legacyReports: ReportItem[] = [];
    let isMounted = true;
    let activeUid: string | null = null;

const mergeAndSetReports = (uid: string | null, fromCache = false) => {
      const mergedMap = new Map<string, ReportItem>();
      [...legacyReports, ...subcollectionReports].forEach((item) => {
        mergedMap.set(item.reportId, item);
      });

      const merged = Array.from(mergedMap.values()).sort(
        (a, b) => toEpoch(b.submittedAt) - toEpoch(a.submittedAt),
      );

      if (fromCache) {
        setOffline(true);
      } else {
        setOffline(false);
      }
      setReports(merged);
      setLoading(false);

      // Whenever we have fresh (online) data, cache it so the next offline
      // open can still show My Reports. Fire-and-forget; never throws.
      // Cache even when merged is empty so a cleared list is also persisted.
      if (!fromCache && uid) {
        void saveReports(
          uid,
          merged.map((r) => ({
            reportId: r.reportId,
            category: r.category,
            issue: r.issue,
            location: r.location,
            gpsLocation: r.gpsLocation,
            status: r.status,
            submittedAt: r.submittedAt,
          })),
        );
      }
    };

const fallbackToCache = async (uid: string) => {
      try {
        const cached = await getCachedReports(uid);
        if (!isMounted) {
          return;
        }
        // Always resolve the loading state so the screen never hangs, even
        // when there is nothing cached (falls back to the empty list).
        setReports(cached);
        setOffline(cached.length > 0);
        setLoading(false);
      } catch {
        // Non-fatal: fall back to an empty list and stop loading.
        if (isMounted) {
          setReports([]);
          setOffline(false);
          setLoading(false);
        }
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (unsubscribeSubcollection) {
        unsubscribeSubcollection();
        unsubscribeSubcollection = null;
      }
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (!currentUser) {
        subcollectionReports = [];
        legacyReports = [];
        setReports([]);
        setOffline(false);
        setLoading(false);
        activeUid = null;
        return;
      }

      const uid = currentUser.uid;
      activeUid = uid;

      const reportsRef = collection(db, "regular_user", uid, "reports");
      const userDocRef = doc(db, "regular_user", uid);

unsubscribeSubcollection = onSnapshot(
        reportsRef,
        (snapshot) => {
          subcollectionReports = snapshot.docs.map((docSnap, index) =>
            normalizeReport(docSnap.data(), docSnap.id || `report-sub-${index}`),
          );
          mergeAndSetReports(activeUid);
        },
        () => {
          // Offline / listener failure: do NOT call `mergeAndSetReports` here.
          // That path would clear the in-memory list AND write an empty array
          // to the offline cache (via the `!fromCache` save branch), wiping the
          // last-known reports before the cache can be read back. Instead, go
          // straight to the cached data so My Reports still shows offline.
          subcollectionReports = [];
          void fallbackToCache(uid);
        },
      );

      unsubscribeUserDoc = onSnapshot(
        userDocRef,
        (userSnap) => {
          if (!userSnap.exists()) {
            legacyReports = [];
            mergeAndSetReports(activeUid);
            return;
          }

          const rawReports = userSnap.data().reports;
          const legacy = Array.isArray(rawReports) ? rawReports : [];
          legacyReports = legacy.map((item, index) =>
            normalizeReport(item, `report-legacy-${index}`),
          );
          mergeAndSetReports(activeUid);
        },
        () => {
          // See note above: avoid the online merge on error so the offline
          // cache is never overwritten with an empty list.
          legacyReports = [];
          void fallbackToCache(uid);
        },
      );
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeSubcollection) {
        unsubscribeSubcollection();
      }
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
    };
  }, []);

  return { loading, reports, offline };
}
