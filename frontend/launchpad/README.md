# Lesson 19 - Launchpad Frontend

> Next.js + Wallet Adapter frontend for `examples/19-launchpad`.

## 功能

- Connect Wallet
- Create Pool
- Deposit Sale Token
- Contribute
- Claim
- Refund
- Withdraw
- Read Pool State
- Derive Pool / Vault / Contribution PDA

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

1. 先构建并部署 `examples/19-launchpad`。
2. 钱包中需要有 SOL 支付交易费。
3. `sale mint` 与 `quote mint` 必须已经存在。
4. 操作前建议先创建当前钱包的 sale ATA 与 quote ATA。

## Program ID

```text
5TSpDPCpCCoykzWMTLqq3Go6QVEQvBiCr5RgjAeVRnVM
```

## 说明

这是教学前端，重点展示 Solana 前端如何推导 PDA、组装账户并调用 Anchor Program。当前 Launchpad Program 的时间窗口逻辑仍需按阶段性验收报告继续整改。

详细说明见 [docs.md](./docs.md)。
