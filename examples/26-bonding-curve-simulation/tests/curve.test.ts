/**
 * Lesson 26 — Bonding Curve 单元测试
 *
 * 使用 Node 内置 node:test，无需安装 vitest / mocha。
 * 运行：npm test   等价于   ts-node --transpile-only tests/curve.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInitialState,
  getPrice,
  buy,
  sell,
  migrate,
  isMigratable,
  quoteBuy,
  quoteSell,
  type CurveConfig,
} from "../src/curve";

const baseConfig: CurveConfig = {
  initialVirtualSolReserves: 30,
  initialVirtualTokenReserves: 1_073_000_000,
  initialRealTokenReserves: 1_073_000_000,
  migrationThreshold: 85,
};

/* ------------------------------------------------------------------ */
/* Test 1: 初始价格 = virtualSol / virtualToken；buy(0)/sell(0) 抛错 */
/* ------------------------------------------------------------------ */
test("initial state: price equals virtualSol/virtualToken; zero-amount ops are rejected", () => {
  const s = createInitialState(baseConfig);
  const expectedPrice = 30 / 1_073_000_000;
  assert.equal(s.complete, false);
  assert.equal(s.realSolReserves, 0);
  assert.equal(getPrice(s), expectedPrice);

  assert.throws(() => buy(s, 0), /solAmount must be > 0/);
  assert.throws(() => sell(s, 0), /tokenAmount must be > 0/);
});

/* ------------------------------------------------------------------ */
/* Test 2: 买入后虚拟储备变化，价格上升                               */
/* ------------------------------------------------------------------ */
test("buy: price rises after a buy; virtual reserves update; real reserves track", () => {
  const s = createInitialState(baseConfig);
  const priceBefore = getPrice(s);
  const tokensOut = buy(s, 5);
  const priceAfter = getPrice(s);

  assert.ok(tokensOut > 0, "buy should yield some tokens");
  assert.ok(priceAfter > priceBefore, `price should rise: before=${priceBefore} after=${priceAfter}`);
  assert.equal(s.virtualSolReserves, 30 + 5);
  assert.equal(s.realSolReserves, 5);
  assert.equal(s.realTokenReserves, baseConfig.initialRealTokenReserves - tokensOut);

  // k 应保持不变（常数乘积）
  const kBefore = 30 * 1_073_000_000;
  const kAfter = s.virtualSolReserves * s.virtualTokenReserves;
  assert.ok(Math.abs(kAfter - kBefore) < 1e-3, `k must be conserved: ${kBefore} vs ${kAfter}`);
});

/* ------------------------------------------------------------------ */
/* Test 3: 卖出后价格下降；卖出报价公式自洽                          */
/* ------------------------------------------------------------------ */
test("sell: price falls after a sell; quoteSell is consistent with state update", () => {
  const s = createInitialState(baseConfig);
  // 先买入一些 token，建立头寸
  buy(s, 10);

  const tokensHeld = baseConfig.initialRealTokenReserves - s.realTokenReserves;
  assert.ok(tokensHeld > 0, "must have tokens to sell");

  const priceBefore = getPrice(s);
  const expectedSol = quoteSell(s, tokensHeld);
  const actualSol = sell(s, tokensHeld);
  const priceAfter = getPrice(s);

  assert.ok(actualSol > 0);
  assert.ok(priceAfter < priceBefore, "price should fall after sell");
  assert.ok(Math.abs(actualSol - expectedSol) < 1e-9, "sell() must match quoteSell()");

  // 全部卖光后 realTokenReserves 等于初始（不应超过）
  assert.equal(s.realTokenReserves, baseConfig.initialRealTokenReserves);
});

/* ------------------------------------------------------------------ */
/* Test 4: 达到 migration threshold 后 migrate() 翻 complete；之后   */
/*        任何 buy/sell 都被拒绝                                      */
/* ------------------------------------------------------------------ */
test("migrate: complete flips to true after realSolReserves >= threshold; further trades fail", () => {
  const s = createInitialState(baseConfig);
  assert.equal(s.complete, false);

  // 累计买入直到达到阈值
  let safety = 0;
  while (!isMigratable(s, baseConfig.migrationThreshold) && safety < 1000) {
    buy(s, 20);
    safety++;
  }
  assert.ok(
    isMigratable(s, baseConfig.migrationThreshold),
    `realSolReserves should reach threshold: ${s.realSolReserves}`
  );
  assert.equal(s.complete, false, "migrate() has not been called yet");

  const ok = migrate(s, baseConfig.migrationThreshold);
  assert.equal(ok, true);
  assert.equal(s.complete, true);

  // 重复 migrate() 不应报错（幂等返回 false）
  const ok2 = migrate(s, baseConfig.migrationThreshold);
  assert.equal(ok2, false);
  assert.equal(s.complete, true);

  // 迁移后不能再交易
  assert.throws(() => buy(s, 1), /migrated/);
  assert.throws(() => sell(s, 1), /migrated/);
});

/* ------------------------------------------------------------------ */
/* Bonus Test: 边界 — 用户余额由调用方校验；k 始终守恒               */
/* ------------------------------------------------------------------ */
test("guards: caller tracks user token balance; k stays constant across rounds", () => {
  const s = createInitialState(baseConfig);
  let userTokens = 0;
  userTokens += buy(s, 1);
  userTokens += buy(s, 2);
  userTokens += buy(s, 3);

  const kBefore = s.virtualSolReserves * s.virtualTokenReserves;

  function sellFromUser(tokenAmount: number) {
    if (tokenAmount > userTokens) {
      throw new Error("user token balance too low");
    }
    const solOut = sell(s, tokenAmount);
    userTokens -= tokenAmount;
    return solOut;
  }

  // 用户余额不属于 curve 状态，应由调用方根据 token account 校验。
  assert.throws(() => sellFromUser(userTokens + 1), /user token balance too low/);

  // 正常卖出小部分，k 仍守恒
  sellFromUser(1000);
  const kAfter = s.virtualSolReserves * s.virtualTokenReserves;
  assert.ok(Math.abs(kAfter - kBefore) < 1e-3, `k drifted: ${kBefore} -> ${kAfter}`);
});

test("guards: cannot sell when curve has no real SOL to pay out", () => {
  const s = createInitialState(baseConfig);
  assert.throws(() => sell(s, 1), /insufficient real SOL reserves/);
});
