# Lesson 27 - 教学简化的 Drift 永续合约模型

> 课程定位：《EVM 开发者转型 Solana Anchor 实战教程》第 27 课

## 教学声明

**本目录下的代码是一个教学简化模型，不是真实 Drift 协议的实现。**

- 纯内存模拟，**不上链**、**不部署**、**不消耗任何 SOL**。
- 风险引擎被极度简化：单一资产、无 cross-margin、无 spot、无 AMM、无 LP、无 keeper 奖励。
- 公式是教学用的近似表达，不直接对应 Drift Protocol v2 的内部数学。
- **不构成投资或交易建议**。永续合约涉及强平风险，请勿使用本教学模型做真实交易决策。

## 涵盖内容

1. **Margin** —— 初始保证金 = `size * entryPrice / leverage`；维持保证金率阈值 5%。
2. **Oracle** —— 简化的价格源（教学模型里就是普通字段，真实场景应接 Pyth / Switchboard）。
3. **Liquidation** —— 保证金率 < 5% 触发，罚金 2.5% 进保险基金；不足部分记为 socialized loss 占位。
4. **Funding Rate** —— 简化版按多空 OI 偏差计算，8 小时归一化。

## 目录结构

```text
examples/27-simple-perp-model/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── docs.md
├── src/
│   ├── perp.ts        # 核心实现（纯函数）
│   └── index.ts       # 可执行 demo
└── tests/
    └── perp.test.ts   # node:test 测试
```

## 运行命令

```bash
# 跑 demo
npm start

# 跑测试（5 个核心 + 3 个补充 = 8 个测试）
npm test
```

> 本项目使用 Node 内置的 `node:test`，无需安装测试框架。
> 复用同级 example 的 `node_modules`（包含 `ts-node`），
> 若需要独立环境可执行 `npm install`（仅 ts-node + typescript 两个 dev 依赖）。

## 测试覆盖

| # | 场景 | 期望 |
|---|------|------|
| 1 | openPosition 成功 | collateral 减少，positions 出现新仓位 |
| 2 | oracle 上涨 | 多头 PnL > 0；下跌 PnL < 0 |
| 3 | 保证金不足清算 | margin ratio < 5%，清算成功 |
| 4 | 保证金充足清算尝试 | 抛 `MARGIN_HEALTHY` 错误 |
| 5 | funding 可预测 | skew=0.2, full interval => rate=0.002 |

## 风险与免责

- 教学模型中的公式（funding、PnL、保证金率）是简化版，**不应当作生产级风险引擎**。
- 真实 Drift Protocol v2 的实现请参考：<https://github.com/drift-labs/protocol-v2>
- 任何"用教学模型回测出策略再上实盘"的做法都是不负责任的。
