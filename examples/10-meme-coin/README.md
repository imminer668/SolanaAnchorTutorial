# Lesson 10 - 创建 Meme Coin

> 演示完整的 Meme Coin 发行流程：固定总量 → 一次性 mint → 团队/社区分配 → 锁仓。

## 项目结构

```
10-meme-coin/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── meme-coin/
│       └── src/lib.rs
└── tests/
    └── meme-coin.ts
```

## 功能

- `initialize(total_supply, team_amount, community_amount)`：创建 mint，一次性分发到 team + community
- `lock_mint()`：放弃 mint authority，让 supply 永久固定

## 关键设计

- **Mint authority = Config PDA**（不是 user keypair）
  - 优点：只有 program 能 mint
  - 代价：lock_mint 必须通过 PDA 签名
- **Supply 一次性 mint**：避免多次 mint CPI 调用
- **lock_mint 不可逆**：调用后任何人都不能再增发

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
HNNgNsMhapY7eVQp9voK98KFK7mmnokDoEowCwbVczxh
```

## 详细文档

参见 [docs.md](./docs.md)
