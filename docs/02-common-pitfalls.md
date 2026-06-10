# Lesson 02：Solidity 开发者最容易踩的 10 个坑

> 目标读者：Solidity 开发者
>
> 本节不讲 Solana 概念地图，只讲 10 个具体的"我以为它和 EVM 一样，结果不是"的坑。每个坑都给出 EVM 习惯、Solana 正确模型、最小示例、实战排查建议。

---

## 坑 1：msg.sender 不存在

### EVM 习惯

Solidity 合约里可以直接读 `msg.sender`，得到调用者地址。

```solidity
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }
}
```

### Solana 正确模型

Solana 里没有 `msg.sender` 这种全局变量。调用者必须**显式**作为 `Signer` 出现在 transaction 的账户列表里，然后在 instruction struct 中通过 `Signer` 账户类型拿到。

```rust
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let user = &ctx.accounts.user;          // Signer 账户
    let vault = &mut ctx.accounts.vault;
    vault.balances[user.key()] += amount;
    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,    // ← 调用者必须显式声明
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}
```

**类比边界**：Anchor 的 `Signer` 在概念上等价于 `msg.sender`，但**它不会自动出现**，必须由客户端把它写进 transaction。

### 实战排查

- 错误：忘记把 `user` 加到 `#[derive(Accounts)]` 列表里 → transaction 构造失败。
- 错误：在 instruction 里假设 `user` 是某个固定地址 → 客户端需要按需替换。
- 正确：始终把"调用方"作为 `Signer` 显式声明。

---

## 坑 2：mapping 不存在

### EVM 习惯

Solidity 的 `mapping(address => T)` 是合约自带的哈希表。

```solidity
mapping(address => uint256) public balances;
```

### Solana 正确模型

Solana 没有 `mapping`。你要表达"按 key 索引数据"时，必须为每条记录**显式创建一个 Account**，并通过 PDA 让地址可推导。

```rust
// 等价于 mapping(address => UserProfile)
#[account]
pub struct UserProfile {
    pub authority: Pubkey,
    pub name: String,
    pub bio: String,
}

#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 4 + 50 + 4 + 200,
        seeds = [b"profile", user.key().as_ref()],
        bump
    )]
    pub profile: Account<'info, UserProfile>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

**类比边界**：PDA 看起来像 `mapping`，但它实际上**就是 Account**。每个 profile 都是一个独立的链上账户，要付 rent、要有 space、要有 owner。

### 实战排查

- 错误：试图在 Program 里维护哈希表 → 链上做不到，状态必须在 Account 里。
- 错误：用普通 keypair 钱包地址作为 "key" → 不可推导，前端无法在签名前知道地址。
- 正确：使用 PDA，seeds 设计要让前端能通过 `findProgramAddressSync` 推导出来。

---

## 坑 3：storage 不存在

### EVM 习惯

Solidity 合约的 storage 字段是隐式存在的，部署时自动分配。

```solidity
contract Game {
    uint256 public score;     // storage slot 0
    address public player;    // storage slot 1
}
```

### Solana 正确模型

Solana Account 没有"自动 storage"。你必须**显式定义 struct**，并**提前算好**需要多少字节。

```rust
#[account]
pub struct Game {
    pub score: u64,    // 8 bytes
    pub player: Pubkey, // 32 bytes
}

