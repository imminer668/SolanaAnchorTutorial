# Lesson 20 - Prediction Market 文档

> 面向 EVM 开发者：把 EVM 二元预测市场的 `mapping(address=>uint256)` 状态，拆成 Solana 的 Market + Position + Vault 三类 PDA。

## 1. EVM Prediction Market 模型

```solidity
contract BinaryMarket {
    address public oracle;          // 主持人
    string public question;
    uint256 public endTime;
    uint256 public totalYes;
    uint256 public totalNo;
    bool public resolved;
    uint8 public winningOutcome;    // 1=Yes, 2=No

    mapping(address => uint256) public bets;   // user => side amount (累加)
    mapping(address => uint8) public sides;    // user => 1 or 2
    mapping(address => bool) public claimed;

    function bet(uint8 side, uint256 amount) external {
        require(block.timestamp < endTime, "ended");
        require(!resolved, "resolved");
        bets[msg.sender] = amount;
        sides[msg.sender] = side;
        if (side == 1) totalYes += amount;
        else totalNo += amount;
        IERC20(quote).transferFrom(msg.sender, address(this), amount);
    }

    function resolve(uint8 outcome) external {
        require(msg.sender == oracle);
        require(block.timestamp >= endTime);
        resolved = true;
        winningOutcome = outcome;
    }

    function claim() external {
        require(resolved);
        require(sides[msg.sender] == winningOutcome, "lost");
        uint256 totalPool = totalYes + totalNo;
        uint256 winningTotal = winningOutcome == 1 ? totalYes : totalNo;
        uint256 reward = bets[msg.sender] * totalPool / winningTotal;
        IERC20(quote).transfer(msg.sender, reward);
        claimed[msg.sender] = true;
    }
}
```

特征：
- 一个合约持有所有资金 + 所有状态
- `mapping` 直接表达"谁投了哪边多少"
- `msg.sender` 来自交易

## 2. Solana Prediction Market 模型

```text
              ┌─────────────────────────────┐
              │        Market PDA           │
              │  authority / market_id /    │
              │  quote_mint / question /    │
              │  end_time /                 │
              │  total_a / total_b /        │
              │  resolved / winning_outcome │
              └─────────┬───────────────────┘
                        │
              ┌─────────▼──────────┐
              │   vault PDA        │
              │   TokenAccount     │
              │   mint=quoteMint   │
              │   authority=vault  │
              └────────────────────┘

   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Position │  │ Position │  │ Position │
   │ (Alice)  │  │ (Bob)    │  │ (Carol)  │
   │  outcome │  │  outcome │  │  outcome │
   │  amount  │  │  amount  │  │  amount  │
   └──────────┘  └──────────┘ └───────────┘
```

- **Market PDA**：市场元数据
- **vault PDA**：所有 quote token 池子
- **Position PDA**：每个用户在该市场的下注记录
- 没有 `msg.sender`，用 `user: Signer` + PDA seeds 验证

## 3. 三大账户结构

### 3.1 Market

```rust
pub struct Market {
    pub authority: Pubkey,        // 32 - 主持人 (oracle 替代)
    pub market_id: u64,           // 8 - 同一 authority + quote_mint 下的市场编号
    pub quote_mint: Pubkey,       // 32
    pub vault: Pubkey,            // 32
    pub question: String,         // 4 + N (max 200)
    pub end_time: i64,            // 8
    pub total_a: u64,             // 8 - OutcomeA 总投注
    pub total_b: u64,             // 8 - OutcomeB 总投注
    pub resolved: bool,           // 1
    pub winning_outcome: u8,      // 1 - 0=未决, 1=A, 2=B
    pub bump: u8,                 // 1
}
// SIZE = 8 + 32*3 + 8 + 4 + 200 + 8*3 + 1 + 1 + 1 = 343
```

### 3.2 Position

