# Lesson 23: 错误码与事件

## Solidity custom error 与 Anchor error

Solidity 中常见写法：

```solidity
error InvalidValue();

function record(uint256 value) external {
    if (value == 0) revert InvalidValue();
}
```

Anchor 中对应写法：

```rust
require!(value > 0, ErrorCode::InvalidValue);

#[error_code]
pub enum ErrorCode {
    #[msg("Value must be greater than zero")]
    InvalidValue,
}
```

差异：

- Solidity custom error 会进入 EVM revert data，客户端通常按 selector 或 ABI 解码。
- Anchor error 会返回结构化的 AnchorError，客户端可以断言 `errorCode.code` 和 `errorCode.number`。
- Anchor 自定义错误码默认从 `6000` 开始，因此本课的 `InvalidValue` 是 `6000`，`ValueTooLarge` 是 `6001`，`Unauthorized` 是 `6002`。

## Solidity event 与 Anchor event

Solidity 中常见写法：

```solidity
event ValueRecorded(address indexed authority, uint256 value);

emit ValueRecorded(msg.sender, value);
```

Anchor 中对应写法：

```rust
emit!(ValueRecorded {
    board: board.key(),
    authority: board.authority,
    previous_value,
    value,
});

#[event]
pub struct ValueRecorded {
    pub board: Pubkey,
    pub authority: Pubkey,
    pub previous_value: u64,
    pub value: u64,
}
```

差异：

- EVM event 会写入 transaction receipt logs，并支持 `indexed` topic，节点和索引服务可以按 topic 高效过滤。
- Solana Program 没有 EVM topic/indexed 字段模型；`emit!` 会把 Anchor event 编码后写入交易日志中的 `Program data:`。
- Solana 客户端通常通过交易签名读取日志，或由索引器订阅、解析日志后自行建立查询索引。
- 因此 Anchor event 更像“结构化日志约定”，而不是 EVM 那种原生 topic 索引系统。

## 测试重点

错误码断言：

```ts
assert.isTrue(err instanceof AnchorError);
assert.strictEqual(err.error.errorCode.code, "InvalidValue");
assert.strictEqual(err.error.errorCode.number, 6000);
```

事件读取与解码：

```ts
const logs = tx.meta?.logMessages ?? [];
const events = logs
  .filter((log) => log.startsWith("Program data: "))
  .map((log) => log.replace("Program data: ", ""))
  .map((data) => program.coder.events.decode(data))
  .filter(Boolean);
```

生产环境中，事件日志可能被 RPC 裁剪或受日志大小限制影响。重要状态仍应写入账户；event 更适合通知、审计和索引。
