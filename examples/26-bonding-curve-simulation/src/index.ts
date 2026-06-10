/**
 * Lesson 26 — 可执行 Demo
 *
 * 演示一次完整的 bonding curve 生命周期：
 *   1. 初始状态（虚拟储备决定价格）
 *   2. 多次买入 → 价格上升
 *   3. 中途卖出 → 价格回落
 *   4. 拉满到迁移阈值 → 触发 migrate() → complete=true
 *   5. 迁移后买入/卖出抛错
 *
 * 纯本地内存模拟，不消耗任何 SOL，不连接 Solana 网络。
 */

import {
  createInitialState,
  getPrice,
  buy,
  sell,
  migrate,
  isMigratable,
  snapshot,
  type BondingCurveState,
  type CurveConfig,
} from "./curve";

function header(title: string) {
  console.log("\n" + "=".repeat(72));
  console.log("  " + title);
  console.log("=".repeat(72));
}

function logState(s: BondingCurveState) {
  console.log("  " + snapshot(s));
}

function main() {
  header("Lesson 26 — Bonding Curve 教学模拟 Demo");

  // 公开文档中 Pump.fun v1 的常用初始值（教学比例，非真实部署参数）
  const config: CurveConfig = {
    initialVirtualSolReserves: 30,         // 30 SOL 虚拟
    initialVirtualTokenReserves: 1_073_000_000, // ~10.73 亿 token
    initialRealTokenReserves:    1_073_000_000, // 全部可卖
    migrationThreshold:          85,        // 85 SOL 真实资金时迁移
  };

  const state = createInitialState(config);

  header("Step 1 — 初始状态");
  console.log("  virtual reserves 决定了价格：");
  logState(state);
  console.log(`  -> 初始价格: ${getPrice(state).toExponential(4)} SOL/token`);

  header("Step 2 — 第一次买入 1 SOL");
  const out1 = buy(state, 1);
  console.log(`  投入: 1 SOL`);
  console.log(`  收到: ${out1.toFixed(2)} token`);
  logState(state);

  header("Step 3 — 第二次买入 5 SOL");
  const out2 = buy(state, 5);
  console.log(`  投入: 5 SOL`);
  console.log(`  收到: ${out2.toFixed(2)} token`);
  logState(state);

  header("Step 4 — 中途卖出一部分 token（回吐 1 SOL 价值）");
  // 先拿到当前价格，反推一个大概能换到 1 SOL 的 token 量
  const priceNow = getPrice(state);
  const tokensToSell = 1 / priceNow; // 近似
  const solBack = sell(state, tokensToSell);
  console.log(`  卖出: ${tokensToSell.toFixed(2)} token`);
  console.log(`  收到: ${solBack.toFixed(4)} SOL (回吐 ~1 SOL 价值)`);
  logState(state);

  header(`Step 5 — 反复买入直到 realSolReserves >= ${config.migrationThreshold} SOL`);
  let safety = 0;
  while (!isMigratable(state, config.migrationThreshold) && safety < 1000) {
    buy(state, 20);
    safety++;
  }
  console.log(`  累计买入 ${safety} 次，每次 20 SOL`);
  logState(state);

  header("Step 6 — 触发 migrate()");
  const migrated = migrate(state, config.migrationThreshold);
  console.log(`  migrate() 返回: ${migrated}`);
  console.log(`  complete = ${state.complete}`);
  console.log("  教学：真实 Pump.fun 在这一步会把 SOL+token 注入到 Raydium 建池。");

  header("Step 7 — 迁移后尝试买入（应当抛错）");
  try {
    buy(state, 1);
    console.log("  意外：没有抛错（bug）");
  } catch (e) {
    console.log(`  按预期抛错: ${(e as Error).message}`);
  }

  header("Demo 完成");
  console.log("  本演示是教学模拟，不消耗任何 SOL，未连接任何网络。");
  console.log("  详见 README.md / docs.md。");
}

main();
