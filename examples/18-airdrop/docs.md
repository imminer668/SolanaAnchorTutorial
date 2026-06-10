# Lesson 18 - Airdrop 空投系统 文档

> 面向 EVM 开发者：把 ERC20 airdrop 的"claimed mapping"模式重新发现为 Solana 的 PDA 唯一性 + Vault CPI。

## 1. EVM airdrop 模型

```solidity
contract Airdrop {
    IERC20 public token;
    uint256 public claimAmount;
    mapping(address => bool) public claimed;

    function claim() external {
        require(!claimed[msg.sender], "already claimed");
        claimed[msg.sender] = true;
        token.transfer(msg.sender, claimAmount);
    }
}
```

- 合约自己持有 token（部署后给合约转 token）
- mapping 记录"已 claim"
- `token.transfer` 由合约直接调用（合约是 token 的持有者）

## 2. Solana airdrop 模型

```text
                    ┌──────────────────────┐
                    │  Airdrop PDA         │
                    │                      │
                    │  authority           │
                    │  mint                │
                    │  vault               │
                    │  claim_amount        │
                    │  claimed_count       │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼─────────────────┐
              │                │                 │
              ▼                ▼                 ▼
       ┌─────────────┐  ┌─────────────┐    ┌──────────────┐
       │ Vault       │  │ ClaimRecord │    │ ClaimRecord  │
       │ TokenAccount│  │  (Alice)    │    │  (Bob)       │
       │ owner=PDA   │  │             │    │              │
       └─────────────┘  └─────────────┘    └──────────────┘
```

- **Vault** 是一个 TokenAccount PDA，所有 token 在这里
- **ClaimRecord** 是一个数据 PDA，存在 = 已 claim
- Vault → claimer 转账由 program CPI，PDA 用 seeds 签名

## 3. 三大账户解析

### 3.1 Airdrop Account

```rust
pub struct Airdrop {
    pub authority: Pubkey,      // 创建者
    pub mint: Pubkey,           // 空投哪种 token
    pub vault: Pubkey,          // 关联的 vault
    pub claim_amount: u64,      // 每人 claim 多少
    pub claimed_count: u64,     // 已 claim 数量（统计）
    pub bump: u8,
}
```

### 3.2 Vault Account（TokenAccount PDA）

```rust
#[account(
    init,
    payer = authority,
    token::mint = mint,
    token::authority = vault,       // 关键：authority 是 PDA 自己
    seeds = [b"vault", airdrop.key().as_ref()],
    bump,
)]
pub vault: Account<'info, TokenAccount>,
```

- **token::authority = vault**：让 vault PDA 自己作为持有人
- 只有 program 用 seeds 签名才能动这个 TokenAccount

### 3.3 ClaimRecord PDA

```rust
#[account(
    init,                                          // ← 第二次 init 失败
    payer = claimer,
    space = ClaimRecord::SIZE,
    seeds = [b"claim", airdrop.key().as_ref(), claimer.key().as_ref()],
    bump,
)]
pub claim_record: Account<'info, ClaimRecord>,
```

- 同一 (airdrop, claimer) → 同一 PDA → 第二次 init 直接失败
- 等同 EVM 的 `claimed[msg.sender] = true`

## 4. PDA 签名做 CPI

```rust
let airdrop_key = airdrop.key();
let signer_seeds: &[&[&[u8]]] = &[&[
    b"vault",
    airdrop_key.as_ref(),
    &[ctx.bumps.vault],
]];

let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.claimer_ata.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    },
    signer_seeds,
);
token::transfer(cpi_ctx, airdrop.claim_amount)?;
```

**这是 Solana CPI 的精髓**：
- 普通 CPI（`CpiContext::new`）：只有用户签名
- PDA CPI（`CpiContext::new_with_signer`）：传 seeds + bump，让 Token Program 验证 PDA 是合法的 authority

## 5. 防重复的对比

| 维度          | EVM                          | Solana                          |
| ------------- | ---------------------------- | ------------------------------- |
| 数据结构      | mapping(address => bool)     | ClaimRecord PDA                  |
| 防重复机制    | require !claimed[msg.sender] | init 第二次失败                  |
| 存储成本      | 一次 SSTORE（≈20k gas）        | 一次 rent（≈0.0011 SOL/记录）     |
| 释放          | 不释放                        | 可以 close 退还 rent              |
| 谁付存储      | claim 者付 gas                | claim 者付 rent                  |
| 可审计性      | 链上事件 log                  | ClaimRecord 永久存在，可查询      |

## 6. 为什么本课不引入 Merkle Tree

**Merkle 空投是生产标准**：用 Merkle Tree 把"谁能领"的列表压缩，链上只存一个 root，用户提交 proof 验证。

