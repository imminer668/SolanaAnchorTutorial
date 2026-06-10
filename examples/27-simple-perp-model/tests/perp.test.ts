/**
 * Lesson 27 测试
 *
 * 使用 Node 内置 `node:test` 运行：npm test
 * 5 个核心测试覆盖：
 *   1. open position 成功
 *   2. oracle update 后 PnL 改变
 *   3. 保证金不足时可 liquidation
 *   4. 保证金充足时 liquidation 失败
 *   5. funding 计算可预测
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  applyFunding,
  calcFunding,
  calcFundingPnl,
  calcMarginRatio,
  calcUnrealizedPnl,
  DEFAULT_RISK_PARAMS,
  liquidate,
  Market,
  openPosition,
  PerpError,
  Position,
  ProtocolState,
  updateOraclePrice,
  UserAccount,
} from "../src/perp";

function freshUser(collateral = 1000): UserAccount {
  return { key: "alice", collateral, positions: [] };
}

function freshProtocol(): ProtocolState {
  return { insuranceFund: 0, socializedLoss: 0 };
}

function freshMarket(price = 100): Market {
  return {
    name: "SOL-PERP",
    oraclePrice: price,
    lastFundingTime: 0,
    fundingRate: 0,
    cumulativeFunding: 0,
  };
}

describe("open position", () => {
  let user: UserAccount;
  let market: Market;
  beforeEach(() => {
    user = freshUser(1000);
    market = freshMarket(100);
  });

  test("openPosition 成功: collateral 减少, positions 出现新仓位", () => {
    const beforeCollateral = user.collateral;
    // size=5, price=100, leverage=5 => notional=500, initial margin=100
    const pos = openPosition(user, market, "long", 5, 5);
    assert.equal(pos.side, "long");
    assert.equal(pos.size, 5);
    assert.equal(pos.entryPrice, 100);
    assert.equal(pos.margin, 100);
    assert.equal(pos.leverage, 5);
    assert.equal(user.collateral, beforeCollateral - 100);
    assert.equal(user.positions.length, 1);
    assert.equal(user.positions[0].user, "alice");
  });

  test("openPosition 保证金不足时抛 INSUFFICIENT_MARGIN", () => {
    const poor = freshUser(10);
    assert.throws(
      () => openPosition(poor, market, "long", 5, 5),
      (err: unknown) => err instanceof PerpError && err.code === "INSUFFICIENT_MARGIN",
    );
  });
});

describe("oracle price & PnL", () => {
  test("oracle 上涨: 多头 PnL > 0; oracle 下跌: 多头 PnL < 0", () => {
    const user = freshUser(1000);
    const market = freshMarket(100);
    const pos = openPosition(user, market, "long", 5, 5); // margin 100

    // 初始 PnL = 0
    assert.equal(calcUnrealizedPnl(pos, 100), 0);

    // 上涨 10%
    updateOraclePrice(market, 110);
    const pnlUp = calcUnrealizedPnl(pos, market.oraclePrice);
    assert.equal(pnlUp, (110 - 100) * 5); // 50

    // 下跌 10%
    updateOraclePrice(market, 90);
    const pnlDown = calcUnrealizedPnl(pos, market.oraclePrice);
    assert.equal(pnlDown, (90 - 100) * 5); // -50
  });

  test("空头 PnL 方向相反", () => {
    const user = freshUser(1000);
    const market = freshMarket(100);
    const pos = openPosition(user, market, "short", 5, 5);

    updateOraclePrice(market, 110);
    // 空头在价格上涨时亏损
    assert.equal(calcUnrealizedPnl(pos, market.oraclePrice), (100 - 110) * 5); // -50
  });
});

describe("liquidation", () => {
  test("保证金率 < 5% 时清算成功", () => {
    const user = freshUser(1000);
    const protocol = freshProtocol();
    const market = freshMarket(100);
    // 开 10x，名义 500，初始 margin = 50
    const pos = openPosition(user, market, "long", 5, 10);

    // 价格跌到 92:  PnL = (92-100)*5 = -40
    //   equity = 50 - 40 = 10
    //   notional = 5*92 = 460
    //   margin ratio = 10/460 ≈ 2.17% < 5% => 可清算
    updateOraclePrice(market, 92);
    const ratio = calcMarginRatio(pos, market.oraclePrice);
    assert.ok(ratio < DEFAULT_RISK_PARAMS.maintenanceMarginRatio, `ratio=${ratio}`);

    const result = liquidate(user, protocol, pos, market.oraclePrice);
    assert.equal(result.liquidated, true);
    assert.ok(result.penalty > 0);
    assert.equal(user.positions.length, 0);
    // 保险基金是协议级状态，不属于单个用户账户。
    assert.ok(protocol.insuranceFund > 0);
    assert.equal("insuranceFund" in user, false);
  });

  test("保证金率 >= 5% 时 liquidation 抛 MARGIN_HEALTHY", () => {
    const user = freshUser(1000);
    const protocol = freshProtocol();
    const market = freshMarket(100);
    const pos = openPosition(user, market, "long", 5, 5); // margin 100, notional 500, ratio 20%

    assert.throws(
      () => liquidate(user, protocol, pos, market.oraclePrice),
      (err: unknown) => err instanceof PerpError && err.code === "MARGIN_HEALTHY",
    );
    // 仓位应该还在
    assert.equal(user.positions.length, 1);
  });
});

describe("funding rate", () => {
  test("funding 在多空不平衡时可预测", () => {
    const market = freshMarket(100);
    // longOI=600, shortOI=400, skew = (600-400)/1000 = 0.2
    // rate = 0.2 * (intervalMs / intervalMs) * 0.01 = 0.002
    const rate = calcFunding(market, 8 * 60 * 60 * 1000, 600, 400);
    assert.equal(rate, 0.002);

    // 半个 interval -> rate = 0.001
    const half = calcFunding(market, 4 * 60 * 60 * 1000, 600, 400);
    assert.equal(half, 0.001);

    // 完全平衡 -> 0
    const balanced = calcFunding(market, 8 * 60 * 60 * 1000, 500, 500);
    assert.equal(balanced, 0);

    // applyFunding 累加到 cumulativeFunding
    const result = applyFunding(market, 8 * 60 * 60 * 1000, 600, 400, 1_700_000_000_000);
    assert.equal(result.rate, 0.002);
    assert.equal(result.cumulative, 0.002);
    assert.equal(market.cumulativeFunding, 0.002);
    assert.equal(market.lastFundingTime, 1_700_000_000_000);
  });

  test("funding 在 totalOI=0 时返回 0（避免除零）", () => {
    const market = freshMarket(100);
    const rate = calcFunding(market, 8 * 60 * 60 * 1000, 0, 0);
    assert.equal(rate, 0);
  });

  test("funding PnL: 正 funding 多头付费、空头收款", () => {
    const market = freshMarket(100);
    const user = freshUser(1000);
    const long = openPosition(user, market, "long", 5, 5);
    const short = openPosition(user, market, "short", 5, 5);

    assert.equal(calcFundingPnl(long, 0.002), -1);
    assert.equal(calcFundingPnl(short, 0.002), 1);
  });
});
