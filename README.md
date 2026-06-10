# EVM 开发者转型 Solana Anchor 实战教程

> 从 Solidity 到 Anchor，从 ERC20 到 SPL Token，从 Uniswap 到 Solana DeFi
>
> 面向具备 Solidity 开发经验的 Web3 开发者，通过 EVM 与 Solana 对照学习方式，快速掌握 Solana Program 开发、Anchor 框架、SPL Token、NFT、全栈开发与生产环境最佳实践。

## 课程定位

本教程不是普通的 Solana 入门文档，而是为**已经会 Solidity / Foundry / EVM** 的 Web3 开发者量身打造的 Solana Anchor 迁移教程。每个 Solana 概念都配有 EVM 类比，并明确说明类比边界。

## 目标读者

- Solidity 开发者
- Foundry 开发者
- ETH / Base / Arbitrum 开发者
- Web3 全栈开发者
- 希望从 EVM 转型 Solana 的开发者

## 教程目标

完成本教程后，读者能够：

- 理解 Solana Account Model
- 熟练使用 Anchor 开发 Program
- 掌握 PDA、CPI、SPL Token
- 独立开发 Solana DApp
- 独立开发 Launchpad、Escrow、Voting 等项目
- 阅读 Jupiter、Pump.fun、Drift 等项目源码

## 目录结构

```
.
├── docs/                  # 文档类课程（6 份）
│   ├── 01-evm-vs-solana.md
│   ├── 02-common-pitfalls.md
│   ├── 03-evm-solana-mapping.md
│   ├── 11-erc721-metaplex.md
│   ├── 21-anchor-security.md
│   └── 25-jupiter-architecture.md
├── examples/              # Anchor 与教学模拟项目
│   ├── 04-counter/                   # Anchor：Counter
│   ├── 05-account-space/             # Anchor：Account Space
│   ├── 06-pda-user-profile/          # Anchor：PDA 取代 mapping
│   ├── 07-cpi-transfer-sol/          # Anchor：CPI 入门
│   ├── 08-spl-token/                 # Anchor：SPL Token
│   ├── 09-token2022/                 # Anchor：Token2022 三扩展
│   ├── 10-meme-coin/                 # Anchor：Meme Coin
│   ├── 12-nft-mint/                  # Anchor：NFT Mint Account 基础
│   ├── 16-escrow/                    # Anchor：Escrow
│   ├── 17-voting/                    # Anchor：Voting
│   ├── 18-airdrop/                   # Anchor：Airdrop
│   ├── 19-launchpad/                 # Anchor：Launchpad
│   ├── 20-prediction-market/         # Anchor：Prediction Market
│   ├── 22-anchor-testing/            # Anchor：测试体系
│   ├── 23-errors-events/             # Anchor：错误码与事件
│   ├── 26-bonding-curve-simulation/  # 教学模拟：Pump.fun
│   └── 27-simple-perp-model/         # 教学模拟：Drift
├── frontend/              # 前端示例项目（5 个）
│   ├── nextjs-anchor-counter/  # Lesson 13：Next.js + Anchor
│   ├── profile-demo/           # Lesson 14：前端推导 PDA
│   ├── spl-token-demo/         # Lesson 15：前端调用 SPL Token
│   ├── launchpad/              # Lesson 19：Launchpad 前端
│   └── prediction-market/      # Lesson 20：Prediction Market 前端
├── scripts/               # 部署脚本与运维文档
│   └── deploy-devnet.md        # Lesson 24：Devnet 部署指南
└── README.md             # 简介
```

## 环境要求

| 工具       | 版本       | 说明                       |
| ---------- | ---------- | -------------------------- |
| Node.js    | v24.0.1+   | 前端与 Anchor 客户端       |
| npm        | 11.3.0+    | 包管理                     |
| Rust       | 1.86.0+    | Anchor Program 编译        |
| Cargo      | 1.86.0+    | Rust 包管理                |
| Solana CLI | 2.1.22+    | 与链交互                   |
| Anchor CLI | 0.31.1+    | Anchor 框架                |

环境检查命令：

