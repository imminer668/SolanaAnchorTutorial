# Lesson 06 - PDA User Profile 文档

> 面向 EVM 开发者的 PDA 实战讲解

## 1. PDA 是什么？

PDA = Program Derived Address。

它是一种特殊地址：

- 由 `Program ID + seeds` 确定性推导
- **没有私钥**——任何人都不能在链外签名它
- 只能由对应 Program 用 `invoke_signed` 模拟签名
- 不出现在 Ed25519 曲线上（"off-curve"）

```rust
// 推导
let (pda, bump) = Pubkey::find_program_address(
    &[b"profile", user.key().as_ref()],
    &program_id,
);
```

## 2. PDA 为什么能模拟 `mapping(address => Profile)`？

### EVM 视角

```solidity
mapping(address => Profile) public profiles;

profiles[msg.sender].name = "Alice";
```

调用 `profiles[alice]` 就是哈希表查找。EVM 自动管理。

### Solana 视角

```rust
// "键" = user 的 Pubkey
// "值" = 一个独立 Account，地址由 PDA 推导
seeds = [b"profile", user.key().as_ref()]
```

调用时：

```rust
#[account(
    init,                              // 首次创建
    payer = user,                      // user 付 rent
    space = UserProfile::SIZE,         // 分配空间
    seeds = [b"profile", user.key().as_ref()],
    bump,
)]
pub profile: Account<'info, UserProfile>,
```

**关键差异**：

- "键"不再是一个哈希表条目，而是一个**真实存在链上**的 Account。
- 键 = `user.key()`，值 = `UserProfile` 数据。
- 前端可以通过同样的 seeds 离线推导出 PDA 地址，不需要先读链上数据。

## 3. Account 数据结构

```rust
#[account]
pub struct UserProfile {
    pub user: Pubkey,           // 32 bytes
    pub name: String,           // 4 + 50 bytes
    pub bio: String,            // 4 + 200 bytes
    pub bump: u8,               // 1 byte
}

impl UserProfile {
    pub const SIZE: usize = 8 + 32 + (4 + 50) + (4 + 200) + 1;  // = 303 bytes
}
```

**为什么 `name` 和 `bio` 的长度要写死？**

- Solana Account 创建时 size 固定。
- 如果不写死，你永远不知道一个 `name` 字符串最大能多长。
- 用常量 `MAX_NAME_LEN = 50` 是常见做法。运行时通过 `require!` 强制限制。

## 4. seeds 与 bump

```rust
seeds = [b"profile", user.key().as_ref()],
bump,
```

- `seeds`：用于推导 PDA 的字节数组。
- `bump`：PDA 推导时会找到一个 "off-curve" 的 nonce，必须存进 Account 用于后续签名校验。

**为什么存 bump？**

PDA 推导时，runtime 找 `bump` 是 O(256) 试错。如果不存 bump，后续重新推导会浪费算力。所以**通常把 bump 存到 Account 里**，用 `seeds = [..., bump = profile.bump]` 让 Anchor 直接用存好的值。

## 5. has_one 校验

```rust
#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"profile", user.key().as_ref()],
        bump = profile.bump,
        has_one = user @ ErrorCode::Unauthorized,
    )]
    pub profile: Account<'info, UserProfile>,

    pub user: Signer<'info>,
}
```

- `seeds`：校验 profile 地址确实是 user 对应的 PDA
- `bump = profile.bump`：使用存好的 bump，避免重新计算
- `has_one = user`：校验 `profile.user == user.key()`（防止 A 用 B 的 user pubkey 调 update）

**对比 Solidity**：

```solidity
modifier onlyProfileOwner() {
    require(profiles[msg.sender].user == msg.sender, "not owner");
    _;
}
```

EVM 的 mapping 给你"键"和"值"的双重索引，Solana 的 PDA 只保证**地址匹配**。你必须自己用 `has_one` 校验内部字段一致性。

## 6. 关闭与退 rent

```rust
#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(
        mut,
        seeds = [b"profile", user.key().as_ref()],
        bump = profile.bump,
        has_one = user @ ErrorCode::Unauthorized,
        close = user,         // ← 关闭并退 rent 给 user
    )]
    pub profile: Account<'info, UserProfile>,

    pub user: Signer<'info>,
}
```

`close = user` 让 Anchor 自动：

1. 把 profile account 的 lamports 转给 user
2. 把 profile account 的 owner 设为 System Program
3. 把 profile account 的 data 清零
4. 让该地址可被复用

**对比 EVM**：

```solidity
function closeProfile() external {
    delete profiles[msg.sender];  // storage 槽位清零，不退钱
}
```

EVM 的 delete 只清状态不退 gas，Solana 的 close **真的把钱退回去**。

## 7. 前端推导 PDA

```ts
import { PublicKey } from "@solana/web3.js";

const [profilePda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("profile"), userPubkey.toBuffer()],
  program.programId,
);
```

前端在签名前就能算出地址，不需要先查链上。

**对比 EVM**：

```solidity
address profileAddr = address(profiles[user]);
```

EVM 不需要客户端推导，直接读合约。

## 8. 与 EVM 的关键差异

| 维度             | EVM mapping                  | Solana PDA                 |
| ---------------- | ---------------------------- | -------------------------- |
| 数据存在         | 合约 storage 哈希表           | 独立 Account               |
| 客户端能否预知   | 不能（要先读 storage 才知道） | 可以（推算 seeds 即可）   |
| 跨 Program       | 不行（合约内 storage）        | 可以（只要 seeds 公开）   |
| 关闭与 rent      | delete 不退钱                 | close 退 lamports          |
| 全表扫描         | 遍历 storage                 | getProgramAccounts RPC     |

## 9. 常见误区

### 误区 1：用普通 keypair 地址作为 "key"

错。`findProgramAddressSync` 只能推到 PDA，**普通地址由 keypair 私钥控制**，PDA 没有私钥。

### 误区 2：把 mapping 想象成链下索引

错。Solana 链上没有"全表扫描 mapping"的操作。你要全表必须用 `getProgramAccounts` RPC，这会扫描所有该 Program 的 Account，**慢**且**贵**。

### 误区 3：bump 可以省略

错。不存 bump 就要每次重新推导，浪费 CU。最佳实践：把 bump 存到 Account 里。

## 10. 课后检查清单

- [ ] 我能解释 PDA 与普通地址的区别。
- [ ] 我能解释为什么 seeds 要设计成"客户端可推算"。
- [ ] 我能解释 `bump` 的作用。
- [ ] 我能解释 `has_one` 与 seeds 校验的差异。
- [ ] 我能解释 `close = user` 的工作原理。
- [ ] 我能计算 UserProfile 的 SIZE。

## 11. 下一步

- Lesson 07：CPI 入门
- Lesson 08：SPL Token
