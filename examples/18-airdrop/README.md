# Lesson 18 - Airdrop 空投系统

> 完整 airdrop program：authority 存代币到 vault，用户 claim 一份，PDA 防重复。

## 项目结构

```
18-airdrop/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── airdrop/
│       └── src/lib.rs
└── tests/
    └── airdrop.ts
```

## 功能

- `create_airdrop(claim_amount, total_deposit)`：authority 创建 airdrop 并存入代币
- `claim()`：用户 claim 一份；ClaimRecord PDA 防重复

## 关键设计

- **Airdrop PDA**：`seeds = [b"airdrop", authority, mint]`
- **Vault PDA**：`seeds = [b"vault", airdrop]`，TokenAccount，authority = vault (PDA)
- **ClaimRecord PDA**：`seeds = [b"claim", airdrop, claimer]` → 防重复
- **CPI 发放**：vault → claimer_ata，由 vault PDA 签名

## 测试

```bash
yarn install
anchor build
anchor test
```

通过：5 tests passing

## Program ID

```
Et5PcfcE4j6qcrKxGp7FvaHeMNdJLg47UxjupXxyqsHx
```

## 详细文档

参见 [docs.md](./docs.md)。
