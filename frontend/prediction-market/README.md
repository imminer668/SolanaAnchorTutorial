# Lesson 20 - Prediction Market Frontend

> Next.js + Wallet Adapter frontend for `examples/20-prediction-market`.

## 功能

- Connect Wallet
- Create Market
- Create Quote ATA
- Place Bet
- Resolve Market
- Claim Reward
- Read Market State
- Derive Market / Vault / Position PDA

## 运行

```bash
npm install
npm run lint
npm run build
npm run dev
```

默认连接本地 validator：

```text
http://127.0.0.1:8899
```

切换 devnet：

```bash
NEXT_PUBLIC_NETWORK=devnet npm run dev
```

## 前置条件

1. 先构建并部署 `examples/20-prediction-market`。
2. 准备 quote mint。
3. 当前钱包需要有 quote token 余额。
4. 当前钱包需要有 SOL 支付交易费。

## Program ID

```text
Dz6GHpezahf3zoHwdBqpaGNNuRwqx15K1hoyvSm2Zmfz
```

## 说明

这是教学前端，重点展示如何用 `market_id` 推导市场 PDA、下注记录 PDA，并调用 Anchor Program。当前链上程序仍有阶段性验收报告中指出的时间窗口整改项。

详细说明见 [docs.md](./docs.md)。
