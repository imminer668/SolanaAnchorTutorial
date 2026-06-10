# Lesson 14 - 前端推导 PDA 文档

> 面向 EVM 开发者：解释 Solana PDA 在前端的推导方式与 EVM mapping 的本质差异。

## 1. EVM mapping vs Solana PDA

### EVM 视角

```solidity
contract ProfileRegistry {
    mapping(address => Profile) public profiles;

    function getProfile(address user) public view returns (Profile memory) {
        return profiles[user];
    }
}
```

**前端如何查**：

```typescript
const profile = await contract.profiles(userAddress);
```

mapping 的"地址"对 EVM 来说是 storage slot keccak256(user, mapping_slot)，**但你不需要关心**——合约自己内部解析。

### Solana 视角

```rust
#[account(
    init,
    payer = user,
    seeds = [b"profile", user.key().as_ref()],
    bump
)]
pub profile: Account<'info, UserProfile>,
```

**PDA 是一个独立的账户**，地址完全由 seeds 决定。前端需要**自己推导**地址：

```typescript
const [pda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("profile"), userPubkey.toBuffer()],
  PROFILE_PROGRAM_ID,
);
```

**这就是关键差异**：EVM 把"键 → 存储位置"藏在合约里；Solana 让客户端**显式计算地址**，因为账户是 Solana 资源调度的基本单位。

## 2. PDA 推导的数学本质

```text
findProgramAddressSync(seeds, program_id):
  for bump in [255, 254, ..., 0]:
    candidate = sha256(seeds || [bump] || program_id || "ProgramDerivedAddress")
    if candidate 不在 ed25519 曲线上:
      return (candidate, bump)
  throw "Unable to find PDA"
```

- **不在 ed25519 曲线上**：意味着这个公钥没有对应的私钥，没人能签名（除了 program 自己）
- **bump 从 255 倒着试**：第一个找到的合法 bump 叫"canonical bump"
- **stored bump**：链上账户保存 bump，避免每次都重新搜索（256 次循环）

## 3. 前端代码模式

### 3.1 推导

```typescript
const [pda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("profile"), wallet.toBuffer()],
  PROGRAM_ID,
);
```

### 3.2 读

```typescript
const account = await program.account.userProfile.fetch(pda);
console.log(account.name, account.bio);
```

**注意**：`program.account.<account_name>` 的 account_name 是**小驼峰**化的（Anchor IDL 自动转换）。

### 3.3 写

```typescript
await program.methods
  .updateProfile(name, bio)
  .accounts({ user: wallet.publicKey })
  // profile PDA 由 Anchor 自动推导，无需手动传
  .rpc();
```

**注意**：因为 IDL 描述了 seeds，Anchor TS 客户端会自动推导出 PDA。不需要手动传 `profile` 账户。

## 4. PDA 与 keypair 创建账户的对比

|              | Keypair 账户                  | PDA                          |
| ------------ | ----------------------------- | ---------------------------- |
| 地址来源     | 私钥派生                       | seeds + program_id 推导       |
| 签名         | 任何持私钥者                   | 仅 program（用 seeds 签）      |
| 前端需要     | Keypair.generate() + signer    | findProgramAddressSync()      |
| 用户多 → 账户多 | 需要多个 keypair               | 不同 seeds 一一对应            |
| EVM 类比     | 单独部署的合约 / EOA           | mapping[key]                  |

## 5. 一致性保证

```typescript
// 同样的 seeds + program_id → 同样的 PDA
deriveProfilePda(walletA).pda === deriveProfilePda(walletA).pda  // true
deriveProfilePda(walletA).pda !== deriveProfilePda(walletB).pda  // true
```

**前端代码必须用和合约相同的 seed 字符串和顺序**，否则推导的 PDA 不一致，初始化时合约会拒绝。

我们 Lesson 06 的合约：

```rust
seeds = [b"profile", user.key().as_ref()]
```

我们前端推导：

```typescript
[Buffer.from("profile"), wallet.toBuffer()]
```

字符串、顺序、字节序完全一致。

## 6. 常见 PDA seed 模式

| 业务场景             | seeds                                         | 含义                       |
| -------------------- | --------------------------------------------- | -------------------------- |
| 用户 profile         | `["profile", user]`                            | 一人一个                    |
| 用户对 token 的关联   | `["user-token", user, mint]`                    | 一人一币一个                |
| 全局 config          | `["config"]`                                   | 全局唯一                    |
| 池子                 | `["pool", token_a, token_b]`                    | 双 token 唯一池             |
| 投票 ballot          | `["ballot", proposal, voter]`                   | 一人一票                    |
| Vesting              | `["vest", user, vesting_id]`                    | 同用户多个 vest             |

## 7. 失败路径

### 7.1 seed 编码不一致

```typescript
// ❌ 错误：少用了 Buffer.from
[Buffer.from("profile"), wallet]   // wallet 是 PublicKey，不是 Buffer

// ✅ 正确
[Buffer.from("profile"), wallet.toBuffer()]
```

### 7.2 seed 顺序写反

```rust
seeds = [b"profile", user.key().as_ref()]   // 合约
```

```typescript
// ❌ 错误：顺序反了
[wallet.toBuffer(), Buffer.from("profile")]

// ✅ 正确
[Buffer.from("profile"), wallet.toBuffer()]
```

### 7.3 字符串与字节不一致

```typescript
// ❌ 错误：包含尾随空格
Buffer.from("profile ")

// ✅ 正确
Buffer.from("profile")
```

### 7.4 用错 program id

PDA 与 program 强绑定，program_id 不对 → 推导出来的 PDA 不对 → 合约校验失败。

## 8. EVM 思维迁移点

| EVM 思维                       | Solana 真相                                       |
| ----------------------------- | ------------------------------------------------- |
| "前端不用知道存储位置"            | 前端必须推导 PDA 地址                                |
| "mapping[key] 是合约内部"         | PDA 是独立账户，可直接读                              |
| "改 storage 不用传账户"          | Anchor 自动注入 PDA（但 IDL 必须描述 seeds）           |
| "用户没初始化 → 返回 0 / 空值"     | 账户不存在 → fetch 抛异常，需要 catch 处理              |
| "合约可以读任何用户的 mapping"     | 同样可以，PDA 是 read-only public 的                  |

## 9. 用户不存在 / 账户不存在

EVM 的 `profiles[unknownUser]` 返回零值；Solana 的 `fetch(pda)` 在账户不存在时**抛异常**。

前端必须：

```typescript
try {
  const acc = await program.account.userProfile.fetch(pda);
  setProfile(acc);
} catch {
  setProfile(null);  // 不存在，要求用户先 Create
}
```

## 10. 课后检查清单

- [ ] 我能解释 PDA 与 ed25519 曲线的关系。
- [ ] 我能用 findProgramAddressSync 推导一个 PDA。
- [ ] 我能解释 canonical bump 与 stored bump 的区别。
- [ ] 我能在前端读一个用户的 PDA 数据。
- [ ] 我能调一个含 seeds 的指令而不手动传 PDA。
- [ ] 我能识别 seed 不一致导致的失败。

## 11. 下一步

- Lesson 15：前端调用 SPL Token（ERC20 思维差异）
- Lesson 17：Voting 投票系统（多 PDA 协同）
