/**
 * Lesson 26 — Bonding Curve 教学模拟核心
 *
 * 重要声明：本文件是 **教学简化模拟**，不复刻真实 Pump.fun 协议源码。
 * 真实 Pump.fun 的 v1 阶段使用 virtual reserve + constant product (x*y=k) 公式，
 * 并在 realSolReserves 达到阈值时把流动性迁移到 Raydium。
 * 本模拟沿用这一公开的公式思想，但省略了：
 *   - 协议手续费、平台抽成、creator 分成
 *   - SPL Token 实际铸造 / 销毁的 CPI 流程
 *   - PDA 账户、签名校验、rent 管理等链上细节
 *   - 链上错误处理、事件、约束
 *
 * 目的：让 EVM 出身的开发者理解 bonding curve 的数学结构与状态机。
 */

/* ----------------------------- 状态结构 ----------------------------- */

export interface BondingCurveState {
  /** 虚拟 SOL 储备。初始由协议"凭空"注入，决定初始价格。 */
  virtualSolReserves: number;

  /** 虚拟 token 储备。初始由协议"凭空"注入，决定初始价格。 */
  virtualTokenReserves: number;

  /** 真实 SOL 储备（用户实际买入累计的 SOL）。决定是否触发迁移。 */
  realSolReserves: number;

  /** 真实 token 储备（已铸造但仍在 curve 池中等待卖出的 token）。 */
  realTokenReserves: number;

  /** 曲线一侧最大可供应的 token 量（卖出用完即清仓）。 */
  tokenTotalSupply: number;

  /** 迁移标志：达到阈值后置 true，模拟 LP 迁出到 Raydium。 */
  complete: boolean;
}

export interface CurveConfig {
  /** 初始虚拟 SOL 储备（lamports 概念的"单位"，本模拟用浮点）。 */
  initialVirtualSolReserves: number;

  /** 初始虚拟 token 储备。 */
  initialVirtualTokenReserves: number;

  /** 曲线侧 token 总量。 */
  initialRealTokenReserves: number;

  /** 触发迁移的真实 SOL 阈值。 */
  migrationThreshold: number;
}

/* --------------------------- 工厂 & 工具 --------------------------- */

/** 用 9 位精度处理"lamport 级别"换算（教学用，与链上 lamport 概念对应）。 */
export const SOL_PRECISION = 1_000_000_000;

export function createInitialState(cfg: CurveConfig): BondingCurveState {
  return {
    virtualSolReserves: cfg.initialVirtualSolReserves,
    virtualTokenReserves: cfg.initialVirtualTokenReserves,
    realSolReserves: 0,
    realTokenReserves: cfg.initialRealTokenReserves,
    tokenTotalSupply: cfg.initialRealTokenReserves,
    complete: false,
  };
}

/* -------------------------- 价格 / 报价 -------------------------- */

/**
 * 当前 1 个 token 的 SOL 价格 = virtualSolReserves / virtualTokenReserves。
 * 教学要点：k = virtualSol * virtualToken 在交易中保持不变。
 */
export function getPrice(s: BondingCurveState): number {
  if (s.virtualTokenReserves <= 0) {
    throw new Error("virtualTokenReserves must be > 0");
  }
  return s.virtualSolReserves / s.virtualTokenReserves;
}

/**
 * 模拟链上 quote 行为：根据用户要花的 SOL 算出能拿到的 token 数。
 * 不修改状态 —— 与真实链上"先 quote 再决定是否下单"的工作流一致。
 *
 * 推导：交易前后 k 不变
 *   virtualSol'  = virtualSol + solAmount
 *   virtualToken'= virtualToken - tokensOut
 *   (virtualSol + solAmount) * (virtualToken - tokensOut) = virtualSol * virtualToken
 *   tokensOut = virtualToken - virtualSol * virtualToken / (virtualSol + solAmount)
 *             = virtualToken * solAmount / (virtualSol + solAmount)
 */
export function quoteBuy(s: BondingCurveState, solAmount: number): number {
  if (s.complete) throw new Error("curve is already migrated, no more buys");
  if (solAmount <= 0) throw new Error("solAmount must be > 0");
  const k = s.virtualSolReserves * s.virtualTokenReserves;
  const newVirtualSol = s.virtualSolReserves + solAmount;
  const newVirtualToken = k / newVirtualSol;
  return s.virtualTokenReserves - newVirtualToken;
}

