/*
 * Unit tests for the pure recommendation engine.
 * Run: node --test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WTW = require("./recommend.js");

const WARDROBE = [
  { id: "t-light",  name: "T-shirt",        type: "top",       warmth: "light",  waterproof: false, windproof: false, active: true },
  { id: "t-med",    name: "Long sleeve",    type: "top",       warmth: "medium", waterproof: false, windproof: false, active: true },
  { id: "t-heavy",  name: "Wool sweater",   type: "top",       warmth: "heavy",  waterproof: false, windproof: false, active: true },
  { id: "b-light",  name: "Shorts",         type: "bottom",    warmth: "light",  waterproof: false, windproof: false, active: true },
  { id: "b-med",    name: "Jeans",          type: "bottom",    warmth: "medium", waterproof: false, windproof: false, active: true },
  { id: "o-light",  name: "Light jacket",   type: "outer",     warmth: "light",  waterproof: false, windproof: true,  active: true },
  { id: "o-rain",   name: "Rain jacket",    type: "outer",     warmth: "medium", waterproof: true,  windproof: true,  active: true },
  { id: "o-coat",   name: "Winter coat",    type: "outer",     warmth: "heavy",  waterproof: true,  windproof: true,  active: true },
  { id: "s-dry",    name: "Sneakers",       type: "shoes",     warmth: "medium", waterproof: false, windproof: false, active: true },
  { id: "s-wet",    name: "Rubber boots",   type: "shoes",     warmth: "medium", waterproof: true,  windproof: false, active: true },
  { id: "a-sun",    name: "Sunglasses",     type: "accessory", warmth: "light",  waterproof: false, windproof: false, active: true },
  { id: "a-scarf",  name: "Scarf & hat",    type: "accessory", warmth: "heavy",  waterproof: false, windproof: true,  active: true }
];

function pick(rec, cat) { return rec.picks.find(p => p.category === cat); }

test("baseTier boundaries follow the spec table", () => {
  assert.equal(WTW.baseTier(25).tier, "hot");
  assert.equal(WTW.baseTier(22).tier, "warm");   // 22 is not > 22
  assert.equal(WTW.baseTier(18).tier, "warm");
  assert.equal(WTW.baseTier(15).tier, "warm");
  assert.equal(WTW.baseTier(12).tier, "mild");
  assert.equal(WTW.baseTier(8).tier, "mild");
  assert.equal(WTW.baseTier(3).tier, "cold");
  assert.equal(WTW.baseTier(0).tier, "cold");
  assert.equal(WTW.baseTier(-5).tier, "freezing");
});

test("hot day → light top, no outer", () => {
  const rec = WTW.recommendOutfit({ feelsLike: 28, windKmh: 5, precipProb: 0, uvIndex: 3 }, WARDROBE, { commuteMode: "driving" });
  assert.equal(pick(rec, "top").item.warmth, "light");
  assert.equal(pick(rec, "outer"), undefined);
});

test("freezing day → heavy top + heavy outer + accessory", () => {
  const rec = WTW.recommendOutfit({ feelsLike: -4, windKmh: 10, precipProb: 0, uvIndex: 0 }, WARDROBE, { commuteMode: "driving" });
  assert.equal(pick(rec, "top").item.warmth, "heavy");
  assert.equal(pick(rec, "outer").item.warmth, "heavy");
  assert.ok(pick(rec, "accessory"), "expected an accessory when freezing");
});

test("CRITICAL: rain never yields a non-waterproof outer/shoes when a waterproof one exists", () => {
  const rec = WTW.recommendOutfit({ feelsLike: 10, windKmh: 5, precipProb: 80, uvIndex: 1 }, WARDROBE, { commuteMode: "walking" });
  assert.equal(pick(rec, "outer").item.waterproof, true);
  assert.equal(pick(rec, "shoes").item.waterproof, true);
});

test("rain with NO waterproof item → umbrella flag", () => {
  const dry = WARDROBE.filter(i => !i.waterproof);
  const rec = WTW.recommendOutfit({ feelsLike: 10, windKmh: 5, precipProb: 90, uvIndex: 1 }, dry, { commuteMode: "walking" });
  assert.ok(rec.flags.some(f => /umbrella/i.test(f)), "expected umbrella flag");
});

test("high wind → windproof outer preferred", () => {
  const rec = WTW.recommendOutfit({ feelsLike: 12, windKmh: 40, precipProb: 0, uvIndex: 1 }, WARDROBE, { commuteMode: "driving" });
  assert.equal(pick(rec, "outer").item.windproof, true);
});

test("high UV → picks sun-protection accessory", () => {
  const rec = WTW.recommendOutfit({ feelsLike: 26, windKmh: 5, precipProb: 0, uvIndex: 9 }, WARDROBE, { commuteMode: "walking" });
  const acc = pick(rec, "accessory");
  assert.ok(acc && /sun|glass|hat/i.test(acc.item.name), "expected sunglasses/hat for high UV");
});

test("walking lowers the rain threshold vs driving", () => {
  const wx = { feelsLike: 12, windKmh: 5, precipProb: 35, uvIndex: 1 };
  const walk = WTW.recommendOutfit(wx, WARDROBE, { commuteMode: "walking" });
  const drive = WTW.recommendOutfit(wx, WARDROBE, { commuteMode: "driving" });
  assert.equal(pick(walk, "outer").item.waterproof, true, "walker gets waterproof at 35%");
  assert.notEqual(drive.flags.join(" "), walk.flags.join(" "), "driver reacts differently at 35%");
});

test("inactive items are never suggested", () => {
  const w = WARDROBE.map(i => i.id === "t-light" ? { ...i, active: false } : i);
  const rec = WTW.recommendOutfit({ feelsLike: 28, windKmh: 5, precipProb: 0, uvIndex: 1 }, w, { commuteMode: "driving" });
  assert.notEqual(pick(rec, "top").item.id, "t-light");
});

test("excludeIds (Not today) swaps to the next-best item", () => {
  const wx = { feelsLike: 28, windKmh: 5, precipProb: 0, uvIndex: 1 };
  const first = WTW.recommendOutfit(wx, WARDROBE, { commuteMode: "driving" });
  const swapped = WTW.recommendOutfit(wx, WARDROBE, { commuteMode: "driving", excludeIds: [pick(first, "top").item.id] });
  assert.notEqual(pick(swapped, "top").item.id, pick(first, "top").item.id);
});

test("no ideal warmth match → still picks closest and flags it", () => {
  const onlyHeavyTop = [
    { id: "h", name: "Parka top", type: "top", warmth: "heavy", waterproof: false, windproof: false, active: true }
  ];
  const rec = WTW.recommendOutfit({ feelsLike: 28, windKmh: 5, precipProb: 0, uvIndex: 1 }, onlyHeavyTop, { commuteMode: "driving" });
  assert.equal(pick(rec, "top").item.id, "h");
  assert.equal(pick(rec, "top").ideal, false);
  assert.ok(rec.flags.some(f => /ideal/i.test(f)));
});
