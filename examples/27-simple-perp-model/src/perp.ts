/**
 * Lesson 27 - 教学简化的 Drift 永续合约模型
 *
 * 这是一个**纯函数式的内存模拟**，目的是教学。
 * 不复刻真实 Drift 协议，不上链，不包含：
 *   - cross-margin（多资产组合保证金）
 *   - spot collateral / AMM
 *   - LP / vault
 *   - 真实 Pyth oracle 拉取
 *
 * 所有数值单位为"教学用 USD"，没有 decimals 精度处理。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Side = "long" | "short";

/** 一笔永续合约持仓 */
export interface Position {
  /** 仓位所有者标识（教学模型里就是 user key） */
  user: string;
  /** 市场名，比如 "SOL-PERP" */
  market: string;
  /** 多 / 空 */
  side: Side;
  /** 持仓数量（base asset 单位，例如 10 表示 10 SOL） */
  size: number;
  /** 开仓均价（USD） */
  entryPrice: number;
  /** 初始保证金（已锁定在仓位里） */
  margin: number;
  /** 杠杆倍数，例如 5 表示 5x */
  leverage: number;
}

/** 一个永续市场状态 */
export interface Market {
  name: string;
  /** 最新 oracle 价格（USD） */
  oraclePrice: number;
  /** 上次 funding 累计的时间（unix ms，模拟用） */
  lastFundingTime: number;
  /**
   * 当前 funding rate（每 8 小时 1 次）
   * 正数 = 多头付给空头；负数 = 空头付给多头
   */
  fundingRate: number;
  /** 累计 funding（简化版：所有时段 rate 之和），用于 PnL 计算 */
  cumulativeFunding: number;
}

/** 一个用户的账户状态 */
export interface UserAccount {
  /** 用户标识 */
  key: string;
  /** 可用保证金（USD） */
  collateral: number;
  /** 用户当前所有未平仓 */
  positions: Position[];
}

/** 协议级状态：保险基金与 socialized loss 不属于单个用户。 */
export interface ProtocolState {
  /** 保险基金累计（仅累计清算罚金，不抵消 socialized loss） */
  insuranceFund: number;
  /**
   * Socialized loss 占位（教学用）：当清算时 equity < 罚金，差额由保险基金"补"，
   * 真实 Drift 用 socialized loss 让所有盈利用户分摊。
   * 教学模型为了清晰，单独记账。
   */
  socializedLoss: number;
}

/** 风险参数 */
export interface RiskParams {
  /** 维持保证金率阈值（5%） */
  maintenanceMarginRatio: number;
  /** 清算罚金率（2.5% 罚金进入保险基金，按名义价值计算） */
  liquidationPenaltyRate: number;
  /** Funding 时长（毫秒），默认 8 小时 */
  fundingIntervalMs: number;
}

export const DEFAULT_RISK_PARAMS: RiskParams = {
  maintenanceMarginRatio: 0.05,
  liquidationPenaltyRate: 0.025,
  fundingIntervalMs: 8 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class PerpError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "PerpError";
  }
}

// ---------------------------------------------------------------------------
// 开仓
// ---------------------------------------------------------------------------

/**
 * 开仓。函数会：
 *   1. 计算所需初始保证金 = size * entryPrice / leverage
 *   2. 校验账户可用 collateral 足够
 *   3. 扣减 collateral，记入 Position.margin
 *
 * entryPrice 默认采用当前 market.oraclePrice（即"市价单"）。
 */
export function openPosition(
  user: UserAccount,
  market: Market,
  side: Side,
  size: number,
  leverage: number,
  opts: { entryPrice?: number; risk?: RiskParams } = {},
): Position {
  const risk = opts.risk ?? DEFAULT_RISK_PARAMS;

  if (!(size > 0)) {
    throw new PerpError("size 必须 > 0", "INVALID_SIZE");
  }
  if (!(leverage >= 1)) {
    throw new PerpError("leverage 必须 >= 1", "INVALID_LEVERAGE");
  }
  if (!(market.oraclePrice > 0)) {
    throw new PerpError("market.oraclePrice 必须 > 0", "INVALID_ORACLE_PRICE");
  }

  const entryPrice = opts.entryPrice ?? market.oraclePrice;
  const notional = size * entryPrice;
  const initialMargin = notional / leverage;

  if (user.collateral < initialMargin) {
    throw new PerpError(
      `保证金不足: 需要 ${initialMargin}, 可用 ${user.collateral}`,
      "INSUFFICIENT_MARGIN",
    );
  }

  // 扣减可用抵押
  user.collateral -= initialMargin;

  const position: Position = {
    user: user.key,
    market: market.name,
    side,
    size,
    entryPrice,
    margin: initialMargin,
    leverage,
  };

  user.positions.push(position);
  return position;
}

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/**
 * 更新 oracle 价格。教学模型里直接赋值；
 * 真实生产中应接入 Pyth / Switchboard 并做 stale 校验、置信区间检查。
 */
export function updateOraclePrice(market: Market, newPrice: number): void {
  if (!(newPrice > 0)) {
    throw new PerpError("oracle 价格必须 > 0", "INVALID_ORACLE_PRICE");
  }
  market.oraclePrice = newPrice;
}

// ---------------------------------------------------------------------------
// PnL & 保证金率
// ---------------------------------------------------------------------------

