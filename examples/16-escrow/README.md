# Lesson 16 - Escrow

> 托管交易：Maker 存 token_a，taker 用 token_b 换走。综合运用 PDA、CPI、SPL Token。

## 项目结构

```
16-escrow/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── escrow/
│       └── src/lib.rs
└── tests/
    └── escrow.ts
```

## 功能

- `create_escrow(id, amount_a, amount_b)`：maker 创建 escrow
- `deposit_token(amount)`：把 token_a 存到 vault
- `exchange()`：taker 用 token_b 换 token_a
- `cancel()`：maker 取消并取回 token_a

## 账户模型

```text
Maker
├── wallet (signer)
├── ATA for mint_a (存 token_a)
└── ATA for mint_b (收 token_b)

Taker
├── keypair (signer)
├── ATA for mint_a (收 token_a)
└── ATA for mint_b (存 token_b)

Escrow PDA
├── owner: program
└── data: { maker, mint_a, mint_b, amount_a, amount_b, ... }

Vault Token Account (PDA)
├── mint: mint_a
├── owner: escrow PDA (PDA 签名)
└── amount: 当前托管量
```

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
4JQsYPbpzcgiMmQaZMnLtu7h9pAWv51ARZg8H2vUps7s
```

## 详细文档

参见 [docs.md](./docs.md)
