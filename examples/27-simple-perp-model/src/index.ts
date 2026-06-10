/**
 * Lesson 27 Demo: 教学版永续合约模型的可执行演示
 *
 * 演示一个完整的 5 步流程：
 *   1. 用户存入 1000 USD，开 5x 多单
 *   2. oracle 价格上涨 -> 未实现盈利
 *   3. oracle 价格暴跌 -> 触发清算
 *   4. funding 在多空不平衡时产生资金费率
 *   5. 健康仓位下尝试清算会失败
 */

import {
  applyFunding,
  calcMarginRatio,
  calcUnrealizedPnl,
  liquidate,
  Market,
  openPosition,
  PerpError,
  Position,
  ProtocolState,
  updateOraclePrice,
  UserAccount,
} from "./perp";

function logSection(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function main() {
  // -------- 初始化 --------
  const market: Market = {
    name: "SOL-PERP",
    oraclePrice: 100,
    lastFundingTime: 0,
    fundingRate: 0,
    cumulativeFunding: 0,
  };

  const user: UserAccount = {
    key: "alice",
    collateral: 1000,
    positions: [],
  };

  const protocol: ProtocolState = {
    insuranceFund: 0,
    socializedLoss: 0,
  };

  logSection("Step 1: 开 5x 多单, 名义价值 500");
  const pos: Position = openPosition(user, market, "long", 5, 5);
  console.log("position =", pos);
  console.log("user.collateral (剩余) =", user.collateral);
  console.log("marginRatio @ 100 =", calcMarginRatio(pos, market.oraclePrice));

  logSection("Step 2: oracle 涨到 120");
  updateOraclePrice(market, 120);
  console.log("PnL =", calcUnrealizedPnl(pos, market.oraclePrice));
  console.log("marginRatio @ 120 =", calcMarginRatio(pos, market.oraclePrice));

  logSection("Step 3: funding 累计 (多空不平衡)");
  // 假设 long OI=600, short OI=400, 1 个 funding interval
  const fundingResult = applyFunding(market, 8 * 60 * 60 * 1000, 600, 400, Date.now());
  console.log("funding rate =", fundingResult.rate);
  console.log("cumulativeFunding =", fundingResult.cumulative);

  logSection("Step 4: 健康仓位时尝试清算（应失败）");
  try {
    liquidate(user, protocol, pos, market.oraclePrice);
    console.log("不应该到达这里");
  } catch (e) {
    if (e instanceof PerpError) {
      console.log("OK -> 被拒绝:", e.code, e.message);
    } else {
      throw e;
    }
  }

  logSection("Step 5: oracle 暴跌到 60, 触发清算");
  updateOraclePrice(market, 60);
  console.log("marginRatio @ 60 =", calcMarginRatio(pos, market.oraclePrice));
  const result = liquidate(user, protocol, pos, market.oraclePrice);
  console.log("清算结果 =", result);
  console.log("user.collateral (清算后) =", user.collateral);
  console.log("protocol.insuranceFund =", protocol.insuranceFund);
  console.log("protocol.socializedLoss =", protocol.socializedLoss);
  console.log("user.positions.length =", user.positions.length);

  logSection("Done");
}

main();
