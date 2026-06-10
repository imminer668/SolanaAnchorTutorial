# Lesson 17 - Voting 投票系统 文档

> 面向 EVM 开发者：把 Solidity 的 `mapping(address => bool)` 重新发现为 Solana 的 PDA 唯一性约束。

## 1. EVM 防重复投票 vs Solana 防重复投票

### EVM 思路

```solidity
contract Vote {
    mapping(address => bool) public hasVoted;
    uint256[3] public counts;

    function vote(uint8 option) external {
        require(!hasVoted[msg.sender], "already voted");
        require(option < 3, "invalid option");
        hasVoted[msg.sender] = true;
        counts[option]++;
    }
}
```

- 一个 mapping 记录"谁投过"
- require 检查 + 写入 storage

### Solana 思路

```rust
#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub poll: Account<'info, Poll>,

    #[account(
        init,                                     // 关键：init 不可重入
        payer = voter,
        space = VoteRecord::SIZE,
        seeds = [b"vote", poll.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote_record: Account<'info, VoteRecord>,

    #[account(mut)]
    pub voter: Signer<'info>,

    pub system_program: Program<'info, System>,
}
```

- 一个 PDA 账户 = 一条"投票记录"
- `init` 约束：账户已存在 → 失败
- 完全不需要写 `require(!hasVoted)`——**约束本身就是检查**

## 2. PDA 防重复的内在机制

```text
seeds = [b"vote", poll_pubkey, voter_pubkey]
```

→ 同一对 (poll, voter) → 同一个 PDA 地址 → 第二次 init 时账户已存在 → SystemProgram::createAccount 失败 → 整笔交易回滚

**这就是 Solana 的"mapping(address => bool)" 等价物**：把"键"编码进 seeds，把"是否存在"编码进 PDA 是否被创建。

## 3. 账户模型图

```text
                        ┌──────────────────────┐
                        │  Poll PDA            │
                        │                      │
                        │  authority: Pubkey   │
                        │  poll_id: u64        │
                        │  title: String       │
                        │  options: Vec<String>│
                        │  vote_counts: [u64;] │
                        │  end_time: i64       │
                        │  closed: bool        │
                        └─────────┬────────────┘
                                  │
                  seeds: [b"poll", authority, poll_id]
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
  ┌────────────┐            ┌────────────┐            ┌────────────┐
  │ VoteRecord │            │ VoteRecord │            │ VoteRecord │
  │            │            │            │            │            │
  │ poll: P    │            │ poll: P    │            │ poll: P    │
  │ voter: A   │            │ voter: B   │            │ voter: C   │
  │ option: 0  │            │ option: 2  │            │ option: 1  │
  └────────────┘            └────────────┘            └────────────┘
   seeds: [b"vote", P, A]   seeds: [b"vote", P, B]   seeds: [b"vote", P, C]
```

## 4. 失败路径设计

| 场景             | 触发的检查                                     | 错误码          |
| ---------------- | ---------------------------------------------- | --------------- |
| 重复投票         | VoteRecord PDA 已存在 → init 失败                | (SystemProgram 错误) |
| 无效选项 index   | `option_index < options.len()`                  | InvalidOption   |
| Poll 已关闭      | `!poll.closed`                                  | PollClosed      |
| Poll 已过期      | `clock.unix_timestamp < poll.end_time`          | PollExpired     |
| 非 authority 关  | `has_one = authority` + seeds 中的 authority    | Unauthorized / ConstraintSeeds |
| Title 过长       | `title.len() <= MAX_TITLE_LEN`                  | TitleTooLong    |
| 选项过多/少      | `options.len() in [2, 6]`                       | NotEnough/TooMany |

## 5. Poll PDA 的 seed 设计权衡

我们用：

```rust
seeds = [b"poll", authority.key().as_ref(), &poll_id.to_le_bytes()]
```

**为什么不用 title？**

