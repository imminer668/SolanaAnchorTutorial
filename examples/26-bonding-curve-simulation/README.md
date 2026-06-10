# Lesson 26 — Bonding Curve 教学模拟（Pump.fun 风格）

> 教学简化模型，**不复刻真实 Pump.fun 协议源码**。
> 本课程面向 EVM（Solidity / Foundry）经验背景的 Solana 新手，用 ~200 行 TypeScript 把 bonding curve 的数学结构与状态机讲清楚。

---

## 教学声明（请先读）

- 本仓库代码是 **教学模型**，不构成任何投资建议。
- 真实 Pump.fun v1 阶段使用 virtual reserve + constant product (x\*y=k) 公式，并在 `realSolReserves >= 85 SOL` 左右时把流动性迁到 Raydium。本模拟沿用这一公开的公式思想，但省略了：
  - 协议手续费、平台抽成、creator 分成
  - SPL Token 实际铸造 / 销毁的 CPI 流程
  - PDA 账户、签名校验、rent 管理等链上细节
  - 链上错误处理、事件、约束
- **不会消耗任何 SOL，不会连接 Solana 网络，纯本地内存模拟。**

更详细的对齐与差异分析见 [docs.md](./docs.md)。

---

## 公式选择

采用 **Pump.fun 公开文档中描述的 virtual reserve + constant product**：

```
k = virtualSolReserves * virtualTokenReserves   (恒定)
price(1 token) = virtualSolReserves / virtualTokenReserves
tokensOut(solIn)  = virtualToken - k / (virtualSol + solIn)
solOut(tokensIn)  = virtualSol - k / (virtualToken + tokensIn)
```

与 Uniswap V2 的区别：这里的 `virtual*` 是协议"凭空"注入的初始储备，用来定锚初始价格；`real*` 才反映用户实际投入/提取的资金。链上 Pump.fun 真正铸造的 token 量由 `realTokenReserves` 决定。

---

## 文件结构

```
26-bonding-curve-simulation/
├── package.json          # ts-node + typescript，仅此而已
├── tsconfig.json
├── .gitignore
├── README.md             # 本文件
├── docs.md               # 架构拆解 / EVM 对照 / 与真实 Pump.fun 的差距
├── src/
│   ├── curve.ts          # 核心：状态、quote、buy、sell、migrate
│   └── index.ts          # 可执行 demo
└── tests/
    └── curve.test.ts     # node:test 单元测试（4 个核心 + 1 个边界）
```

---

## 运行步骤

需要 Node 18+ 与 npm。

```bash
cd examples/26-bonding-curve-simulation
npm install         # 仅安装 ts-node + typescript
npm run demo        # 跑 src/index.ts 的可执行 demo
```

预期输出：演示 7 个步骤（初始 → 多次 buy → 中途 sell → 累计 buy 到阈值 → migrate → 迁移后 buy/sell 抛错）。

---

## 测试

使用 Node 内置 `node:test`，**无需安装 vitest / mocha**。

```bash
npm test
```

等价于：

```bash
ts-node --transpile-only tests/curve.test.ts
```

测试用例：

1. 初始价格 = virtualSol / virtualToken；零金额交易抛错
2. 买入后价格上升；k（虚拟储备乘积）守恒
3. 卖出后价格下降；`sell()` 与 `quoteSell()` 自洽
4. 累计 realSolReserves 达到 threshold 后 `migrate()` 翻 `complete`；迁移后 buy/sell 抛错
5. （边界）不能卖出超过曲线持有的 token；多次交易后 k 仍守恒

---

## 不会做的事

- 不会安装 `anchor-lang` / `@coral-xyz/anchor` / `@solana/web3.js`
- 不会连接任何 Solana RPC
- 不会消耗 SOL
- 不会保存任何状态到磁盘
- 不会复刻真实 Pump.fun 的链上源码

---

## 下一步学习

- Lesson 27: `examples/27-simple-perp-model/` —— Drift 风格永续合约的简化模型
- Lesson 21: `docs/21-anchor-security.md` —— 真实链上 Anchor 的安全模式
