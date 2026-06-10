# Lesson 22 - Anchor 测试体系文档

## 1. Foundry 测试 vs Anchor TS 测试

在 EVM/Foundry 中，测试通常直接运行在 Solidity VM 里：

```solidity
function testIncrement() public {
    counter.increment();
    assertEq(counter.count(), 1);
}
```

在 Anchor 中，测试通常是 TypeScript 客户端测试：

```typescript
await program.methods.increment().accounts({ counter, authority }).rpc();
const account = await program.account.counter.fetch(counter);
assert.strictEqual(account.count.toString(), "1");
```

核心差异：

| 维度       | Foundry                    | Anchor TS                         |
| ---------- | -------------------------- | --------------------------------- |
| 执行环境   | 本地 EVM                   | 本地 Solana validator             |
| 调用方式   | 直接调用合约函数             | 构造交易 + accounts + signers      |
| 状态读取   | 调用 view / public getter   | `program.account.xxx.fetch(...)`   |
| 身份模拟   | `vm.prank(address)`         | `Keypair.generate()` + signer      |
| 资金准备   | `vm.deal(address, amount)`  | `requestAirdrop(...)`              |
| 错误断言   | `vm.expectRevert(...)`      | 捕获 `AnchorError` 并断言 code     |
| 日志事件   | event logs                  | transaction logs / Anchor event    |

## 2. 本地 Validator 的角色

`anchor test` 默认会：

1. 编译 program。
2. 启动本地 validator。
3. 部署 program 到 localnet。
4. 运行 `Anchor.toml` 中的 test script。
5. 测试结束后清理本地测试环境。

这和 Foundry 的本地链类似，但 Solana 测试还需要显式处理账户：

- 谁支付 rent：`payer = authority`
- 谁签名：`Signer<'info>` 对应 `.signers([...])`
- 账户地址：PDA 需要客户端按 seeds 推导
- 账户读取：测试通过 RPC fetch 账户数据

## 3. 成功路径断言

成功测试不应只断言交易没报错，还要读取账户确认状态。

```typescript
await program.methods.initialize().accounts({ counter, authority }).rpc();

const account = await program.account.counter.fetch(counter);
assert.strictEqual(account.authority.toBase58(), authority.toBase58());
assert.strictEqual(account.count.toString(), "0");
```

这对应 Foundry 中的 `assertEq(counter.count(), 0)`。

## 4. 错误码断言

Anchor 自定义错误通过 `#[error_code]` 定义：

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Counter underflow (count is already 0)")]
    Underflow,
}
```

测试中应断言具体错误码：

```typescript
try {
  await program.methods.decrement().accounts({ counter, authority }).rpc();
  assert.fail("should have failed");
} catch (err: any) {
  assert.isTrue(err instanceof AnchorError);
  assert.strictEqual(err.error.errorCode.code, "Underflow");
}
```

不要只写“捕获到异常即可”，否则错误来源可能是 accounts 写错、余额不足或 validator 问题。

## 5. 账户读取断言

Solana 程序没有 Solidity getter。账户状态要通过 RPC 读取：

```typescript
const counter = await program.account.counter.fetch(counterPda);
```

常见断言包括：

- Pubkey：转成 base58 后比较
- BN/u64：转成 string 后比较
- bool/u8：直接比较
- close 后账户：`fetch` 应失败

## 6. 事件日志断言

Anchor 的 `emit!` 会写入交易日志。测试里可以拿到交易签名，再读取 logs：

```typescript
const sig = await program.methods.increment().accounts(...).rpc();
const tx = await provider.connection.getTransaction(sig, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});

const logs = tx!.meta?.logMessages ?? [];
assert.includeMembers(logs, ["Program log: Instruction: Increment"]);
assert.isTrue(logs.some((log) => log.startsWith("Program data: ")));
```

这比异步 listener 更适合单元测试，因为它能明确断言某一笔交易是否产生了 Anchor event data。完整事件字段解码会在 Lesson 23 的错误码与事件课程中继续展开。

## 7. 本课检查清单

- [ ] 我能解释 `anchor test` 如何启动本地 validator。
- [ ] 我能给临时 payer keypair 空投 SOL。
- [ ] 我能写成功路径、失败路径、错误码断言。
- [ ] 我能读取 Anchor account 并断言字段。
- [ ] 我能从交易日志确认 Anchor event data 是否写入。
- [ ] 我知道为什么测试失败时要区分业务错误和环境错误。