// 创建时必须指定 space
#[account(init, payer = user, space = 8 + 8 + 32)]
pub game: Account<'info, Game>,
```

**为什么是 8 + 8 + 32**？

- `8` 字节是 Anchor 的 discriminator（用于反序列化时识别账户类型）。
- `8` 字节是 `u64`。
- `32` 字节是 `Pubkey`。

### 实战排查

- 错误：忘了加 discriminator 8 字节 → 反序列化时 anchor 会报错。
- 错误：String 长度算错 → 写入时越界。
- 正确：每个 account 都定义常量 `MAX_NAME_LEN`、`MAX_BIO_LEN` 等，并明确写出 space 计算。

---

## 坑 4：Program 不保存状态

### EVM 习惯

"我的合约里有这个状态"是非常自然的表述。

```solidity
contract MyContract {
    uint256 public totalSupply;  // 我的合约有 totalSupply
}
```

### Solana 正确模型

Program 是**无状态**的。你必须说"我有一个 Account，owner 是我的 Program，它里面有 totalSupply"。

```rust
// 错误思维：Program 里有 totalSupply
// 正确思维：Account pool (owner = my_program) 的 data 里有 total_supply

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub total_supply: u64,  // ← 数据在 Account 里
}
```

### 实战排查

- 错误：在 instruction 里写"修改我的状态" → Program 自己没东西可改。
- 正确：每个有状态的功能都有一个对应的 Account 结构体。

---

## 坑 5：所有账户必须显式传入

### EVM 习惯

Solidity 合约可以直接读 `block.timestamp`、`msg.sender`、调用其它合约的 storage。

```solidity
function getPrice() external view returns (uint256) {
    return oracle.price();   // 不用显式声明 oracle 地址
}
```

### Solana 正确模型

Solana 的 transaction 必须**显式列出**所有要操作的 Account。instruction 不能"自己去找"某个账户。

```rust
#[derive(Accounts)]
pub struct GetPrice<'info> {
    pub oracle: Account<'info, OracleAccount>,  // ← 客户端必须传
}
```

**为什么这么严？**

- 显式声明让运行时可以并行执行不冲突的交易。
- 显式声明让钱包、dApp 在签名前能告诉用户"这笔交易会动哪些账户"。

### 实战排查

- 错误：transaction 里漏掉某个账户 → Anchor 报错 `AccountNotFound`。
- 错误：账户可写性没标 `mut` → 运行时报 `AccountNotWritable`。
- 正确：每个 instruction 的 `#[derive(Accounts)]` 都要把需要的账户列全。

---

## 坑 6：PDA 不是钱包地址

### EVM 习惯

EVM 里所有地址都是 EOA（外部账户）或合约账户。你不需要区分。

### Solana 正确模型

Solana 有两种地址：

- **普通地址**：由 keypair 私钥控制，链上签名由 Ed25519 验证。
- **PDA（Program Derived Address）**：由 Program ID + seeds 推导出来的地址，**没有私钥**，只能由对应 Program 用 `invoke_signed` 模拟签名。

```rust
// 推导 PDA
let (pda, bump) = Pubkey::find_program_address(
    &[b"vault", user.key().as_ref()],
    &program_id,
);

// Program 模拟签名的方式
invoke_signed(
    &system_instruction::transfer(pda, target, amount),
    &[pda_account.clone()],
    &[&[b"vault", user.key().as_ref(), &[bump]]],
)?;
```

**类比边界**：PDA 在概念上可以类比合约地址（"没有私钥，只能被合约逻辑控制"），但 PDA 是**确定性可推导**的，前端能离线算出地址。

### 实战排查

- 错误：以为 PDA 可以用 wallet adapter 签名 → 钱包根本拿不到私钥。
- 错误：seed 字符串忘记加 `&[bump]` → 签名校验失败。
- 正确：PDA 操作必须用 `invoke_signed` 或 `CpiContext::new_with_signer`。

---

## 坑 7：CPI ≠ Contract Call

### EVM 习惯

Solidity 里调另一个合约就是简单的 `contractB.foo()`。

```solidity
contract A {
    function callB() external {
        contractB.foo();
    }
}
```

### Solana 正确模型

Solana 的 CPI（Cross-Program Invocation）有严格的限制：

- 只能调用 `invoke` 或 `invoke_signed`。
- 被调 Program 看到的账户、签名、权限完全沿用调用方。
- PDA 签名能力只能传一层（CPI 中再 invoke_signed 时，权限不会无限传递）。

```rust
// 调用 SPL Token Program 转账
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64) -> Result<()> {
    let cpi_accounts = Transfer {
        from:      ctx.accounts.from.to_account_info(),
        to:        ctx.accounts.to.to_account_info(),
        authority: ctx.accounts.authority.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    Ok(())
}
```

**类比边界**：CPI 比 EVM 的合约调用更"显式"——你必须自己列出要传过去的账户、program、signer seeds。

### 实战排查

- 错误：PDA 调 PDA 时忘了用 `new_with_signer` → 签名校验失败。
- 错误：在 CPI 链上过深 → 实际上 Solana 对 CPI 深度有上限。
- 正确：尽量让 CPI 调用扁平，不要做"Program A → Program B → Program C"的链。

---

## 坑 8：Account Space 必须提前计算

### EVM 习惯

Solidity 的 storage 字段是动态的，编译时不需要你算字节数。

