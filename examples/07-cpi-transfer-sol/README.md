# Lesson 07 - CPI Transfer SOL

> 用 CPI（Cross-Program Invocation）实现 SOL 存取款：存款走 `system_program::transfer`，取款用 PDA 模拟签名。

## 项目结构

```
07-cpi-transfer-sol/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── cpi-transfer-sol/
│       └── src/lib.rs
└── tests/
    └── cpi-transfer-sol.ts
```

## 功能

- `initialize_vault()`：创建 Vault PDA
- `deposit(amount)`：把 SOL 转入 Vault（CPI）
- `withdraw(amount)`：从 Vault 转出 SOL（PDA 模拟签名）

## PDA 设计

```rust
seeds = [b"vault", authority.key().as_ref()]
```

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
B2dbDCQi2EfJF2Wk8j9d7XWmofFd34XrV7KQNQ8vzc2
```

## 详细文档

参见 [docs.md](./docs.md)
