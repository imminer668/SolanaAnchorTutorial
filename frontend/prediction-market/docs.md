# Prediction Market Frontend 文档

## 1. EVM 开发者视角

在 EVM 预测市场中，前端通常只围绕一个合约地址和 market id：

```solidity
market.placeBet(marketId, outcome, amount);
market.resolve(marketId, outcome);
market.claim(marketId);
```

在 Solana 中，前端需要显式提供：

```text
Market PDA
Vault PDA
Position PDA
User quote ATA
Token Program
```

前端推导账户是 Solana DApp 的核心能力之一。

## 2. PDA 推导

Market：

```ts
[b"market", authority, quote_mint, market_id]
```

Vault：

```ts
[b"vault", market]
```

Position：

```ts
[b"position", market, user]
```

EVM 类比：

```solidity
mapping(bytes32 => Market) markets;
mapping(bytes32 => mapping(address => Position)) positions;
```

Solana 的区别是每个 mapping entry 都是一个独立账户。

## 3. 页面结构

- Wallet：钱包状态与 Program ID
- Market Config：market id、question、quote mint、end time
- PDA Preview：market、vault、position、quote ATA
- Place Bet：选择 Outcome A / B 并下注
- Resolve：authority 设置胜出结果
- Claim：赢家领取奖励
- Market State：读取链上市场状态

## 4. 当前限制

阶段性验收报告中的时间窗口问题已同步到 Program：

- `create_market` 要求 `end_time > now`。
- `place_bet` 要求 `now < market.end_time`。
- `resolve` 要求 `now >= market.end_time`。

本前端已跟随当前 Program IDL 使用 `market_id` 推导 Market PDA，用于教学和调试，不代表生产级预测市场。

## 5. 验收

```bash
npm run lint
npm run build
```
