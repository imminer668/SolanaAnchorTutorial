# Lesson 08 - SPL Token 文档

> 面向 EVM 开发者的 SPL Token 实战讲解

## 1. SPL Token 与 ERC20 的核心差异

| 维度         | ERC20                          | SPL Token                       |
| ------------ | ------------------------------ | ------------------------------- |
| 代码位置     | 每个项目自己写                  | 官方 SPL Token Program           |
| 状态位置     | 合约 storage                   | Mint + Token Account            |
| 余额记录     | 合约内 mapping                  | 每个用户各自的 Token Account     |
| 部署         | 部署一个合约                    | 创建 Mint（无代码部署）          |
| 增发权限     | onlyOwner                       | Mint Authority                  |
| 销毁         | contract.burn()                 | close_account 或 burn            |

**关键差异**：

- **不要自己写 ERC20 等价物**。SPL Token Program 已经做了所有事情。
- 余额不在某个合约的 storage 里，而在每个用户自己的 Token Account 里。

## 2. SPL Token 的三个核心概念

### Mint Account

```text
地址: 32 字节 (Pubkey)
Owner: SPL Token Program
Data:
  - mint_authority: Pubkey (32 bytes) - 谁能 mint
  - supply: u64 (8 bytes) - 当前总供应
  - decimals: u8 (1 byte) - 小数位
  - is_initialized: bool (1 byte) - 是否初始化
  - freeze_authority: Option<Pubkey> (36 bytes) - 谁能 freeze
```

### Token Account

```text
地址: 32 字节 (Pubkey)
Owner: SPL Token Program
Data:
  - mint: Pubkey (32 bytes) - 这个 account 属于哪个 mint
  - owner: Pubkey (32 bytes) - 谁能从这个 account 转账
  - amount: u64 (8 bytes) - 当前余额
  - delegate: Option<Pubkey> (36 bytes) - 被授权人
  - state: u8 (1 byte) - 账户状态
  - close_authority: Option<Pubkey> (36 bytes)
```

### Associated Token Account (ATA)

```text
ATA = 确定性推导的 Token Account

推导公式:
ATA = find_program_address(
  [owner_pubkey, TOKEN_PROGRAM_ID, mint_pubkey],
  ATA_PROGRAM_ID
)

每个 (owner, mint) 组合有且仅有一个 ATA。
```

## 3. Anchor 写法

### 创建 Mint

```rust
#[derive(Accounts)]
pub struct CreateMint<'info> {
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = mint_authority.key(),
    )]
    pub mint: Account<'info, Mint>,

    pub mint_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}
```

`mint::decimals` 和 `mint::authority` 是 Anchor 的特殊约束，用于初始化 Mint 的字段。

### Mint Token

```rust
let cpi_accounts = MintTo {
    mint: ctx.accounts.mint.to_account_info(),
    to: ctx.accounts.destination.to_account_info(),
    authority: ctx.accounts.mint_authority.to_account_info(),
};
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),
    cpi_accounts,
);
token::mint_to(cpi_ctx, amount)?;
```

这是 **CPI 调用 SPL Token Program**。

### Transfer Token

```rust
let cpi_accounts = Transfer {
    from: ctx.accounts.source.to_account_info(),
    to: ctx.accounts.destination.to_account_info(),
    authority: ctx.accounts.source_authority.to_account_info(),
};
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),
    cpi_accounts,
);
token::transfer(cpi_ctx, amount)?;
```

## 4. ERC20 对照

### Solidity 视角

```solidity
// 部署 ERC20
contract MyToken is ERC20 {
    constructor() ERC20("MyToken", "MTK") {
        _mint(msg.sender, 1000000 * 10 ** 18);
    }
}

// 转账
IERC20(token).transfer(to, amount);

// 查余额
IERC20(token).balanceOf(addr);
```

### Solana 视角

```ts
// 1. 创建 Mint（一次）
const mint = await createMint(connection, payer, mintAuthority, null, 9);

// 2. 给每个用户创建 ATA
const ata = getAssociatedTokenAddressSync(mint, user);
await createAssociatedTokenAccount(connection, payer, mint, user);

// 3. Mint
await mintTo(connection, payer, mint, ata, mintAuthority, amount);

// 4. Transfer
await transfer(connection, payer, sourceAta, destAta, sourceOwner, amount);

// 5. 查余额
const account = await getAccount(connection, ata);
console.log(account.amount);
```

## 5. 教学重点

### 不要重新发明轮子

```solidity
// 不要这样写
contract MyToken {
    mapping(address => uint256) balances;
    // ... 完全没必要
}
```

```rust
// 也不要这样写
pub struct TokenAccount {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}
// 已经有官方版本，直接用 SPL Token Program
```

### Mint 是一切的源头

```text
用户A 拥有 100 tokens
  ↓
他的 Token Account 记录 amount = 100
  ↓
所有用户的 amount 加起来 = Mint 的 supply
```

如果你用 `mintTo` 增发了 100，但用户 ATA 没记录，那就是账目不平衡了。**SPL Token Program 自动维护这个不变性**。

### decimals 在创建时固定

```rust
mint::decimals = 9   // 9 位小数
```

USDC 用 6，SOL 用 9，WETH 用 8。一旦创建，**不可改**。

## 6. 与 EVM 的关键差异

| 维度           | ERC20                  | SPL Token                 |
| -------------- | ---------------------- | ------------------------- |
| 状态结构       | 合约内集中式           | 分布式（每个用户一个账户） |
| 增发           | 合约函数               | Mint Authority 签名       |
| 跨合约读取余额 | 合约内直接读           | 需 RPC 读 ATA             |
| 全表扫描       | 遍历 mapping event     | getProgramAccounts RPC    |
| 销毁           | burn() 函数            | close ATA 退 rent         |

## 7. 常见误区

### 误区 1：每个用户都要自己创建 ATA

对。**每个 (owner, mint) 组合都需要显式创建 ATA**。ATA 不存在时转账会失败。

### 误区 2：转账不指定 owner

错。SPL Token 转账必须由 Token Account 的 owner 签名（或 delegate）。

### 误区 3：decimals 可以后改

错。decimals 在创建 Mint 时固定。

## 8. 课后检查清单

- [ ] 我能解释 ERC20 与 SPL Token 的本质差异。
- [ ] 我能解释 Mint Account、Token Account、ATA 三者关系。
- [ ] 我能解释为什么"状态在 Token Account 里，不在 Mint 里"。
- [ ] 我能用 Anchor 写出 create_mint / mint_to / transfer。
- [ ] 我能解释为什么每个用户都需要 ATA。
- [ ] 我能解释 decimals 的作用和为什么不能改。

## 9. 下一步

- Lesson 09：Token2022（带 transfer fee、metadata pointer 等扩展）
- Lesson 12：NFT（Metaplex）
- Lesson 16：Escrow（SPL Token 实战）