```solidity
function claim(address user, uint256 amount, bytes32[] calldata proof) external {
    bytes32 leaf = keccak256(abi.encode(user, amount));
    require(MerkleProof.verify(proof, merkleRoot, leaf), "invalid proof");
    ...
}
```

**为什么本课不引入**：

1. **学习目标分层**：本课目的是讲透"PDA 防重复"和"PDA Vault + CPI 签名"两个核心模式，再叠加 Merkle 会模糊重点。
2. **大部分小项目用不到**：白名单 < 10000 人时，简单 PDA 方案的总成本完全可接受。
3. **Merkle 实现成本高**：Solana 上做 Merkle 通常用 [State Compression / Bubblegum](https://developers.metaplex.com/bubblegum)，需要额外学一套 SDK 和账户模型，更适合做单独的进阶课程。

### 真实生产何时该上 Merkle Tree？

- 白名单 ≥ 几万人，rent 总开销不可接受
- 列表生成不在链上（需要链下计算 root）
- 想让 claim 走 "用户付 gas + 自助" 模式

### 如果一定要做 Merkle 版本

1. 链下：把 (claimer, amount) 列表 hash 成 leaves，build 出 root
2. 链上：Airdrop 账户存 root
3. claim 时：用户提交 (amount, proof[])，链上验证 `verify(proof, root, hash(claimer, amount))`
4. ClaimRecord PDA 依然防重复

## 7. 失败路径设计

| 场景             | 触发的检查                                       | 错误码             |
| ---------------- | ------------------------------------------------ | ------------------ |
| 重复 claim       | ClaimRecord PDA 已存在 → init 失败                 | (SystemProgram 错误) |
| Vault 余额不足   | `vault.amount >= claim_amount`                    | InsufficientVault  |
| Claimer ATA 不对 | `claimer_ata.owner == claimer.key()`              | OwnerMismatch      |
| Mint 不匹配      | `claimer_ata.mint == airdrop.mint`                | MintMismatch       |
| claim_amount = 0 | `claim_amount > 0`                                | InvalidAmount      |
| 存款 < claim 单价 | `total_deposit >= claim_amount`                  | InvalidDeposit     |

## 8. 安全考虑

### 8.1 Vault authority 必须是 PDA

如果误用 `token::authority = authority`（创建者本人），那么 authority 可以**绕过 program 直接把 vault 里的 token 卷走**，等于 rug pull。

我们：

```rust
token::authority = vault    // PDA 自己 = 只有 program 能动
```

### 8.2 mint 和 vault 关系绑定

```rust
seeds = [b"airdrop", authority.key().as_ref(), mint.key().as_ref()]
```

把 mint 编码进 airdrop PDA → 同 authority + 同 mint 不能创建第二个 airdrop。

### 8.3 claimer_ata 验证

```rust
constraint = claimer_ata.owner == claimer.key()
```

不验证 owner 的话，attacker 可以传别人的 ATA 当 claimer_ata，把 token 送给别人（虽然不是攻击，但会让 ClaimRecord 用 attacker 的 key，浪费 record 槽位）。

## 9. 客户端代码模式

### 9.1 推导 PDA

```typescript
const [airdropPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("airdrop"), authority.toBuffer(), mint.toBuffer()],
  programId,
);
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), airdropPda.toBuffer()],
  programId,
);
const [claimRecordPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("claim"), airdropPda.toBuffer(), claimer.toBuffer()],
  programId,
);
```

### 9.2 Create airdrop

```typescript
await program.methods
  .createAirdrop(new BN(claimAmount), new BN(totalDeposit))
  .accounts({
    mint,
    authorityAta,                       // authority 的 ATA（必须有足够余额）
    authority: authority.publicKey,
  })
  .rpc();
```

### 9.3 Claim

```typescript
const claimerAta = getAssociatedTokenAddressSync(mint, claimer.publicKey);

// 先确保 claimer ATA 存在
if (!(await connection.getAccountInfo(claimerAta))) {
  // 创建 ATA
}

await program.methods
  .claim()
  .accounts({
    airdrop: airdropPda,
    claimerAta,
    claimer: claimer.publicKey,
  })
  .signers([claimer])
  .rpc();
```

## 10. 课后检查清单

- [ ] 我能解释为什么 vault 的 authority 必须是 PDA。
- [ ] 我能写一个用 PDA seeds 签名的 CPI。
- [ ] 我能解释 ClaimRecord PDA 如何等价于 EVM 的 `claimed mapping`。
- [ ] 我能列出 Merkle Tree airdrop 的使用场景与权衡。
- [ ] 我能识别 vault authority 写错导致的 rug pull 风险。
- [ ] 我能算 N 个 claimer 的总 rent 成本。

## 11. 下一步

- Lesson 19：Launchpad（更复杂的多 token 资金管理）
- Lesson 20：Prediction Market（多 outcome + 用户 share）
