# Lesson 22 - Anchor 测试体系

> 最小 Anchor 测试样板：成功断言、失败断言、错误码断言、账户读取断言、事件日志断言。

## 项目结构

```text
22-anchor-testing/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── anchor_testing/
│       └── src/lib.rs
└── tests/
    └── anchor-testing.ts
```

## 示例程序

本课用一个 Counter PDA 展示测试写法：

- `initialize()`：创建 Counter PDA。
- `increment()`：计数加一。
- `decrement()`：计数减一，0 时返回 `Underflow`。
- `set_value(value)`：直接设置计数。
- `close_counter()`：关闭账户并退回 rent。

## 测试模式

`tests/anchor-testing.ts` 覆盖以下常用模式：

- PDA 推导：`PublicKey.findProgramAddressSync(...)`
- 成功路径：调用指令后读取账户并断言字段
- 失败路径：非 authority 调用失败
- 错误码断言：断言 `AnchorError.error.errorCode.code`
- 多步骤状态断言：连续 increment/decrement 后读取账户
- close 断言：关闭后账户不可再 fetch
- event 断言：确认交易日志写入 Anchor event data

## 本地 Validator

`anchor test` 会启动本地 validator，部署当前 program，并执行 `tests/**/*.ts`。

它在测试中的角色类似 Foundry 的本地 EVM：

- 提供可重置的本地区块链环境
- 执行交易并产生日志
- 存储测试中创建的账户
- 提供 airdrop，方便临时 keypair 支付 rent

## 常用命令

```bash
yarn install
anchor build
anchor test
npm run lint
```

如果本机已有 validator 占用 `8899`，需要先关闭旧进程或切到干净终端环境后再运行 `anchor test`。

## 后续课程可复用清单

- 每个新 Keypair 作为 payer 前，先 airdrop SOL。
- 每条失败路径都应断言具体错误码，而不是只捕获异常。
- 每次状态变更后都用 `program.account.xxx.fetch(...)` 读取账户复核。
- PDA 地址应在测试中显式推导，便于对照 seeds 设计。
- 事件测试优先检查交易日志，避免异步 listener 漏断言；完整事件字段解码会在 Lesson 23 展开。
