# Lesson 05 - Account、Space 与 Discriminator 文档

> 面向 EVM 开发者的 Solana 账户字节布局讲解

## 1. 为什么 EVM 开发者要关心这个？

### Solidity 的世界观

```solidity
contract Counter {
    address public authority;
    uint64 public count;
    string public label;
    uint32[] public scores;

    mapping(address => uint256) public balances;
    // ...
}
```

EVM 合约的 storage 是**动态 KV 存储**，由 EVM 帮你管理：
- 不需要指定每个变量的字节数
- 不需要提前分配空间
- `string` / `bytes` / `mapping` 都可以无限增长

### Solana 的现实

```rust
#[account]
pub struct Counter {
    pub authority: Pubkey,     // 32 bytes
    pub count: u64,            // 8 bytes
    pub label: String,         // 4 + N bytes
    pub scores: Vec<u32>,      // 4 + N*4 bytes
    pub bump: u8,              // 1 byte
}

impl Counter {
    pub const SIZE: usize = 8 + 32 + 8 + (4 + 50) + (4 + 16 * 4) + 1;
    // 必须提前算好
}
```

Solana 账户是**定长字节数组**，必须提前算好总字节数。

## 2. Discriminator：账户身份证

```text
8 bytes = SHA-256("account:Counter")[..8]
```

每个 `#[account]` 类型的账户都有 8 字节 discriminator，Anchor 用它来：
- 反序列化时区分账户类型
- 拒绝把别的类型数据当成 Counter 读取

**类比 EVM**：EVM 合约有 runtime bytecode hash，Solana 账户有 discriminator。

## 3. 字段字节速查表

| 类型      | 字节数                | 说明                            |
| --------- | --------------------- | ------------------------------- |
| `Pubkey`  | 32                    | 公钥                            |
| `u8`/`i8`/`bool` | 1               |                                 |
| `u16`/`i16` | 2                   |                                 |
| `u32`/`i32` | 4                   |                                 |
| `u64`/`i64` | 8                   |                                 |
| `u128`/`i128` | 16                |                                 |
| `String`  | 4 + N                 | 4 字节长度前缀 + N 字节 UTF-8   |
| `Vec<T>`  | 4 + N × size_of(T)    | 4 字节长度前缀 + N 个 T         |
| `[T; N]`  | N × size_of(T)        | 固定长度数组                    |
| `Option<T>` | 1 + size_of(T)       | 1 字节 discriminator + T        |
| enum      | 1 + max(variant size) | tag + 最大变体大小              |

## 4. EVM 视角：Solidity 是怎么避开这个问题的？

```solidity
// EVM storage 是 32 字节 slot
slot[0] = authority (padded)
slot[1] = count
slot[2] = scores.length
keccak256(slot[2]) + i = scores[i]
slot[3] = label.length
keccak256(slot[3]) + i = label[i]  // 短字符串优化：短字符串直接放在 slot
```

EVM 把 storage 抽象成 32 字节 slot：
- 用户不需要算字节
- 字符串和数组自动扩容
- Gas 按使用量收

Solana 让你**显式付钱**：空间大 = rent 多，但扩容需要 realloc。

## 5. Rent 机制

Solana 账户必须保持 rent-exempt 状态（即存够 lamports 免租金）。

```text
rent = SIZE × lamports_per_byte_year × 2 (years)
SIZE 越大 → 需要越多的 lamports 才能 init
```

本课 Counter SIZE = 171 bytes，需要约 0.001 SOL 左右的 lamports。

## 6. String / Vec 的边界

```rust
pub const MAX_LABEL_LEN: usize = 50;
pub const MAX_SCORES: usize = 16;

pub const SIZE: usize = 8 + 32 + 8 + (4 + MAX_LABEL_LEN) + (4 + MAX_SCORES * 4) + 1;
```

为什么需要这两个常量？

1. **预留足够空间**：如果 SIZE 算小了，`init` 后想写入更长的 string 会失败
2. **运行时再校验**：客户端可能绕过类型检查，需要在程序里 `require!(label.len() <= MAX_LABEL_LEN, ErrorCode::LabelTooLong)`
3. **扩容代价高**：扩容需要 `realloc` + 重新填充 lamports，不是一次性 init

## 7. 实际扩容的代价

```rust
// 错误做法：写满才发现空间不够
pub fn push_score(ctx: Context<ModifyCounter>, score: u32) -> Result<()> {
    let counter = &mut ctx.accounts.counter;
    counter.scores.push(score);  // 满了会失败！
    Ok(())
}
```

正确做法：定义 MAX，提前分配满，运行时 `require!` 校验。本课示例就是这种模式。

## 8. 常见误区

### 误区 1：忘加 discriminator

```rust
// 错：少算 8 字节
pub const SIZE: usize = 32 + 8 + (4 + 50);  // = 94 bytes ❌

// 对：包含 8 字节 discriminator
pub const SIZE: usize = 8 + 32 + 8 + (4 + 50);  // = 102 bytes ✓
```

### 误区 2：忘加 String / Vec 的长度前缀

```rust
// 错：只算了内容
pub const SIZE: usize = 8 + 32 + 8 + 50;  // 少了 4 字节

// 对：4 字节长度 + N 字节内容
pub const SIZE: usize = 8 + 32 + 8 + (4 + 50);
```

### 误区 3：用 len() 算 UTF-8 字节数

```rust
// String::len() 返回字节数，不是字符数
let s = "你好";  // 6 字节（3 字节/字）
let n = s.len(); // 6，不是 2
```

## 9. 与 EVM 关键差异对照

| 维度         | EVM Storage                | Solana Account             |
| ------------ | -------------------------- | -------------------------- |
| 字节布局     | 32 字节 slot 数组          | 用户自定义连续字节         |
| 扩容         | 自动                       | 手动 realloc + 充值        |
| 类型感知     | 编译期                     | Anchor 编译期 + 运行时     |
| 多账户       | 一个合约一棵树             | 每个账户一个独立文件        |
| Rent         | 无                         | 必须 rent-exempt            |

## 10. 课后检查清单

- [ ] 我能算出 8 + 32 + 8 + 4 + N + 1 = X 字节。
- [ ] 我知道 discriminator 是什么、占多少字节。
- [ ] 我知道 String 是 4 + N 字节，不是 N 字节。
- [ ] 我知道 Vec<T> 是 4 + N×sizeof(T) 字节。
- [ ] 我能在初始化前用常量预分配空间。
- [ ] 我能解释为什么扩容是昂贵的。
- [ ] 我能解释 EVM storage 与 Solana Account 的字节布局差异。

## 11. 下一步

- Lesson 06：PDA 入门（已学）
- Lesson 07：CPI 入门（已学）
- Lesson 09：Token2022
- Lesson 10：Meme Coin
