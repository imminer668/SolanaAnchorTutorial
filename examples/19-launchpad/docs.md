# Lesson 19 - Launchpad 文档

> 面向 EVM 开发者：把 EVM Launchpad 合约（"白名单 + 限额 + 时段"）的整块逻辑，拆成 Solana 的多账户 + PDA 状态机。

## 1. EVM Launchpad 模型

```solidity
contract IDO {
    address public saleToken;       // 销售 token (ERC20)
    address public quoteToken;      // 报价 token (USDC)
    uint256 public rate;            // 1 quote = rate 个 sale
    uint256 public softCap;
    uint256 public hardCap;
    uint256 public totalRaised;
    mapping(address => uint256) public contributions;
    mapping(address => bool) public claimed;
    mapping(address => bool) public refunded;

    function contribute(uint256 amount) external {
        require(block.timestamp >= start, "not started");
        require(block.timestamp < end, "ended");
        require(totalRaised + amount <= hardCap, "over cap");
        contributions[msg.sender] += amount;
        totalRaised += amount;
        IERC20(quoteToken).transferFrom(msg.sender, address(this), amount);
    }

    function claim() external {
        require(totalRaised >= softCap, "soft cap not reached");
        uint256 saleAmt = contributions[msg.sender] * rate;
        IERC20(saleToken).transfer(msg.sender, saleAmt);
        claimed[msg.sender] = true;
    }
    // refund 类似
}
```

特征：
- 一个合约地址 = **代码 + 所有状态 + 所有 token 余额**
- `mapping` 直接表达"谁投了多少"
- `msg.sender` 来自交易

## 2. Solana Launchpad 模型

```text
              ┌──────────────────────────────┐
              │       LaunchpadPool PDA      │
              │  authority / sale_mint /     │
              │  quote_mint / soft_cap /     │
              │  hard_cap / price / status   │
              └─────┬───────────────┬────────┘
                    │               │
        ┌───────────▼──────┐  ┌─────▼────────────┐
        │  sale_vault      │  │  quote_vault     │
        │  TokenAccount    │  │  TokenAccount    │
        │  authority=vault │  │  authority=vault │
        │  mint=saleMint   │  │  mint=quoteMint  │
        └──────────────────┘  └──────────────────┘

   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │UserContrib│  │UserContrib│ │UserContrib│
   │ (Alice)   │  │ (Bob)     │ │ (Carol)   │
   │ quote_amt │  │ quote_amt │ │ quote_amt │
   │ sale_amt  │  │ sale_amt  │ │ sale_amt  │
   └──────────┘  └──────────┘ └───────────┘
```

特征：
- **LaunchpadPool PDA**：池子的元数据
- **sale_vault / quote_vault**：两个 TokenAccount PDA，分别托管 sale / quote
- **UserContribution PDA**：每个用户一份出资记录，存在 = 已投
- `msg.sender` → `user: Signer` + 由 seeds 推 PDA

## 3. 状态机

```
        ┌────────┐
        │ Active │ ←─── create_pool
        └───┬────┘
            │ contribute
            ▼
   ┌────────────────┐
   │ total_quote_   │
   │ raised 决策    │
   └─┬───────────┬──┘
     │ ≥soft_cap │ <soft_cap
     ▼           ▼
  ┌────────┐  ┌────────┐
  │Succeeded│ │ Failed │
  └────┬───┘  └───┬────┘
       │claim     │refund
       │          │withdraw
       ▼          ▼
    ┌──────────────┐
    │  Finalized   │
    └──────────────┘
```

- 升级发生在 claim 或 refund 的"第一次"调用里（避免空跑时也升级）
- `withdraw` 一定会把状态推到 Finalized
- `Finalized` 后无法再 claim/refund/withdraw

## 4. 四大账户结构

### 4.1 LaunchpadPool

```rust
pub struct LaunchpadPool {
    pub authority: Pubkey,         // 32 - 项目方
    pub sale_mint: Pubkey,         // 32 - 销售 token
    pub quote_mint: Pubkey,        // 32 - 报价 token (USDC)
    pub sale_vault: Pubkey,        // 32
    pub quote_vault: Pubkey,       // 32
    pub price: u64,                // 8  - 1 quote unit = price 个 sale unit
    pub soft_cap: u64,             // 8
    pub hard_cap: u64,             // 8
    pub start_time: i64,           // 8
    pub end_time: i64,             // 8
    pub total_quote_raised: u64,   // 8
    pub status: u8,                // 1
    pub bump: u8,                  // 1
}
// SIZE = 8 + 32*5 + 8*7 + 1 + 1 = 226
```

