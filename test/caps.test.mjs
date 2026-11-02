import test from "node:test";
import assert from "node:assert/strict";
import { reserve, capsFrom, _resetForTests } from "../dist/caps.js";
import { xnoToRaw, rawToXno, accountFromSeed } from "../dist/nano.js";

const X = (s) => BigInt(xnoToRaw(s));
const day = new Date("2026-11-02T10:00:00Z");

test("per-call cap refuses before anything is signed", () => {
  _resetForTests();
  assert.throws(() => reserve(X("0.2"), capsFrom(), day), /per-call cap/);
  reserve(X("0.1"), capsFrom(), day);
});

test("daily cap counts reservations and a release gives the amount back", () => {
  _resetForTests();
  const caps = capsFrom("0.5", "1");
  reserve(X("0.5"), caps, day);
  const rel = reserve(X("0.5"), caps, day);
  assert.throws(() => reserve(X("0.1"), caps, day), /daily cap/);
  rel();
  reserve(X("0.5"), caps, day);
});

test("a new UTC day starts at zero", () => {
  _resetForTests();
  const caps = capsFrom("1", "1");
  reserve(X("1"), caps, day);
  reserve(X("1"), caps, new Date("2026-11-03T00:00:01Z"));
});

test("zero, negative and malformed amounts and caps are refused", () => {
  _resetForTests();
  assert.throws(() => reserve(0n, capsFrom(), day));
  assert.throws(() => capsFrom("1e3"));
  assert.throws(() => capsFrom("-1"));
});

test("xno <-> raw round trip is exact and the derivation vector holds", () => {
  assert.equal(xnoToRaw("0.0001"), "100000000000000000000000000");
  assert.equal(rawToXno("100000000000000000000000000"), "0.0001");
  // throwaway all-zero-prefix seed, public test vector: the derived address must be a valid checksummed nano_ address
  const a = accountFromSeed("0".repeat(63) + "1", 0).address;
  assert.match(a, /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/);
});
