# Lesson 27 - 架构拆解 & EVM 对照

本文档回答三个问题：

1. 这个**教学模型**和真实 Drift 差在哪？
2. 同样的永续合约在 EVM 上和 Solana 账户模型上怎么对比？
3. 教学模型里 funding、PnL、清算的公式意味着什么？

---

## 1. 教学模型边界（明确**不**包含的内容）

| 真实 Drift v2 的能力 | 本教学模型 |
|---|---|
| Cross-margin（多资产组合保证金） | 不支持，只有一个 `collateral` 字段 |
| Spot collateral（用 USDC/SOL 直接当保证金） | 不支持，全部按"教学用 USD"计 |
| AMM（vAMM 做市） | 不支持，价格完全由 oracle 决定 |
| LP / Vault（保险基金 / 流动性池） | 不支持真实 vault，`ProtocolState.insuranceFund` 只是协议级计数器 |
| Pyth / Switchboard oracle 拉取与 staleness 检查 | 简化为直接赋值 |
| 多市场 cross-collateral netting | 不支持，每个仓位独立判断保证金率 |
| Keeper 奖励 / 清算竞争 | 不支持，`liquidate` 谁都能调 |
| Socialized loss 的真实分摊 | 记为 `ProtocolState.socializedLoss` 字段占位 |
| Oracle 置信区间 / TWAP | 不支持 |
| Funding 在仓位上的逐仓分摊 | 简化为 `calcFundingPnl` 辅助函数，未自动入账 |
| Position PDA、Market PDA、User PDA 拆分 | 全部用普通对象内存表示 |

**一句话**：本模型只是"把课本上的公式跑起来"，方便 EVM 开发者快速理解永续合约四件套（margin / oracle / liquidation / funding），**不是任何可以上链的代码**。

---

## 2. 账户模型：教学 vs Solana PDA

### 教学模型（用户状态 + 协议状态）

```ts
UserAccount {
  key, collateral, positions: Position[]
}

ProtocolState {
  insuranceFund, socializedLoss
}
```

用户状态和协议级风险状态分开。`UserAccount` 只保存用户自己的 collateral / positions，清算罚金和 socialized loss 归到 `ProtocolState`。

### 真实 Solana / Anchor 应怎么拆账户

如果把这个教学模型改造成上链的 Anchor 程序，至少应拆成：

| 账户 | 类型 | 谁拥有 | 用途 |
|---|---|---|---|
| `Market` PDA | 状态 | 协议 | 存 oracle 地址、funding 累计、风险参数 |
| `User` PDA | 状态 | 用户 | 存用户 collateral、sub-account 索引 |
| `Position` PDA | 状态 | 用户 | 每个仓位一个 PDA（seeds: `[user, market, sub_account_id]`） |
| `InsuranceFund` PDA | 状态 | 协议 | 存保险基金余额、socialized loss 记账 |
| `Oracle` 账户 | 只读 | Pyth | 喂价；CPI 拉取 price |

**关键点**：Solana 上"开仓"实际上是**为该仓位派生一个 PDA 并初始化账户数据**。EVM 里只是合约里 `mapping` 加一项；Solana 里多了一步"创建新账户 + 付 rent"。

### 教学模型与 Anchor 化的差异

| 维度 | 教学模型 | Anchor 化后 |
|---|---|---|
| 状态存储 | 普通对象 | PDA + `Account<'info, Position>` 校验 |
| 价格来源 | 字段赋值 | CPI 调 Pyth `get_price` |
| 保证金扣减 | `user.collateral -=` | SPL Token 转账到 vault PDA |
| 清算 | 普通函数调用，罚金进入 `ProtocolState` | keeper 提交交易 + 校验 `invoke_signed`，罚金进入保险基金 PDA |
| Funding 累计 | `market.cumulativeFunding +=` | 同字段，但每个 funding interval 由 `clock::Clock` 触发 |
| 事件 | 无 | `emit!(PositionLiquidated { ... })` |
| 错误 | throw `PerpError` | `err!(ErrorCode::MarginHealthy)` 配合自定义 Anchor error |

