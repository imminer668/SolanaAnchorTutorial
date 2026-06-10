# Lesson 16 - Escrow 文档

> 面向 EVM 开发者的 Solana Escrow 实战讲解

## 1. 什么是 Escrow？

托管交易：买卖双方把资产暂存到第三方，第三方按规则释放。

- Maker 想要卖出 token_a 换 token_b
- Taker 愿意出 token_b 买 token_a
- 双方把 token 都交给"托管合约"，托管合约按规则交换

## 2. EVM 视角 vs Solana 视角

### Solidity 视角

```solidity
contract Escrow {
    struct Deal {
        address maker;
        IERC20 tokenA;
        IERC20 tokenB;
        uint256 amountA;
        uint256 amountB;
    }

    mapping(uint256 => Deal) public deals;
    mapping(uint256 => address) public vaultA;
    mapping(uint256 => address) public vaultB;

    function create(uint256 id, uint256 amountA, uint256 amountB) external {
        deals[id] = Deal(msg.sender, ...);
        // 状态全在合约内
    }

    function deposit(uint256 id, uint256 amount) external {
        // maker 把 tokenA 转给合约
        IERC20(tokenA).transferFrom(msg.sender, address(this), amount);
    }

    function exchange(uint256 id) external {
        // taker 把 tokenB 转给 maker
        // 合约把 tokenA 转给 taker
    }
}
```

EVM 合约内集中持有所有 escrow 的状态和 token。

### Solana 视角

```rust
// 每个 escrow 是独立的 PDA
// 每个 vault 是独立的 Token Account PDA
// Maker/Taker 各自有 ATA

// Escrow PDA
#[account]
pub struct Escrow {
    pub maker: Pubkey,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub escrow_id: u64,
}
```

Solana 把每个 escrow 拆成多个独立 Account。

## 3. 账户模型详解

### Escrow PDA

```text
seeds = [b"escrow", maker.key().as_ref(), escrow_id.to_le_bytes()]

每个 (maker, escrow_id) 组合有且仅有一个 Escrow PDA。
```

### Vault Token Account PDA

```text
seeds = [b"vault", escrow.key().as_ref()]

vault 是 Token Account，其地址是 PDA。
vault 的 owner 是 Escrow PDA（让 program 可以操作）。
```

### PDA 关系图

```text
Maker wallet
  │
  │ 创建
  ▼
Escrow PDA
  │
  │ 派生
  ▼
Vault Token Account (PDA)
  │
  │ 由 program 拥有
  ▼
持有 token_a
```

## 4. 完整流程

### 步骤 1：create_escrow

```rust
pub fn create_escrow(
    ctx: Context<CreateEscrow>,
    escrow_id: u64,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    // 1. 初始化 Escrow PDA
    let escrow = &mut ctx.accounts.escrow;
    escrow.maker = ctx.accounts.maker.key();
    escrow.mint_a = ctx.accounts.mint_a.key();
    escrow.mint_b = ctx.accounts.mint_b.key();
    escrow.amount_a = amount_a;
    escrow.amount_b = amount_b;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault;
    escrow.escrow_id = escrow_id;

    // 2. 把 vault 的 owner 改为 Escrow PDA
    token::set_authority(
        CpiContext::new(token_program, SetAuthority {
            account_or_mint: vault.to_account_info(),
            current_authority: maker.to_account_info(),
        }),
        AuthorityType::AccountOwner,
        Some(escrow.key()),
    )?;
    Ok(())
}
```

**关键点**：

- `set_authority` 把 vault 的 owner 从 maker 改为 Escrow PDA。
- 这样 Escrow PDA 可以模拟签名操作 vault。

### 步骤 2：deposit_token

```rust
pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
    require!(amount == escrow.amount_a, ErrorCode::AmountMismatch);
    
    // maker 转 token_a 给 vault（maker 自己签名）
    token::transfer(CpiContext::new(token_program, Transfer {
        from: maker_token_a,
        to: vault,
        authority: maker,
    }), amount)?;
    Ok(())
}
```

注意：这里**不需要 PDA 签名**，因为是 maker 转账。

### 步骤 3：exchange