```solidity
string public name;  // 多长都行
```

### Solana 正确模型

Solana Account 的 size 是**创建时固定**的。后续写入不能超过这个 size。

```rust
// String 在 Solana 里是 4 字节长度 + N 字节内容
pub struct UserProfile {
    pub name: String,  // 4 + max_name_len
    pub bio: String,   // 4 + max_bio_len
}

// 创建时
#[account(
    init,
    payer = user,
    space = 8 + 32 + (4 + 50) + (4 + 200),
    seeds = [b"profile", user.key().as_ref()],
    bump
)]
pub profile: Account<'info, UserProfile>,
```

**空间计算公式**：

```text
Discriminator = 8 Bytes
Pubkey       = 32 Bytes
u64          = 8 Bytes
bool         = 1 Byte
String       = 4 + length
Vec<T>       = 4 + size(T) * count
Option<T>    = 1 + size(T)
```

### 实战排查

- 错误：String 写超长 → 交易 revert。
- 正确：定义 `MAX_NAME_LEN` 常量，写入时 `require!(name.len() <= MAX_NAME_LEN)`。

---

## 坑 9：Rent 机制

### EVM 习惯

EVM 合约部署后状态"永久"在链上，开发者不需要关心存储成本。

### Solana 正确模型

Solana 的 Account 需要存 SOL 来"买"它的存储空间，这叫 **rent**。两种处理方式：

1. **预付 rent**：创建时一次性转入足够 SOL 让 Account 变成 rent-exempt（推荐）。
2. **不预付**：必须持续支付 rent，否则账户会被回收（极少使用）。

```rust
// 创建一个 rent-exempt account 至少需要的 lamports
let rent = Rent::get()?;
let lamports = rent.minimum_balance(space);
```

**Anchor 怎么处理？** 当你写 `#[account(init, payer = user, space = X)]` 时，Anchor 会自动从 `user` 转入足够 lamports 让账户 rent-exempt。**你需要保证 payer 有足够 SOL**。

### 实战排查

- 错误：测试时 payer 余额不足 → `AccountNotRentExempt` 错误。
- 错误：以为 rent 是"每年扣费" → 其实是一次性预付。
- 正确：本地测试时多用 `airdrop` 或 `system.transfer` 给测试账户打钱。

---

## 坑 10：Upgradeable Program

### EVM 习惯

Solidity 用 Proxy 模式升级：

```solidity
contract Proxy {
    address public implementation;
    fallback() external payable {
        delegatecall(implementation);
    }
}
```

升级 = 改 `implementation` 指向新合约。

### Solana 正确模型

Solana 的 Program 升级机制完全不同：

- Program 的代码部署在 BPF Loader 管理的账户中。
- 升级权限（Upgrade Authority）是一个 keypair，谁持有它谁就能上传新字节码。
- 升级 = **替换整段字节码**，不是改地址。

```bash
# 部署并保留升级权限
anchor deploy --program-name my_program

# 升级
anchor upgrade target/deploy/my_program.so --program-id <PROGRAM_ID> --provider.cluster devnet
```

**类比边界**：Solana 的 Upgradeable Program 比 EVM Proxy 简单，但更"硬"——你换的是字节码本身，没有 `delegatecall` 的"老 storage 复用"那种复杂语义。

### 实战排查

- 错误：以为 Program 部署后就完全不可变 → 默认有 upgrade authority。
- 正确：上线前用 `anchor deploy --final` 撤销升级权限，让 Program 永远不可变。
- 正确：升级权限保管在 multisig / 硬件钱包里，绝不能放在 CI 的密钥。

---

## 迁移检查清单

完成本节后，你应该能够：

- [ ] 解释 `msg.sender` 在 Solana 里的等价物。
- [ ] 解释为什么 `mapping` 必须用 PDA 表达。
- [ ] 解释 Program 为什么没有 storage。
- [ ] 解释为什么每个 instruction 都要显式声明 Account。
- [ ] 区分 PDA 和普通地址，知道 PDA 没有私钥。
- [ ] 解释 CPI 与合约调用的差异。
- [ ] 计算常见类型的字节数。
- [ ] 解释 rent 机制。
- [ ] 解释 Upgradeable Program 与 EVM Proxy 的差异。

如果有任何一项答不上来，回到对应小节重新阅读。

---

**最后更新：** 2026-06-10