```rust
pub struct Position {
    pub market: Pubkey,    // 32
    pub user: Pubkey,      // 32
    pub outcome: u8,       // 1
    pub amount: u64,       // 8
    pub claimed: bool,     // 1
    pub bump: u8,          // 1
}
// SIZE = 8 + 32*2 + 1 + 8 + 1 + 1 = 83
```

### 3.3 vault

标准 SPL Token Account PDA：
- `mint = quote_mint`
- `authority = vault_pda`

## 4. 业务流转

```
Authority                Market (PDA)                User
    │                        │                        │
    │ create_market          │                        │
    ├───────────────────────▶│                        │
    │ (init market + vault)  │                        │
    │                        │                        │
    │                        │   place_bet(1, 60)     │
    │                        │◀───────────────────────┤
    │                        │   (CPI: usdc→vault)   │
    │                        │   total_a += 60       │
    │                        │                        │
    │                        │   place_bet(2, 40)     │
    │                        │◀───────────────────────┤
    │                        │   total_b += 40       │
    │                        │                        │
    │ resolve(1)             │                        │
    │ (after end_time)       │                        │
    ├───────────────────────▶│                        │
    │                        │ resolved=true          │
    │                        │ winning_outcome=1      │
    │                        │                        │
    │                        │   claim                │
    │                        │   reward=60/60*100    │
    │                        │   (CPI: vault→user)   │
    │                        │◀───────────────────────┤
```

## 5. 关键指令详解

### 5.1 place_bet

```rust
// CPI: user_quote_ata -> vault
token::transfer(cpi_ctx, amount)?;

// init Position PDA
let position = &mut ctx.accounts.position;
position.market = market.key();
position.user = ctx.accounts.user.key();
position.outcome = outcome;
position.amount = amount;
position.claimed = false;
position.bump = ctx.bumps.position;

// 更新市场总额
if outcome == A { market.total_a += amount; }
else { market.total_b += amount; }
```

**注意**：PDA `init` 失败 = 重复下注被自动拦截。等同 EVM `mapping[user]` 已被设置时的"user already bet"检查。

### 5.2 claim

```rust
require!(position.outcome == market.winning_outcome, Lost);
let winning_total = if A won { market.total_a } else { market.total_b };
let total_pool = market.total_a + market.total_b;
let reward = (position.amount as u128 * total_pool as u128 / winning_total as u128) as u64;

// CPI: vault -> user_quote_ata, PDA 签名
let signer_seeds = &[&[b"vault", market.key().as_ref(), &[ctx.bumps.vault]]];
token::transfer(CpiContext::new_with_signer(...), reward)?;
```

**奖励公式含义**：
- 赢家拿回自己那部分 + 输家贡献的部分
- `(user / winning) * (winning + losing) = user * (1 + losing/winning)`
- 例：60 投 A 赢 + 40 投 B 输，60/60*100 = 100（赢得全部池子）

## 6. 失败路径设计

| 场景                   | 触发的检查                       | 错误码           |
| ---------------------- | -------------------------------- | ---------------- |
| 重复下注               | Position PDA init 失败             | (SystemProgram)  |
| 无效 outcome           | outcome != 1 && != 2              | InvalidOutcome   |
| 创建已过期市场         | end_time <= now                   | InvalidTime      |
| 截止后下注             | now >= end_time                   | Ended            |
| 市场已 resolve         | market.resolved 检查              | AlreadyResolved  |
| resolve 用错 outcome   | 同样 InvalidOutcome 检查          | InvalidOutcome   |
| resolve 早于 end_time  | now < end_time                    | NotEnded         |
| 非 authority resolve   | has_one = authority               | NotAuthority     |
| resolve 前 claim       | !market.resolved                  | NotResolved      |
| 输家 claim             | position.outcome != winning       | Lost             |
| 重复 claim             | !position.claimed                 | AlreadyClaimed   |
| vault 余额不足         | Anchor 自动检查                   | (Token Program)  |

## 7. 与 EVM 关键差异