```rust
pub fn exchange(ctx: Context<Exchange>) -> Result<()> {
    // 1. taker 转 token_b 给 maker
    token::transfer(CpiContext::new(token_program, Transfer {
        from: taker_token_b,
        to: maker_token_b,
        authority: taker,
    }), escrow.amount_b)?;

    // 2. vault 转 token_a 给 taker（Escrow PDA 签名）
    let vault_seeds = &[b"vault", escrow.key().as_ref(), &[escrow.vault_bump]];
    token::transfer(CpiContext::new_with_signer(token_program, Transfer {
        from: vault,
        to: taker_token_a,
        authority: escrow,  // Escrow PDA 是 vault 的 owner
    }, &[vault_seeds]), escrow.amount_a)?;

    // 3. 关闭 vault（退 rent 给 maker）
    token::close_account(CpiContext::new_with_signer(token_program, CloseAccount {
        account: vault,
        destination: maker,
        authority: escrow,
    }, &[vault_seeds]))?;

    // escrow 账户也 close（accounts 里的 close = maker）
    Ok(())
}
```

**关键点**：

- 步骤 1：taker 普通签名转账
- 步骤 2-3：Escrow PDA 模拟签名（new_with_signer）

### 步骤 4：cancel

```rust
pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
    // 1. 退 token_a 给 maker（Escrow PDA 签名）
    // 2. 关闭 vault
    // 3. 关闭 escrow
}
```

类似 exchange 的逆过程。

## 5. EVM vs Solana 账户模型对照

```text
EVM:
  1 个合约
  ├── 100 个 deals (mapping)
  └── 100 个 vault 状态 (mapping)

Solana:
  N 个 Escrow PDA (每个 deal 一个)
  └── N 个 Vault Token Account PDA
  └── N+1 个独立 token transfer 记录
```

EVM 是"集中式账本"，Solana 是"分布式账本"。

## 6. 实战要点

### 双 PDA 设计

```text
escrow PDA: 保存业务状态
vault PDA: 保存托管资产

两个 PDA 的关系：vault 是 escrow 的"金库"
```

### 资产转移方向

```text
exchange 流程:
  taker_token_b ─→ maker_token_b
  vault ─→ taker_token_a

cancel 流程:
  vault ─→ maker_token_a
```

### 失败保护

- `exchange` 时如果 taker 余额不足：Anchor `constraint` 提前检查
- `deposit` 时如果金额不对：`require!` 运行时检查
- `cancel` 时如果不是 maker：`has_one` 校验

## 7. 与 EVM 的关键差异

| 维度         | EVM Escrow                  | Solana Escrow              |
| ------------ | --------------------------- | -------------------------- |
| 状态存储     | 合约 mapping                | 每个 deal 一个 PDA         |
| Token 托管   | 合约地址持有                | 独立 Token Account PDA     |
| PDA 签名     | 不需要                      | vault owner 必须是 PDA     |
| 关闭退 rent  | delete 不退                 | close 退 lamports          |
| 跨指令操作   | 直接调用                    | 显式 CPI                   |

## 8. 常见误区

### 误区 1：vault 不需要 set_authority

错。如果 vault owner 不是 Escrow PDA，program 无法用 PDA 签名操作它。必须用 `set_authority` 把 owner 改为 PDA。

### 误区 2：taker 可以白嫖 token_a

不会。exchange 时 taker 必须先转 token_b，anchor `constraint` 校验余额，失败回滚整个 transaction。

### 误区 3：cancel 后 token_a 留在 vault

错。cancel 会触发 vault close + token 退还，整个交易原子完成。

## 9. 课后检查清单

- [ ] 我能解释为什么需要双 PDA（escrow + vault）。
- [ ] 我能解释 set_authority 的作用。
- [ ] 我能解释 escrow 和 exchange 的 CPI 流程差异。
- [ ] 我能解释为什么 cancel 要关闭 vault。
- [ ] 我能解释 EVM escrow 与 Solana escrow 的账户模型差异。

## 10. 下一步

- Lesson 17：Voting（PDA 防重复投票）
- Lesson 18：Airdrop
- Lesson 19：Launchpad（多账户 + 时间窗口）