/** 卖出报价：根据用户要卖的 token 数算出能拿到的 SOL。 */
export function quoteSell(s: BondingCurveState, tokenAmount: number): number {
  if (s.complete) throw new Error("curve is already migrated, no more sells");
  if (tokenAmount <= 0) throw new Error("tokenAmount must be > 0");
  const k = s.virtualSolReserves * s.virtualTokenReserves;
  const newVirtualToken = s.virtualTokenReserves + tokenAmount;
  const newVirtualSol = k / newVirtualToken;
  return s.virtualSolReserves - newVirtualSol;
}

/* ----------------------------- 状态变更 ----------------------------- */

/**
 * 买入：用户投入 solAmount 的 SOL，拿到对应数量的 token。
 * 同步更新 virtual reserve、real reserve。返回实际到账的 token 数。
 */
export function buy(state: BondingCurveState, solAmount: number): number {
  if (state.complete) {
    throw new Error("curve is already migrated, buy is disabled");
  }
  if (solAmount <= 0) {
    throw new Error("solAmount must be > 0");
  }

  const tokensOut = quoteBuy(state, solAmount);

  // 防止"空转"：剩余 token 不能多于 realTokenReserves
  if (tokensOut > state.realTokenReserves) {
    throw new Error(
      `insufficient real token reserves: requested ${tokensOut}, have ${state.realTokenReserves}`
    );
  }

  state.virtualSolReserves += solAmount;
  state.virtualTokenReserves -= tokensOut;
  state.realSolReserves += solAmount;
  state.realTokenReserves -= tokensOut;

  return tokensOut;
}

/**
 * 卖出：用户卖 tokenAmount 的 token，拿到对应数量的 SOL。
 *
 * 本函数只模拟 curve 池子的状态变更；用户是否真的持有 token，
 * 应由调用方根据用户 token account / 测试中的 userTokens 另行校验。
 */
export function sell(state: BondingCurveState, tokenAmount: number): number {
  if (state.complete) {
    throw new Error("curve is already migrated, sell is disabled");
  }
  if (tokenAmount <= 0) {
    throw new Error("tokenAmount must be > 0");
  }

  const solOut = quoteSell(state, tokenAmount);

  if (solOut > state.realSolReserves) {
    throw new Error(
      `insufficient real SOL reserves: requested ${solOut}, have ${state.realSolReserves}`
    );
  }

  state.virtualTokenReserves += tokenAmount;
  state.virtualSolReserves -= solOut;
  state.realTokenReserves += tokenAmount;
  state.realSolReserves -= solOut;

  // 卖出不应低于 0
  if (state.realSolReserves < 0) {
    throw new Error("realSolReserves would go negative — sell too large");
  }

  return solOut;
}

/* ------------------------ Liquidity Migration ----------------------- */

/**
 * 检查是否达到迁移阈值。真实 Pump.fun 阈值约为 85 SOL（v1），
 * 本模拟用可配置参数（默认 85，便于读者对照）。
 */
export function isMigratable(state: BondingCurveState, threshold: number): boolean {
  return state.realSolReserves >= threshold;
}

/**
 * 迁移：把 complete 置 true。
 * 教学上模拟"把池子里的 SOL+token 注入到 Raydium 建池"。
 * 真实 Pump.fun 在这一步会：
 *   1. 把 curve PDA 里的 SOL + token 转给 Raydium AMM
 *   2. 销毁 LP
 *   3. 后续交易走 Raydium 路由
 * 本模拟不模拟上述 CPI 步骤，只翻状态标志。
 */
export function migrate(state: BondingCurveState, threshold: number): boolean {
  if (state.complete) return false;
  if (!isMigratable(state, threshold)) {
    throw new Error(
      `not yet migratable: realSolReserves=${state.realSolReserves}, threshold=${threshold}`
    );
  }
  state.complete = true;
  return true;
}

/* -------------------------- 格式化输出辅助 -------------------------- */

/** 调试输出用，真实链上没有。 */
export function snapshot(state: BondingCurveState): string {
  return (
    `price=${getPrice(state).toExponential(4)} SOL/token | ` +
    `vSOL=${state.virtualSolReserves.toFixed(2)} | ` +
    `vTok=${state.virtualTokenReserves.toFixed(2)} | ` +
    `rSOL=${state.realSolReserves.toFixed(2)} | ` +
    `rTok=${state.realTokenReserves.toFixed(2)} | ` +
    `complete=${state.complete}`
  );
}
