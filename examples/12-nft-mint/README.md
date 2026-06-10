# Lesson 12 - NFT Mint Account 基础

> 演示 Solana NFT 的最小链上基础：Mint(supply=1, decimals=0) + Token Account。  
> 本课不创建 Metaplex Metadata Account / Master Edition；它们作为概念讲解和后续扩展。

## 项目结构

```
12-nft-mint/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── nft-mint/
│       └── src/lib.rs
└── tests/
    └── nft-mint.ts
```

## 功能

- **TS 端**：组合 SPL Token 指令一次性创建 NFT mint
  - 创建 mint account
  - 初始化 mint（decimals=0）
  - 创建 ATA
  - mint 1 个 token 到 owner
  - 推导 Metaplex Metadata / Master Edition PDA
- **Anchor program**：`stamp_owner` 指令，链上记录"该 NFT 已被某地址声明"

## 关键设计

- NFT = Mint(supply=1, decimals=0) + Token Account(amount=1)
- Metadata / Master Edition 由 Metaplex Token Metadata Program 管理，本课只推导 PDA，不在本地 validator 中创建这些账户
- 业务逻辑（stamp_owner）和 token 标准解耦

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

测试覆盖：

1. 创建 NFT mint 并验证 supply=1, decimals=0
2. 验证 owner 持有 1 个 token
3. 验证 metadata PDA 派生正确
4. 验证本课未创建 metadata account
5. 调用 Anchor program 的 `stamp_owner`

## Program ID

```
3xJ79W2kFQSPetcKpAPXjvo6ixDSr5iVz2prJdFJk2V2
```

## 说明

本课程序只负责**业务侧**（stamp_owner），当前实现不是完整 Metaplex NFT mint。

完整 Metaplex NFT 还需要：

- 创建 Metadata Account
- 创建 Master Edition Account
- 设置 update authority
- 可选地关闭 mint authority

在本地 `anchor test` 中实现完整流程通常需要把 Metaplex Token Metadata Program 部署或加载到 local validator。本课先聚焦 EVM 开发者最容易混淆的部分：Solana NFT 的所有权并不在 ERC721 合约 storage 中，而在 Mint + Token Account 组合中。

## 详细文档

参见 [docs.md](./docs.md)
