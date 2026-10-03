// ElizaOS plugin: a Nano (XNO) wallet for your agent — feeless, instant, final payments + an x402 payer.
// Targets @elizaos/core 1.x (built and type-checked against 1.7.2).
//
// Settings (runtime.getSetting): NANO_SEED (64-hex, required to send/receive), NANO_RPC_URL
// (default https://rpc.nano.to), NANO_INDEX (default 0), NANO_REP (optional representative).
import type { Plugin, Action, Provider, IAgentRuntime, Memory, State, HandlerCallback } from "@elizaos/core";
import { accountFromSeed, getBalance, send, receive, type NanoConfig } from "./nano.js";

function cfg(runtime: IAgentRuntime): NanoConfig {
  const str = (k: string) => { const v = runtime.getSetting(k); return v == null || v === true ? "" : String(v); };
  return {
    rpcUrl: str("NANO_RPC_URL") || "https://rpc.nano.to",
    seed: str("NANO_SEED"),
    index: Number(str("NANO_INDEX") || 0),
    rep: str("NANO_REP") || undefined,
  };
}
const hasSeed = (r: IAgentRuntime) => !!r.getSetting("NANO_SEED");
const num = (s: string) => (s.match(/-?\d+(\.\d+)?/) || [])[0];
const addr = (s: string) => (s.match(/(nano|xrb)_[13][0-9a-z]{59}/) || [])[0];

const walletProvider: Provider = {
  name: "NANO_WALLET",
  description: "The agent's Nano (XNO) address and balance.",
  get: async (runtime) => {
    if (!hasSeed(runtime)) return { text: "Nano wallet: not configured (set NANO_SEED to enable XNO payments)." };
    try {
      const b = await getBalance(cfg(runtime));
      return { text: `Nano (XNO) wallet: ${b.address} — balance ${b.balanceXno} XNO${b.open ? "" : " (unopened; receive to open)"}. Payments are feeless and settle in under a second.` };
    } catch (e: any) {
      return { text: `Nano wallet: ${accountFromSeed(cfg(runtime).seed, cfg(runtime).index).address} (balance unavailable: ${e.message}).` };
    }
  },
};

const sendAction: Action = {
  name: "SEND_NANO",
  similes: ["PAY_XNO", "SEND_XNO", "PAY_IN_NANO", "TRANSFER_NANO"],
  description: "Send an amount of Nano (XNO) to a nano_ address. Feeless and final once confirmed.",
  validate: async (runtime, message) => hasSeed(runtime) && !!addr(message.content.text || ""),
  handler: async (runtime, message, _state, _opts, callback?: HandlerCallback) => {
    const text = message.content.text || "";
    const to = addr(text); const amount = num(text);
    if (!to || !amount) { callback?.({ text: "Tell me an amount and a nano_ address to send to." }); return { success: false }; }
    try {
      const r = await send(cfg(runtime), to, amount);
      callback?.({ text: `Sent ${r.amountXno} XNO to ${to}. Block ${r.hash} — feeless, final.`, content: r });
      return { success: true };
    } catch (e: any) { callback?.({ text: `Could not send: ${e.message}` }); return { success: false }; }
  },
  examples: [[
    { name: "{{user1}}", content: { text: "pay 0.01 XNO to nano_1yo6c1t64ahfjdw1dxizmbbnpdmbrckwhw9phbg5pdkeubrizga4qhnjmnx7" } },
    { name: "{{agent}}", content: { text: "Sent 0.01 XNO. Block … — feeless, final.", actions: ["SEND_NANO"] } },
  ]],
};

