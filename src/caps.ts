// Spend caps, enforced in code before anything is signed. A chat message that contains a nano_ address must not be able
// to drain the wallet: SEND_NANO and PAY_X402_NANO both go through send(), and send() goes through reserve().
// Limits: NANO_MAX_SEND_XNO (per call, default 0.1) and NANO_MAX_DAY_XNO (per UTC day, default 1). The day total lives
// in this process's memory, so a restart resets it: it is a guard against a runaway prompt, not an accounting ledger.
const RAW_PER_XNO = 10n ** 30n;

function toRaw(xno: string): bigint {
  if (!/^\d+(\.\d{1,30})?$/.test(xno)) throw new Error(`not a plain XNO amount: ${xno}`);
  const [w, f = ""] = xno.split(".");
  return BigInt(w) * RAW_PER_XNO + BigInt((f + "0".repeat(30)).slice(0, 30));
}

export interface Caps { perCallRaw: bigint; perDayRaw: bigint; }
export function capsFrom(perCall?: string, perDay?: string): Caps {
  return { perCallRaw: toRaw(perCall || "0.1"), perDayRaw: toRaw(perDay || "1") };
}

const spent = new Map<string, bigint>(); // UTC day -> raw reserved
const today = (now: Date) => now.toISOString().slice(0, 10);

/** Throws when the amount is over a cap; otherwise records it and returns a release() for a failed send. */
export function reserve(amountRaw: bigint, caps: Caps, now: Date = new Date()): () => void {
  if (amountRaw <= 0n) throw new Error("amount must be positive");
  if (amountRaw > caps.perCallRaw) throw new Error(`over the per-call cap (${caps.perCallRaw} raw); raise NANO_MAX_SEND_XNO to allow it`);
  const d = today(now);
  const used = spent.get(d) ?? 0n;
  if (used + amountRaw > caps.perDayRaw) throw new Error(`over the daily cap (${caps.perDayRaw} raw, ${used} already used today); raise NANO_MAX_DAY_XNO`);
  spent.set(d, used + amountRaw);
  return () => spent.set(d, (spent.get(d) ?? amountRaw) - amountRaw);
}
export function _resetForTests() { spent.clear(); }
