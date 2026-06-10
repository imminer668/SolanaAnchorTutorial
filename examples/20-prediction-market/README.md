# Lesson 20 - Prediction Market

> 简化版二元市场：用户对 Yes/No 下注，authority 截止后 resolve，赢家按比例分得整个池子。

## 项目结构

```
20-prediction-market/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── prediction_market/
│       └── src/lib.rs
└── tests/
    └── prediction-market.ts
```

## 功能

- `create_market(market_id, question, end_time)`：创建二元市场 + vault
- `place_bet(outcome, amount)`：用户下注到 OutcomeA 或 OutcomeB
- `resolve(winning_outcome)`：authority 设定获胜方
- `claim()`：赢家按比例分得整个池子

## 关键设计

- **Market PDA**：`seeds = [b"market", authority, quote_mint, market_id]`
- **vault PDA**：`seeds = [b"vault", market]`，TokenAccount，authority = vault (PDA)
- **Position PDA**：`seeds = [b"position", market, user]` → 一用户一份
- **CPI 发放**：vault → user_quote_ata，由 vault PDA 签名
- **奖励公式**：`reward = (user.amount / winning_total) * total_pool`
- **时间窗口**：`create_market` 要求 `end_time > now`；`place_bet` 要求 `now < end_time`；`resolve` 要求 `now >= end_time`

## 测试

```bash
yarn install
anchor build
anchor test
```

通过：8 tests passing

## Program ID

```
Dz6GHpezahf3zoHwdBqpaGNNuRwqx15K1hoyvSm2Zmfz
```

## 详细文档

参见 [docs.md](./docs.md)。