```bash
node --version
npm --version
rustc --version
cargo --version
solana --version
anchor --version
```

## 课程路线

教程分为 4 个阶段、共 27 节课：

### 阶段 1：第一阶段教程（建议优先完成）

| 课程 | 类型     | 主题                       |
| ---- | -------- | -------------------------- |
| 01   | 文档     | 为什么 Solana 和 EVM 完全不同 |
| 02   | 文档     | Solidity 开发者最容易踩的 10 个坑 |
| 03   | 文档     | EVM 与 Solana 概念对照表   |
| 04   | Anchor   | 第一个 Anchor Counter      |
| 06   | Anchor   | PDA 入门：实现 Mapping     |
| 07   | Anchor   | CPI 入门                   |
| 08   | Anchor   | ERC20 与 SPL Token         |
| 16   | Anchor   | Escrow 托管交易            |

### 阶段 2：完整基础体系

| 课程 | 类型     | 主题                       |
| ---- | -------- | -------------------------- |
| 05   | Anchor   | Account、Space 与 Discriminator |
| 09   | Anchor   | Token2022                  |
| 10   | Anchor   | 创建 Meme Coin             |
| 11   | 文档     | ERC721 与 Metaplex         |
| 12   | Anchor   | NFT Mint Account 基础      |
| 13   | 前端     | Next.js + Anchor           |
| 14   | 前端     | 前端推导 PDA               |
| 15   | 前端     | 前端调用 SPL Token         |

### 阶段 3：项目实战

| 课程 | 类型     | 主题                       |
| ---- | -------- | -------------------------- |
| 17   | Anchor   | Voting 投票系统            |
| 18   | Anchor   | Airdrop 空投系统           |
| 19   | Anchor+前端 | Launchpad               |
| 20   | Anchor+前端 | Prediction Market       |

### 阶段 4：安全、部署与源码拆解

| 课程 | 类型     | 主题                       |
| ---- | -------- | -------------------------- |
| 21   | 文档     | Anchor 安全开发            |
| 22   | Anchor   | Anchor 测试体系            |
| 23   | Anchor   | 错误码与事件               |
| 24   | 文档     | Devnet 部署                |
| 25   | 文档     | Jupiter 架构拆解           |
| 26   | 代码模拟 | Pump.fun Bonding Curve     |
| 27   | 代码模拟 | Drift 永续合约简化模型     |


## 如何使用本教程

### 方式一：按阶段顺序学习

1. 阅读阶段 1 文档（Lesson 01-03）
2. 完成阶段 1 代码项目（Lesson 04-08、16）
3. 进入下一阶段

### 方式二：按概念主题学习

- **理解 Solana 模型**：Lesson 01-03
- **Anchor 基础**：Lesson 04-07
- **Token 体系**：Lesson 08-10
- **NFT 体系**：Lesson 11-12（Lesson 12 聚焦 Mint Account 基础，不含完整 Metaplex）
- **前端开发**：Lesson 13-15
- **项目实战**：Lesson 16-20
- **安全与质量**：Lesson 21-23
- **部署与生产**：Lesson 24
- **源码拆解与模型**：Lesson 25-27（Jupiter 文档 / Pump.fun 教学模拟 / Drift 教学模拟）

## 验证命令

```bash
# Anchor 项目（lint 仅扫 tests/，避免误扫 target/types/）
cd examples/<lesson>/
npm install
anchor build
npm run lint          # prettier "tests/**/*.ts" --check
anchor test           # 自动起停本地 validator，端口 8899

# 前端项目
cd frontend/<project>/
npm install
npm run lint
npm run build

# 教学模拟项目（Lesson 26 / 27）
cd examples/26-bonding-curve-simulation/  # 或 27-simple-perp-model/
npm install
npm test
```

## 贡献与反馈

本教程配套的每一课均提供独立的 README.md 与 docs.md。建议在阅读时按课程顺序推进，在动手做项目时按各课 README 中的"验证命令"小节跑通测试，再继续下一节。

如果你发现错误或有改进建议，欢迎通过 Issue / PR 反馈。

---

**最后更新：** 2026-06-11