/** 计算未实现盈亏（不含 funding） */
export function calcUnrealizedPnl(position: Position, currentPrice: number): number {
  if (position.side === "long") {
    return (currentPrice - position.entryPrice) * position.size;
  }
  return (position.entryPrice - currentPrice) * position.size;
}

/**
 * 保证金率 = (初始 margin + 未实现 PnL) / 名义价值。
 * 本简化函数不含 funding PnL；真实协议会在 settle funding 后再计算风险。
 * 用于和维持保证金率阈值比较。
 */
export function calcMarginRatio(
  position: Position,
  currentPrice: number,
  risk: RiskParams = DEFAULT_RISK_PARAMS,
): number {
  const notional = position.size * currentPrice;
  if (notional === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const equity = position.margin + calcUnrealizedPnl(position, currentPrice);
  return equity / notional;
}

// ---------------------------------------------------------------------------
// 清算
// ---------------------------------------------------------------------------

export interface LiquidationResult {
  /** 是否触发清算 */
  liquidated: boolean;
  /** 清算罚金（进入保险基金） */
  penalty: number;
  /** 剩余返还给用户的 equity（可能为 0 或负数 -> 全部吃下） */
  residual: number;
}

/**
 * 触发清算：保证率 < 维持保证金率时执行。
 *  - 平掉仓位（从 positions 中移除）
 *  - 罚金 = 名义价值 * liquidationPenaltyRate，注入保险基金
 *  - 残余 equity（可能为负）由保险基金吸收
 *
 * 真实 Drift 的清算更复杂：部分清算、keeper 奖励、socialized loss 等。
 */
export function liquidate(
  user: UserAccount,
  protocol: ProtocolState,
  position: Position,
  currentPrice: number,
  risk: RiskParams = DEFAULT_RISK_PARAMS,
): LiquidationResult {
  const marginRatio = calcMarginRatio(position, currentPrice, risk);

  if (marginRatio >= risk.maintenanceMarginRatio) {
    throw new PerpError(
      `保证金充足 (${(marginRatio * 100).toFixed(2)}% >= ${(
        risk.maintenanceMarginRatio * 100
      ).toFixed(2)}%)，不允许清算`,
      "MARGIN_HEALTHY",
    );
  }

  const notional = position.size * currentPrice;
  const penalty = notional * risk.liquidationPenaltyRate;

  const equity = position.margin + calcUnrealizedPnl(position, currentPrice);
  // residual: 把 equity 中非罚金部分返还给用户（教学模型中最多为 0）
  // 若 equity 已经为负，则保险基金"补贴"差额（仅记账，真实协议由 socialized loss 覆盖）
  const residual = Math.max(0, equity - penalty);

  // 移除仓位
  user.positions = user.positions.filter((p) => p !== position);
  // 释放 equity（残值）进用户账户
  user.collateral += residual;
  // 罚金注入协议级保险基金
  protocol.insuranceFund += penalty;
  // 若 equity 不足以覆盖罚金，差额记为 socialized loss（教学占位）
  if (equity < penalty) {
    protocol.socializedLoss += penalty - equity;
  }

  return { liquidated: true, penalty, residual };
}

// ---------------------------------------------------------------------------
// Funding Rate
// ---------------------------------------------------------------------------

/**
 * 教学版 funding rate 计算：
 *   skew = (longOI - shortOI) / (longOI + shortOI)
 *   ratePerInterval = skew * timeDelta / fundingInterval * 0.01
 *   累计到 market.cumulativeFunding
 *
 * 直观理解：多空越不平衡，资金费率越极端，把价格"拉回"现货指数。
 */
export function calcFunding(
  market: Market,
  timeDeltaMs: number,
  longOI: number,
  shortOI: number,
  risk: RiskParams = DEFAULT_RISK_PARAMS,
): number {
  if (!(timeDeltaMs >= 0)) {
    throw new PerpError("timeDelta 必须 >= 0", "INVALID_TIME_DELTA");
  }
  const totalOI = longOI + shortOI;
  if (totalOI === 0) {
    return 0;
  }
  const skew = (longOI - shortOI) / totalOI;
  // 按 funding interval 归一化后乘基础费率
  const rate =
    skew * (timeDeltaMs / risk.fundingIntervalMs) * 0.01;
  return rate;
}

/**
 * 把 funding 应用到 market：累加 cumulativeFunding，更新 lastFundingTime。
 */
export function applyFunding(
  market: Market,
  timeDeltaMs: number,
  longOI: number,
  shortOI: number,
  now: number,
  risk: RiskParams = DEFAULT_RISK_PARAMS,
): { rate: number; cumulative: number } {
  const rate = calcFunding(market, timeDeltaMs, longOI, shortOI, risk);
  market.fundingRate = rate;
  market.cumulativeFunding += rate;
  market.lastFundingTime = now;
  return { rate, cumulative: market.cumulativeFunding };
}

/**
 * 计算某仓位因为 funding 产生的 PnL（简化）：
 *   - 多头：funding > 0 时亏钱（pay），< 0 时赚钱（receive）
 *   - 空头：方向相反
 *   - PnL = -sign(side) * cumulativeFunding * size * entryPrice（教学近似）
 */
export function calcFundingPnl(position: Position, cumulativeFunding: number): number {
  const sign = position.side === "long" ? 1 : -1;
  return -sign * cumulativeFunding * position.size * position.entryPrice;
}