### 4.2 UserContribution

```rust
pub struct UserContribution {
    pub pool: Pubkey,         // 32
    pub user: Pubkey,         // 32
    pub quote_amount: u64,    // 8 - 出资 quote 数量
    pub sale_amount: u64,     // 8 - 应得 sale 数量 = quote * price
    pub claimed: bool,        // 1
    pub refunded: bool,       // 1
    pub bump: u8,             // 1
}
// SIZE = 8 + 32*2 + 8*2 + 1 + 1 + 1 = 83
```

### 4.3 sale_vault / quote_vault

两个 TokenAccount PDA：
- `sale_vault` = `TokenAccount { mint: sale_mint, authority: sale_vault_pda }`
- `quote_vault` = `TokenAccount { mint: quote_mint, authority: quote_vault_pda }`

authority **必须是 PDA 自己**，否则 authority 可以卷走 token。

## 5. CPI 设计

### 5.1 contribute: user_quote_ata → quote_vault

```rust
// 用户签名即可
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),
    Transfer {
        from: ctx.accounts.user_quote_ata.to_account_info(),
        to: ctx.accounts.quote_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),  // ← user 是 signer
    },
);
token::transfer(cpi_ctx, quote_amount)?;
```

### 5.2 claim: sale_vault → user_sale_ata

```rust
// sale_vault PDA 签名
let pool_key = pool.key();
let signer_seeds: &[&[&[u8]]] = &[&[
    b"sale_vault",
    pool_key.as_ref(),
    &[ctx.bumps.sale_vault],
]];

let cpi_ctx = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    Transfer {
        from: ctx.accounts.sale_vault.to_account_info(),
        to: ctx.accounts.user_sale_ata.to_account_info(),
        authority: ctx.accounts.sale_vault.to_account_info(),  // ← PDA
    },
    signer_seeds,
);
token::transfer(cpi_ctx, contribution.sale_amount)?;
```

### 5.3 refund / withdraw

同理，都是 PDA 签名。

## 6. 防重复出资

| 维度          | EVM                          | Solana                          |
| ------------- | ---------------------------- | ------------------------------- |
| 数据结构      | mapping(address => uint256) | UserContribution PDA             |
| 防重复机制    | 无（可累加）                 | init 第二次失败                  |
| 存储成本      | 一次 SSTORE                  | 一次 rent（≈0.0011 SOL）         |
| 累加          | 天然支持                     | 需关闭旧 PDA 再 init 新 PDA     |
| 查询          | `contributions(addr)`        | `fetch(UserContribution PDA)`   |

本课为教学简化：**只允许每个 user 出资一次**。生产中如果需要"加仓"，应该用 `contribution += amount` 累加模式 + 不再用 `init` constraint。

## 7. 软顶/硬顶的处理

### 7.1 contribute 时校验硬顶

```rust
let new_total = pool.total_quote_raised.checked_add(quote_amount)?;
require!(new_total <= pool.hard_cap, ErrorCode::OverHardCap);
```

### 7.2 claim / refund 时用软顶判定状态

```rust
// claim: 仅当 total >= soft_cap
require!(pool.total_quote_raised >= pool.soft_cap, ErrorCode::NotSucceeded);

// refund: 仅当 total < soft_cap
require!(pool.total_quote_raised < pool.soft_cap, ErrorCode::AlreadySucceeded);
```

这意味着：销售期间 status 一直是 Active，**业务结果在用户主动调用时确定**。

## 8. 失败路径设计

| 场景                          | 触发位置                          | 错误码              |
| ----------------------------- | --------------------------------- | ------------------- |
| 重复出资                      | UserContribution PDA init 失败      | (SystemProgram)     |
| 销售未开始时 contribute       | `now >= start_time`                 | NotStarted          |
| 销售结束后 contribute         | `now < end_time`                    | Ended               |
| 贡献金额超 hard cap           | contribute 内部 require            | OverHardCap         |
| 软顶未达时 claim              | claim 内部 require                 | NotSucceeded        |
| 软顶已达成时 refund           | refund 内部 require                | AlreadySucceeded    |
| 销售未结束时 refund           | `now >= end_time`                   | NotEnded            |
| 重复 claim                    | contribution.claimed 检查         | AlreadyClaimed      |
| 重复 refund                   | contribution.refunded 检查         | AlreadyRefunded     |
| 池未结束时 withdraw (Failed) | withdraw 内部 require              | NotEnded            |
| 非 authority withdraw        | pool.has_one = authority 失败      | (Anchor 错误)       |
| mint 不匹配                   | vault / ata 的 constraint          | MintMismatch        |
| ATA owner 不匹配              | user_quote_ata / user_sale_ata    | OwnerMismatch       |
| 算术溢出                      | checked_add / checked_mul          | Overflow            |

