// Nano (XNO) helpers — pure key derivation + RPC, the same approach proven in production
// (nanocurrency 2.5.x: deriveSecretKey(seed,0) -> derivePublicKey -> deriveAddress{useNanoPrefix}).
// The seed never leaves the process; only the signed block is sent to the node.
import {
  deriveSecretKey, derivePublicKey, deriveAddress, createBlock,
  checkSeed, checkAddress,
} from "nanocurrency";

const RAW_PER_XNO = 10n ** 30n;

export function xnoToRaw(xno: string | number): string {
  const [whole, frac = ""] = String(xno).split(".");
  const fracPadded = (frac + "0".repeat(30)).slice(0, 30);
  return (BigInt(whole || "0") * RAW_PER_XNO + BigInt(fracPadded || "0")).toString();
}
export function rawToXno(raw: string): string {
  const v = BigInt(raw || "0");
  const whole = v / RAW_PER_XNO;
  const frac = (v % RAW_PER_XNO).toString().padStart(30, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export interface NanoConfig { rpcUrl: string; seed: string; index?: number; rep?: string; }

export function accountFromSeed(seed: string, index = 0) {
  if (!checkSeed(seed)) throw new Error("NANO_SEED is not a valid 64-hex seed");
  const secret = deriveSecretKey(seed, index);
  const pub = derivePublicKey(secret);
  const address = deriveAddress(pub, { useNanoPrefix: true });
  return { secret, pub, address };
}

async function rpc(url: string, body: Record<string, unknown>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "elizaos-plugin-nano" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`nano rpc ${r.status}`);
  return (await r.json()) as any;
}

export async function getBalance(cfg: NanoConfig) {
  const { address } = accountFromSeed(cfg.seed, cfg.index ?? 0);
  const info = await rpc(cfg.rpcUrl, { action: "account_info", account: address, representative: true });
  if (info.error) return { address, balanceRaw: "0", balanceXno: "0", open: false };
  return { address, balanceRaw: info.balance, balanceXno: rawToXno(info.balance), open: true, frontier: info.frontier, rep: info.representative };
}

// Send XNO. Signs locally; relays only the signed block. Refuses an invalid destination.
export async function send(cfg: NanoConfig, to: string, amountXno: string) {
  if (!checkAddress(to)) throw new Error(`destination is not a valid Nano address: ${to}`);
  const { secret, address } = accountFromSeed(cfg.seed, cfg.index ?? 0);
  const info = await rpc(cfg.rpcUrl, { action: "account_info", account: address, representative: true });
  if (info.error) throw new Error("account not opened / no balance to send from");
  const balance = BigInt(info.balance);
  const amountRaw = BigInt(xnoToRaw(amountXno));
  if (amountRaw > balance) throw new Error("insufficient balance");
  const { block, hash } = createBlock(secret, {
    balance: (balance - amountRaw).toString(),
    representative: cfg.rep || info.representative,
    previous: info.frontier,
    link: to,
    work: undefined as any, // node computes work when work_generate is enabled; else supply it upstream
  });
  const res = await rpc(cfg.rpcUrl, { action: "process", json_block: "true", subtype: "send", block });
  return { hash: res.hash || hash, to, amountXno };
}

// Receive all pending blocks into the agent's account (opens it if needed).
export async function receive(cfg: NanoConfig) {
  const { secret, pub, address } = accountFromSeed(cfg.seed, cfg.index ?? 0);
  const pend = await rpc(cfg.rpcUrl, { action: "receivable", account: address, count: "20", source: true });
  const blocks = pend.blocks || {};
  const received: string[] = [];
  let info = await rpc(cfg.rpcUrl, { action: "account_info", account: address, representative: true });
  let frontier = info.error ? null : info.frontier;
  let balance = info.error ? 0n : BigInt(info.balance);
  for (const [hashIn, meta] of Object.entries<any>(blocks)) {
    const amt = BigInt(typeof meta === "string" ? meta : meta.amount);
    balance += amt;
    const { block, hash } = createBlock(secret, {
      balance: balance.toString(),
      representative: cfg.rep || (info.error ? address : info.representative),
      previous: frontier || "0".repeat(64),
      link: hashIn,
      work: undefined as any,
    });
    const res = await rpc(cfg.rpcUrl, { action: "process", json_block: "true", subtype: frontier ? "receive" : "open", block });
    received.push(res.hash || hash);
    frontier = res.hash || hash;
  }
  return { address, received };
}
