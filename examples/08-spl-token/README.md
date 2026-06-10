# Lesson 08 - SPL Token

> SPL Token 教学：演示 Mint、ATA、mint_to、transfer。

## 项目结构

```
08-spl-token/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── spl-token/
│       └── src/lib.rs
└── tests/
    └── spl-token.ts
```

## 功能

- `create_mint()`：创建 9 位 decimals 的 Mint 账户
- `mint_token(amount)`：给某个 ATA 增发 token
- `transfer_token(amount)`：在两个 ATA 之间转账

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
BV1uAK93scCC1DYH4ikNxtRTmpsaaZe38b8tCxkydEgP
```

## 详细文档

参见 [docs.md](./docs.md)
