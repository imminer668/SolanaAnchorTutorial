# Lesson 19 - Launchpad

> 简化版 IDO 平台：authority 开池、用户用 quote token 出资、达到 soft cap 成功可领取 sale token、未达 soft cap 可退款。

## 项目结构

```
19-launchpad/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── launchpad/
│       └── src/lib.rs
└── tests/
    └── launchpad.ts
```

## 功能

- `create_pool(price, soft_cap, hard_cap, start_time, end_time)`：创建池 + 两个 vault
- `deposit_sale_token(amount)`：authority 把 sale token 转入 sale_vault
- `contribute(quote_amount)`：用户用 quote token 出资，UserContribution PDA 防重复
- `claim()`：soft cap 达成后用户可立即领取 sale token
- `refund()`：销售结束且未达 soft cap 时用户拿回 quote
- `withdraw()`：authority 提取（Succeeded→quote, Failed→sale）

## 关键设计

- **LaunchpadPool PDA**：`seeds = [b"pool", authority, sale_mint, quote_mint]`
- **sale_vault**：`seeds = [b"sale_vault", pool]`，authority = vault (PDA)
- **quote_vault**：`seeds = [b"quote_vault", pool]`，authority = quote_vault (PDA)
- **UserContribution PDA**：`seeds = [b"contribution", pool, user]` → 防重复出资
- **CPI 发放**：sale_vault → user_sale_ata / quote_vault → user_quote_ata，由 vault PDA 签名
- **状态机**：Active → Succeeded / Failed → Finalized
- **时间窗口**：`contribute` 要求 `start_time <= now < end_time`；`refund` 要求 `now >= end_time`；`claim` 在 soft cap 达成后即可领取

## 测试

```bash
yarn install
anchor build
anchor test
```

通过：7 tests passing

## Program ID

```
5TSpDPCpCCoykzWMTLqq3Go6QVEQvBiCr5RgjAeVRnVM
```

## 详细文档

参见 [docs.md](./docs.md)。