## 9. 安全考虑

### 9.1 vault authority 必须是 PDA

```rust
token::authority = sale_vault   // ✅ PDA 自己
// vs
token::authority = authority   // ❌ 项目方能卷款
```

### 9.2 claim 必须验 sale_vault 余额

```rust
require!(
    ctx.accounts.sale_vault.amount >= contribution.sale_amount,
    ErrorCode::InsufficientSaleVault
);
```

防止某种边界下：authority 已经 withdraw 走 sale token，导致用户领不到。

### 9.3 contribute 时 sale_vault 必须已有余额

```rust
require!(ctx.accounts.sale_vault.amount > 0, ErrorCode::NoSaleToken);
```

防止项目方忘记 deposit，就让用户投了 quote。

### 9.4 withdraw 的 idempotent 防护

```rust
pool.status = PoolStatus::Finalized;  // 第二次 withdraw 会被 NotFinalized 拦下
```

### 9.5 PDA 种子包含 mint

```rust
seeds = [b"pool", authority, sale_mint, quote_mint]
```

同 authority + 同 mint 组合不能重复开池。

## 10. 客户端代码模式

```typescript
// 推导所有 PDA
const [poolPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pool"), authority.toBuffer(), saleMint.toBuffer(), quoteMint.toBuffer()],
  programId,
);
const [saleVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("sale_vault"), poolPda.toBuffer()], programId,
);
const [quoteVault] = PublicKey.findProgramAddressSync(
  [Buffer.from("quote_vault"), poolPda.toBuffer()], programId,
);
const [contribPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("contribution"), poolPda.toBuffer(), user.toBuffer()], programId,
);

// 用户 contribute
await program.methods
  .contribute(new BN(quoteAmount))
  .accounts({
    pool: poolPda,
    saleVault, quoteVault,
    contribution: contribPda,
    userQuoteAta,
    user: user.publicKey,
  })
  .signers([user])
  .rpc();
```

## 11. 业务流转总图

```
Authority                    Pool (PDA)                  User
    │                            │                        │
    │ create_pool                │                        │
    ├───────────────────────────▶│                        │
    │ (init sale_vault,          │                        │
    │  quote_vault)              │                        │
    │                            │                        │
    │ deposit_sale_token(100k)   │                        │
    ├───────────────────────────▶│                        │
    │                            │                        │
    │                            │   contribute(60)       │
    │                            │◀───────────────────────┤
    │                            │   (CPI: usdc→vault)   │
    │                            │                        │
    │                            │   contribute(5)        │
    │                            │◀───────────────────────┤
    │                            │                        │
    │                            │   claim                │
    │                            │   (CPI: sale→user)    │
    │                            │◀───────────────────────┤
    │                            │                        │
    │ withdraw (Succeeded)       │                        │
    ├───────────────────────────▶│                        │
    │ (CPI: vault→auth)          │                        │
    │                            │                        │
```

## 12. 教学简化点

| 简化点                          | 真实场景应加                                       |
| ------------------------------- | -------------------------------------------------- |
| 每个 user 只能 contribute 一次  | 累加模式（用 `contribute += amount`）              |
| 状态在调用时判定                | 显式 `finalize` 指令 + 时间锁                      |
| 无白名单                        | 白名单 PDA / merkle root                            |
| 无 vesting                      | 用户领取按时间解锁的 schedule                       |
| 无多轮销售                      | Round PDA + 阶段推进                                |
| 无 emergency cancel             | pause / cancel authority                            |

## 13. 课后检查清单

- [ ] 我能解释为什么两个 vault 的 authority 都必须是 PDA。
- [ ] 我能写出 `withdraw` 在 Succeeded / Failed 两种情况下分别做什么。
- [ ] 我能解释 `seeds = [b"pool", authority, sale_mint, quote_mint]` 怎么防止同 authority 重复开池。
- [ ] 我能列出至少 3 个 EVM IDO 合约里需要、SPL Launchpad 也需要重新设计的点。
- [ ] 我能区分 `active` / `succeeded` / `failed` / `finalized` 状态各自的可达性。
- [ ] 我能解释为什么 claim 后还要保留 `contribution` 账户（事件溯源）。
- [ ] 我能解释软顶/硬顶判定 vs 时间锁定的两种安全模型。

## 14. 下一步

- Lesson 20：Prediction Market（二元市场 + Position PDA + authority resolve）