| 维度          | EVM                          | Solana                                |
| ------------- | ---------------------------- | ------------------------------------- |
| 一人下多次    | 累加（不报错）                | PDA init 失败                          |
| 状态归属      | 合约 storage                  | Market / Position PDA                 |
| 资金托管      | 合约地址 (EOA-like)          | TokenAccount PDA (PDA 签 CPI)         |
| 时间校验      | `block.timestamp`            | `Clock::get()?.unix_timestamp`         |
| oracle        | 中心化 (msg.sender)          | authority PDA + has_one              |
| query 状态    | `mapping(addr)` / public var | `fetch(Market)` / `fetch(Position)`    |

## 8. 教学简化

| 简化点                  | 真实场景应加                              |
| ----------------------- | ----------------------------------------- |
| authority 单点 resolve  | Chainlink / Switchboard / Pyth oracle 接入 |
| 没有时间锁              | 强制 `now >= end_time` 后才能 resolve      |
| 没有 creator fee        | market 抽 1-2% 平台费                     |
| 没有最小下注额          | `require!(amount >= MIN_BET)`             |
| 没有 max bet per user   | 防巨鲸：`(total + amount) <= MAX_SHARE`  |
| 二元市场                | 多 outcome (N>2) 用 LMSR 或 parimutuel    |
| 没有 liquidity 提供     | LMSR 形式自动做市                          |
| 没有紧急 pause          | authority 可 freeze market                 |

## 9. Oracle 集成的真实生产模式

```text
方案 A：External Oracle Push
  - 主持人 = multisig (Gnosis Safe)
  - resolve(winning_outcome) 时 require multisig 签名

方案 B：Pyth / Switchboard Pull
  - market.seeds = [b"market", pyth_price_feed, threshold]
  - resolve 时调用 pyth_program 拉价格，与 threshold 比较
  - 自动 resolve，无人主持

方案 C：UMA Optimistic Oracle
  - 用户可以 dispute
  - dispute window 过期后无人 dispute → resolve 生效
  - 涉及质押 + 罚没
```

本课不实现这些；用 `authority` 作为教学抽象。

## 10. 客户端代码模式

```typescript
// 推导所有 PDA
const marketIdBuffer = Buffer.alloc(8);
marketIdBuffer.writeBigUInt64LE(BigInt(marketId));

const [marketPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("market"), authority.toBuffer(), quoteMint.toBuffer(), marketIdBuffer],
  programId,
);
const [vaultPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), marketPda.toBuffer()], programId,
);
const [positionPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("position"), marketPda.toBuffer(), user.toBuffer()], programId,
);

// 用户下注
await program.methods
  .placeBet(outcome, new BN(amount))
  .accounts({
    market: marketPda, vault: vaultPda,
    position: positionPda, userQuoteAta,
    user: user.publicKey,
  })
  .signers([user])
  .rpc();

// 主持人 resolve
await program.methods
  .resolve(new BN(winningOutcome))
  .accounts({ market: marketPda, authority: authority.publicKey })
  .rpc();

// 赢家 claim
await program.methods
  .claim()
  .accounts({
    market: marketPda, vault: vaultPda,
    position: positionPda, userQuoteAta,
    user: user.publicKey,
  })
  .signers([user])
  .rpc();
```

## 11. 课后检查清单

- [ ] 我能解释为什么 `place_bet` 失败 (重复下注) 等同 EVM `mapping[user]` 已被设置。
- [ ] 我能写出奖励分配公式并解释为什么赢家拿到 100% 池子。
- [ ] 我能解释为什么 vault 的 authority 必须是 PDA。
- [ ] 我能列出至少 3 种 Oracle 接入方式。
- [ ] 我能解释为什么本课用 `authority` 替代 oracle 是简化。
- [ ] 我能识别"输家也能 claim 拿回自己的下注"为什么是反例（输家只能归 0）。

## 12. 下一步

- Lesson 21：Anchor 安全开发（横向审查所有项目）
- Lesson 22-23：Anchor 测试体系、错误码与事件
