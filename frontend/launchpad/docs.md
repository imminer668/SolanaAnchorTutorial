# Launchpad Frontend 文档

## 1. EVM 开发者视角

在 EVM Launchpad 中，前端通常只需要一个合约地址：

```solidity
launchpad.contribute(poolId, amount);
launchpad.claim(poolId);
launchpad.refund(poolId);
```

合约内部通过 `mapping(poolId => Pool)` 与 `mapping(poolId => mapping(user => Contribution))` 找到状态。

在 Solana 中，前端必须显式推导并传入所有关键账户：

```text
LaunchpadPool PDA
Sale Vault PDA
Quote Vault PDA
UserContribution PDA
User sale ATA
User quote ATA
Token Program
```

这就是本前端的核心教学目标。

## 2. PDA 推导

Pool：

```ts
[b"pool", authority, sale_mint, quote_mint]
```

Sale Vault：

```ts
[b"sale_vault", pool]
```

Quote Vault：

```ts
[b"quote_vault", pool]
```

User Contribution：

```ts
[b"contribution", pool, user]
```

EVM 类比：

```solidity
mapping(bytes32 => Pool) pools;
mapping(bytes32 => mapping(address => Contribution)) contributions;
```

Solana 的区别是：这些 mapping entry 都是独立账户，前端必须把地址算出来并传给交易。

## 3. 页面结构

- Wallet：钱包状态与 Program ID
- Pool Config：sale mint、quote mint、price、soft cap、hard cap、start/end time
- PDA Preview：展示前端推导出的 PDA
- Prepare ATA：创建当前钱包的 sale / quote ATA
- Fund / Buy：deposit sale token、contribute
- Settle：claim、refund、withdraw
- Pool State：读取链上 pool account

## 4. 交易边界

本前端不会创建 mint，也不会 mint 测试 token。你需要先准备：

- sale mint
- quote mint
- 当前钱包的 sale token 余额
- 当前钱包的 quote token 余额

这保持了课程边界：前端只演示如何调用 Launchpad Program，不把 SPL Token 创建流程重复实现一遍。

## 5. 当前限制

阶段性验收报告中的时间窗口问题已同步到 Program：

- `contribute` 要求 `start_time <= now < end_time`。
- `refund` 要求 `now >= end_time` 且未达 soft cap。
- `claim` 明确允许 soft cap 达成后立即领取，不强制等待 `end_time`。

因此本前端可用于教学和本地调试，但不代表生产级 Launchpad。

## 6. 验收

```bash
npm run lint
npm run build
```
