# Lesson 04 - Counter 文档

> 面向 EVM 开发者的 Anchor Counter 实战讲解

## 1. EVM 视角 vs Solana 视角

### Solidity 版本

```solidity
contract Counter {
    uint256 public count;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function increment() external {
        count += 1;
    }

    function decrement() external {
        require(count > 0, "underflow");
        count -= 1;
    }

    function reset() external onlyOwner {
        count = 0;
    }
}
```

`count` 状态绑定在合约地址上。`msg.sender` 自动提供。`onlyOwner` 在 Solidity 是修饰符。

### Anchor 版本

```rust
#[program]
pub mod counter {
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.counter.authority = ctx.accounts.user.key();
        ctx.accounts.counter.count = 0;
        Ok(())
    }
    // ...
}
```

状态在**外部 Account** 里，调用方必须**显式声明**为 `Signer`，authority 通过 `has_one` 约束校验。

## 2. Account 模型详解

### Counter Account

```rust
#[account]
pub struct Counter {
    pub authority: Pubkey,  // 32 bytes
    pub count: u64,         // 8 bytes
}
```

总大小：

```text
8 (discriminator) + 32 (Pubkey) + 8 (u64) = 48 bytes
```

Anchor 的 `#[account]` 宏会自动添加 8 字节 discriminator（账户类型标识）。反序列化时如果类型不匹配会直接报错。

### Space 计算

```rust
pub const SIZE: usize = 8 + 32 + 8;
```

必须在 `init` 时显式指定。如果之后字段增加，**Account 无法扩容**，需要迁移或重新创建。

## 3. 约束与签名

### Initialize

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = Counter::SIZE)]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

- `init`：创建新 Account
- `payer = user`：user 支付 rent
- `space = Counter::SIZE`：分配 48 字节
- `user: Signer`：必须是签名者（自动校验 Ed25519 签名）
- `system_program: Program<'info, System>`：必须是 System Program（自动校验）

### Increment / Decrement / Reset

```rust
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}
```

- `mut`：counter 可写
- `has_one = authority`：counter.authority == authority.key()
- `@ ErrorCode::Unauthorized`：如果校验失败，返回自定义错误

**对比 Solidity**：

```solidity
modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
}
```

`has_one` 在编译期由 Anchor 注入校验，比 modifier 更安全。

## 4. 错误码

```rust
#[error_code]
pub enum ErrorCode {
    #[msg("Counter is already initialized")]
    AlreadyInitialized,
    #[msg("Counter cannot be decremented below zero")]
    Underflow,
    #[msg("Only the authority can perform this action")]
    Unauthorized,
}
```

在测试中通过 AnchorError 检查：

```ts
const anchorErr = err as AnchorError;
assert.strictEqual(anchorErr.error.errorCode.code, "Unauthorized");
```

**对比 Solidity**：

```solidity
error Unauthorized();
error Underflow();

if (count == 0) revert Underflow();
```

## 5. 下溢保护

```rust
counter.count = counter.count
    .checked_sub(1)
    .ok_or(error!(ErrorCode::Underflow))?;
```

`checked_sub` 在 Rust 中遇到下溢返回 `None`，配合 `ok_or` 转换为自定义错误。

**对比 Solidity**：

```solidity
unchecked {
    count -= 1;  // Solidity 0.8+ 会自动 revert
}
```

Rust 默认不检查溢出（release 模式），必须显式使用 `checked_*` 方法。

## 6. 账户创建流程

调用 `initialize` 时：

1. 客户端构造 transaction，包含：
   - `counter`（要创建的新 Account，客户端生成的 keypair）
   - `user`（签名者、付费者）
   - `system_program`（系统程序）
2. 提交到 Solana
3. Runtime 调用 System Program 的 `create_account` 指令
4. Anchor 把 `Counter` 数据序列化写入新 Account 的 data
5. user 账户的 lamports 减少（rent）

后续调用 `increment` 时：

1. 客户端构造 transaction，包含：
   - `counter`（已存在的 Account，标记 writable）
   - `authority`（签名者，必须等于 counter.authority）
2. 提交后，counter 数据被修改

## 7. 与 EVM 的关键差异

| 维度         | EVM                          | Solana Anchor                      |
| ------------ | ---------------------------- | ---------------------------------- |
| 状态存储     | 合约 storage 内部             | 独立 Account，owner = program      |
| 状态大小     | 动态                          | 必须在 init 时固定                  |
| 调用者       | `msg.sender`（隐式）          | `Signer`（显式声明）                |
| 权限校验     | `require` / modifier          | `has_one` / `constraint`           |
| 整数溢出     | Solidity 0.8+ 自动 revert     | 必须使用 `checked_*` 方法          |
| 错误         | `revert` + `error`            | `Result<()>` + `#[error_code]`     |

## 8. 课后检查清单

- [ ] 我能解释为什么 Counter 数据存在独立 Account 里。
- [ ] 我能解释 `has_one` 与 Solidity `modifier` 的差异。
- [ ] 我能计算 Account 的 space。
- [ ] 我能解释为什么必须用 `checked_sub` 防下溢。
- [ ] 我能区分 `init`、`mut`、`signer` 三个约束。
- [ ] 我能解释为什么 `error_code` 优于裸字符串错误。

## 9. 下一步

- Lesson 05：Account、Space 与 Discriminator
- Lesson 06：PDA 入门：实现 Mapping