- title 是可变长业务文本，不适合作为 PDA seed
- 单个 seed 应控制在 32 bytes 以内，`MAX_TITLE_LEN = 64` 会带来隐患
- title 更适合放在 account data 中，作为展示字段

**为什么不用 random poll_id？**

- random Pubkey 可以用，但会让前端额外管理一个 keypair 或 nonce
- `u64 poll_id` 已经足够表达"同一 authority 下的一场投票"
- 前端可以用后端分配、自增 ID 或时间戳生成，再按小端序编码

**如果业务要求 title 唯一怎么办？**

- 链下校验：索引服务或业务后端拒绝重复 title
- 链上校验：额外创建 `title_hash` PDA，seed 使用 32 byte hash
- 不建议直接把可变长 title 塞进 seed

## 6. 双重防御

我们的合约同时有：

1. **PDA 唯一性**（init 失败）→ 防重复投票
2. **closed 字段** + 检查 → 防 close 后投票

为什么 (2) 不冗余？因为 (1) 只防"同一 voter 重复投"。close 是要禁止**所有人**投票，需要单独 flag。

## 7. EVM 习惯不能直接迁移的几点

| EVM 习惯                          | Solana 真相                                         |
| -------------------------------- | --------------------------------------------------- |
| "mapping[user] = true"           | init 一个 PDA = 永久占用 + 付 rent                   |
| "结束投票就 selfdestruct"          | close = 设标志位；要 reclaim rent 用 `close = authority` |
| "前端不需要知道选民列表"            | 想列出所有 VoteRecord 要 `getProgramAccounts` filter |
| "事件就是 log"                    | event = msg! / emit!，前端用 ws 订阅                  |
| "uint256 counter"                | u64 + checked_add 防溢出                              |

## 8. 关于 rent

每个 VoteRecord ≈ 74 bytes → rent ≈ 0.0011 SOL。100 万选民 → 1100 SOL。

**真实生产方案**：

1. **Merkle Tree 投票**：链下提交选民列表，链上验证 Merkle proof
2. **Compressed PDA**（State Compression）：用 Merkle Tree 压缩状态
3. **Snapshot 投票**：投票时只记录"已投"，rent 由发起人统一付

本课为教学清晰起见，用最直接的"一人一 PDA"模式。

## 9. 客户端代码模式

### 9.1 推导 Poll PDA

```typescript
const pollIdBuffer = Buffer.alloc(8);
pollIdBuffer.writeBigUInt64LE(BigInt(pollId));

const [pollPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("poll"), authority.toBuffer(), pollIdBuffer],
  programId,
);
```

### 9.2 推导 VoteRecord PDA

```typescript
const [voteRecord] = PublicKey.findProgramAddressSync(
  [Buffer.from("vote"), pollPda.toBuffer(), voter.toBuffer()],
  programId,
);
```

### 9.3 投票

```typescript
await program.methods
  .vote(optionIndex)
  .accounts({
    poll: pollPda,
    voter: voter.publicKey,
  })
  .rpc();
// vote_record PDA 由 Anchor 自动推导（IDL 里有 seeds 描述）
```

## 10. 课后检查清单

- [ ] 我能解释为什么 `init + seeds` 等同于 `mapping(address => bool)` 防重复。
- [ ] 我能设计一个"一人一 PDA"的访问控制约束。
- [ ] 我能解释 close_poll 用 `has_one = authority` 的安全意义。
- [ ] 我能算一个投票系统的总 rent 成本。
- [ ] 我能列出至少两种"大规模投票"的优化方案。
- [ ] 我能写出"投票后立即查询所有投票的 voter 列表"的客户端代码。

## 11. 下一步

- Lesson 18：Airdrop 空投系统（同样用 PDA 防重复 claim）
- Lesson 19：Launchpad（更复杂的资金管理）
- Lesson 20：Prediction Market（多 Outcome + 资金 escrow）