---

## 3. EVM 永续合约对照

| 项目 | 链 | 模型 | Oracle | Funding | 清算 |
|---|---|---|---|---|---|
| **dYdX v3** | StarkEx (L2) | Cross-margin | 链下喂价 | 每 1 小时 | 保险基金 |
| **GMX v1** | Arbitrum / Avalanche | GLP 做市（无 vAMM） | Chainlink | 无 funding（用 GLP PnL） | keeper |
| **GMX v2** | Arbitrum | Synthetic + multi-asset | Chainlink | 有 | 部分清算 + keeper 奖励 |
| **Perpetual Protocol v2** | Optimism | vAMM | Chainlink | 有 | 保险基金 |
| **Drift v2（本课主题）** | Solana | Cross-margin + vAMM | Pyth | 有 | 部分清算 + socialized loss |
| **本教学模型** | 内存 | Isolated | 字段赋值 | 简化版 | 全仓清算 |

### 共同点（所有永续合约都跑不掉）

1. 必须有 **margin + mark price + index price**（教学模型里只有 oraclePrice 一个概念，没有 mark/index 之分）。
2. 必须有 **maintenance margin ratio**：低于则可清算。
3. 必须有 **funding rate**：让合约价向指数价收敛。
4. 必须有 **保险基金 / socialized loss**：吸收穿仓损失。

### EVM ↔ Solana 关键差异

- **状态拆分粒度**：EVM 一个合约搞定所有用户，Solana 拆成 PDA。EVM 改一个用户状态是 SSTORE；Solana 是 CPI 或直接写 PDA。
- **oracle 集成**：EVM Chainlink `latestRoundData()` 一次链下推送 + 链上读取；Solana Pyth `PriceUpdateV2` 账户 + `get_price`。
- **Keeper 模式**：两边都依赖 keeper 抢清算，Solana 靠 priority fee，EVM 靠 gas auction。
- **Composability**：EVM 同合约直接 `function.call()`；Solana 必须用 CPI，签名和账户校验更繁琐。

---

## 4. Drift 官方真实实现的关键差异

> 参考：<https://github.com/drift-labs/protocol-v2>

Drift v2 包含本教学模型**完全没有**的几大块：

### 4.1 Cross-Margin（核心）

Drift 的核心创新是**多市场 portfolio margin**：

- 用户的所有仓位合并计算 `total collateral / total notional * leverage`。
- 一个仓位爆仓时，**其他仓位的盈利**会自动补贴。
- 教学模型：每个 `Position` 独立判断保证金率，**没有 portfolio 概念**。

### 4.2 Spot + Perp 混合账户

- Drift 允许用户用 SOL / USDC 现货当 perp 抵押。
- 现货交易走 AMM，永续走 vAMM，但**保证金账户是同一个**。
- 教学模型：只支持虚拟 USD `collateral`。

### 4.3 Oracle：Pyth

- Drift 全部市场用 Pyth，价格带 `confidence` 字段。
- 教学模型：`updateOraclePrice(market, newPrice)` 没有任何 staleness / confidence 检查。

### 4.4 vAMM 做市

- Drift 的永续合约用 vAMM（virtual AMM）撮合：用户之间互为对手方，AMM 公式决定成交价。
- 教学模型：没有撮合概念，价格完全是 oracle 价。

### 4.5 LP / Insurance Stake

- 用户可以把 USDC 存进保险基金赚取 staking 收益。
- 保险基金不够时，stake 的人承担 socialized loss。
- 教学模型：`ProtocolState.insuranceFund` 只是协议级计数器，不涉及 LP 收益。

### 4.6 部分清算

- 当保证金率接近 0 时，keeper 只清算一部分仓位（不会全平），减少对市场的冲击。
- 教学模型：调用一次 `liquidate` 就把整个 `Position` 删掉。

