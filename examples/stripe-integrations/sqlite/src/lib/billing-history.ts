import type { StripeSessionResult } from "@farm.js/integrations/stripe/client";

export interface BillingHistoryEntry {
  email: string;
  sessionId: string;
  customerId: string | null;
  status: string | null;
  paymentStatus: string | null;
  mode: "payment" | "subscription" | null;
  amountTotal: number | null;
  currency: string | null;
  capturedAt: string;
  lineItems: StripeSessionResult["lineItems"];
}

const STORAGE_KEY = "farm:stripe-billing-history";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readStore(): Record<string, BillingHistoryEntry[]> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, BillingHistoryEntry[]>)
      : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, BillingHistoryEntry[]>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function saveBillingHistoryEntry(entry: BillingHistoryEntry) {
  const email = normalizeEmail(entry.email);
  if (!email) {
    return;
  }

  const store = readStore();
  const existing = store[email] ?? [];
  const withoutDuplicate = existing.filter((item) => item.sessionId !== entry.sessionId);
  store[email] = [entry, ...withoutDuplicate].slice(0, 10);
  writeStore(store);
}

export function readBillingHistory(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return [];
  }

  return readStore()[normalized] ?? [];
}