const balanceAction: Action = {
  name: "CHECK_NANO_BALANCE",
  similes: ["XNO_BALANCE", "NANO_BALANCE", "MY_XNO"],
  description: "Report the agent's Nano (XNO) address and balance.",
  validate: async (runtime) => hasSeed(runtime),
  handler: async (runtime, _m, _s, _o, callback?: HandlerCallback) => {
    try { const b = await getBalance(cfg(runtime));
      callback?.({ text: `${b.balanceXno} XNO at ${b.address}${b.open ? "" : " (unopened)"}.`, content: b }); return { success: true };
    } catch (e: any) { callback?.({ text: `Balance unavailable: ${e.message}` }); return { success: false }; }
  },
  examples: [[{ name: "{{user1}}", content: { text: "what's my XNO balance?" } },
    { name: "{{agent}}", content: { text: "… XNO at nano_…", actions: ["CHECK_NANO_BALANCE"] } }]],
};

const receiveAction: Action = {
  name: "RECEIVE_NANO",
  similes: ["CLAIM_XNO", "RECEIVE_XNO", "OPEN_NANO_ACCOUNT"],
  description: "Receive all pending Nano (XNO) into the agent's account (opens it if new).",
  validate: async (runtime) => hasSeed(runtime),
  handler: async (runtime, _m, _s, _o, callback?: HandlerCallback) => {
    try { const r = await receive(cfg(runtime));
      callback?.({ text: r.received.length ? `Received ${r.received.length} block(s) into ${r.address}.` : `Nothing pending at ${r.address}.`, content: r }); return { success: true };
    } catch (e: any) { callback?.({ text: `Receive failed: ${e.message}` }); return { success: false }; }
  },
  examples: [[{ name: "{{user1}}", content: { text: "receive my pending nano" } },
    { name: "{{agent}}", content: { text: "Received 1 block.", actions: ["RECEIVE_NANO"] } }]],
};

// Pay an x402 endpoint that settles in XNO: GET → 402 (amount + nano address) → send → retry with X-PAYMENT.
const payX402Action: Action = {
  name: "PAY_X402_NANO",
  similes: ["BUY_X402", "PAY_ENDPOINT_XNO", "X402_PAY"],
  description: "Call an x402 endpoint that is priced in Nano (XNO): pay the quoted XNO and retry to get the result.",
  validate: async (runtime, message) => hasSeed(runtime) && /https?:\/\//.test(message.content.text || ""),
  handler: async (runtime, message, _s, _o, callback?: HandlerCallback) => {
    const url = (message.content.text || "").match(/https?:\/\/\S+/)?.[0];
    if (!url) { callback?.({ text: "Give me the endpoint URL to pay." }); return { success: false }; }
    try {
      let res = await fetch(url, { headers: { "User-Agent": "elizaos-plugin-nano" } });
      if (res.status !== 402) { callback?.({ text: `No payment required (HTTP ${res.status}).`, content: { body: await res.text() } }); return { success: true }; }
      const quote = await res.json() as any;
      const to = addr(JSON.stringify(quote)); const amount = num(quote.message || quote.amount || "");
      if (!to || !amount) { callback?.({ text: `402 returned but I could not read the XNO amount/address: ${JSON.stringify(quote).slice(0,200)}` }); return { success: false }; }
      const paid = await send(cfg(runtime), to, amount);
      res = await fetch(url, { headers: { "User-Agent": "elizaos-plugin-nano", "X-PAYMENT": paid.hash } });
      callback?.({ text: `Paid ${amount} XNO (block ${paid.hash}) and retried: HTTP ${res.status}.`, content: { paid, body: await res.text() } });
      return { success: true };
    } catch (e: any) { callback?.({ text: `x402 pay failed: ${e.message}` }); return { success: false }; }
  },
  examples: [[{ name: "{{user1}}", content: { text: "buy the extract from https://extract.paypercall.dev/api/v1/extract" } },
    { name: "{{agent}}", content: { text: "Paid 0.0001 XNO and got the result.", actions: ["PAY_X402_NANO"] } }]],
};

export const nanoPlugin: Plugin = {
  name: "nano",
  description: "Give your agent a Nano (XNO) wallet: feeless, instant, final payments, and an x402 payer that settles in XNO.",
  actions: [sendAction, balanceAction, receiveAction, payX402Action],
  providers: [walletProvider],
  evaluators: [],
};

export default nanoPlugin;
export { accountFromSeed, getBalance, send, receive };