### 4.7 复杂风险参数

Drift 的 risk engine 至少有：
- `partial_liquidation_ratio`（部分清算比例）
- `full_liquidation_margin_ratio`（强制全平的阈值）
- `max_slippage`（清算时的滑点容忍）
- `margin_mode`（isolated / cross 切换）

教学模型只有 `maintenanceMarginRatio = 0.05` 和 `liquidationPenaltyRate = 0.025`。

---

## 5. Funding Rate 概念与"锚定机制"

### 永续合约为什么需要 funding

- 永续合约没有到期日，**没有自然收敛机制**。
- 现货价格 $P_s$，合约价格 $P_p$。如果 $P_p > P_s$，多头"过度看多"，空头在承担"溢价"风险。
- funding 是**多头付给空头**（funding > 0）或反之的周期性支付。
- 通过 funding 套利者把 $P_p$ 拉回 $P_s$ 附近。

### 教学模型公式

```text
skew = (longOI - shortOI) / (longOI + shortOI)
funding_rate = skew * (Δt / funding_interval) * 0.01
```

- `skew > 0`（多 > 空）→ funding > 0 → 多头付钱给空头 → 抑制多头。
- `skew < 0`（空 > 多）→ funding < 0 → 空头付钱给多头 → 抑制空头。
- 这是 Drift 公式的**极大简化版**。真实 Drift 还要做 `mark_price - index_price` 的修正、TWAP 滤波、cap / floor 限制。

### Funding 在仓位上的影响

教学模型中 `calcFundingPnl(position, cumulativeFunding)` 给出了近似：

```text
fundingPnl = -sign(side) * cumulativeFunding * size * entryPrice
```

真实 Drift 的 funding PnL 是**逐仓逐时刻**累加的，并通过 `settle_funding` 指令周期性入账。教学模型没自动入账，需要外部循环调用。

---

## 6. 给 EVM 开发者的迁移建议

1. **先理解账户模型**：Solana 没有 `mapping`，状态都在 PDA 里。第一次写 Anchor 时最大的心智负担是"哪些字段放在哪个账户"。
2. **不要再用 Solidity 的 `modifier` 思维**：Anchor 用 `#[account]` 约束 + 显式 CPI。
3. **Oracle 必学 Pyth**：Solana 生态几乎都是 Pyth。Chainlink 在 Solana 上也有，但 Pyth 是 native。
4. **风险参数要单独建一个 config 账户**：Drift 的 `State` 账户承载了所有 market 共享参数；教学模型里只是普通对象。
5. **清算竞争**：Solana 上通过 priority fee 抢清算；EVM 上通过 gas price。逻辑相同，机制不同。
6. **先写 pure function，再上链**：本教学模型就是这种思路——把公式和状态变更写成纯函数，方便测试，再翻译成 Anchor 指令。

---

## 7. 已知限制（需要人工验收）

- **没有 decimal 精度**：教学模型所有数字都是 JS `number`（IEEE 754）。真实上链必须用 `u64` / `i64` 配 `PRICE_PRECISION / 1e6` 这样的精度因子。
- **funding 自动入账**：`applyFunding` 只累加 `cumulativeFunding`，不自动把 funding PnL 计入 `user.collateral`。教学模型留作练习。
- **清算罚金没有给 keeper**：全部进保险基金。真实 Drift 拆成 keeper 奖励 + 保险基金。
- **单市场**：教学模型里 `market` 参数是字符串，没有真正的多市场协同。
- **没有时间戳来源**：教学模型 `applyFunding` 接收 `now: number`，真实环境用 `Clock::get()?.unix_timestamp`。

> **结论**：本教学模型只覆盖永续合约的"骨架公式"。要把任何一段搬上链，都需要重新设计账户布局、加精度、加 oracle 校验、加事件、加 keeper 激励。
