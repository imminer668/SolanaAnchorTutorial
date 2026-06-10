# Lesson 21 - Anchor 安全开发

> 横向审查前面所有 Anchor 项目：把"看似对的写法"逐个拆解为"应该这么写"，并对应 EVM 习惯。

## 1. 总览

Solana 安全的核心是"账户"而不是"函数"。一段交易是否安全，取决于**你显式传入的账户是不是真的能代表那个业务对象**。EVM 安全的核心是"调用者"和"合约状态"——`msg.sender` 是天然可信的、合约 storage 不会假。

本课把 Anchor 开发中的高频风险归为 8 类：

| 风险类别         | 一句话                                            |
| ---------------- | ------------------------------------------------- |
| Signer 校验      | 关键操作必须由 `user: Signer` 显式签名            |
| Owner 校验       | 账户 owner 程序必须是预期 program                  |
| Seeds 校验       | PDA 推导必须用对 seeds + bump                      |
| Token 校验       | mint / authority / amount 全部要验证              |
| Close 风险       | `close` 后账户是否还残留引用                       |
| 整数溢出         | `checked_*` / `saturating_*` 强制使用             |
| 时间戳风险       | Clock 时钟可被 validator 操纵 ± 时间              |
| CPI 风险         | 目标 program 是不是预期、reinvoke 攻击、signer 滥用 |

下面每节用"错误写法 / 正确写法 / EVM 类比 / 实战检查点"四段式展开。

## 2. Signer 校验

### 2.1 错误写法

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    pub user: AccountInfo<'info>,  // ❌ 没说 user 必须签名
    // ...
}

pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(ctx.accounts.pool.authority == ctx.accounts.user.key(), NotAuthority);
    // 即使 pool.authority 检查通过，user 也没签名
    // attacker 可以传任何 user 进来比 pool.authority
    // ...
    Ok(())
}
```

### 2.2 正确写法

```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    pub user: Signer<'info>,  // ✅ 强制 user 签名
    // ...
}
```

或者用 `#[account(signer)]`：

```rust
#[account(signer)]
pub user: AccountInfo<'info>,
```

### 2.3 EVM 类比

- EVM：`msg.sender` **天然就是签名者**（外部账户必然签名）
- Solana：账户默认不签名，必须用 `Signer<'info>` 显式要求

EVM 迁移过来时最容易漏掉这一条：很多 EVM 函数第一行写 `require(msg.sender == owner, ...)`，但 Solana 里你必须先保证 user 真的签了名，否则 attacker 可以"伪造 owner key 但不签名"。

### 2.4 实战检查点

- [ ] 所有"用户主动操作"指令（withdraw、claim、refund、update）的 user 账户都是 `Signer<'info>`？
- [ ] authority-only 操作（withdraw_quote、finalize）的 authority 是 `Signer<'info>` + `has_one`？
- [ ] 没有用 `AccountInfo` 临时充当 signer？

## 3. Owner 校验

### 3.1 错误写法

```rust
#[derive(Accounts)]
pub struct ReadCounter<'info> {
    pub counter: AccountInfo<'info>,  // ❌ 没检查 owner
}

pub fn read_counter(ctx: Context<ReadCounter>) -> Result<u64> {
    let data = ctx.accounts.counter.try_borrow_data()?;
    // data 是任意 program 写入的，可能根本不是 counter
    // ...
    Ok(0)
}
```

### 3.2 正确写法

```rust
#[derive(Accounts)]
pub struct ReadCounter<'info> {
    #[account(owner = crate::ID)]  // 或省略，Account<'info, T> 默认会检查
    pub counter: Account<'info, Counter>,
}
```

`Account<'info, T>` 自动检查：
1. 账户 owner = 当前 program
2. discriminator 匹配
3. 反序列化成功

### 3.3 EVM 类比

- EVM：合约 storage 永远属于这个合约，不存在"假 storage"
- Solana：**任何账户都可以被任何 program 写入**。一个叫 "counter" 的账户可能根本不是 counter program 写的

EVM 习惯"读到 storage 就是合约自己的"，Solana 必须"先验证 owner + discriminator"。

### 3.4 实战检查点

- [ ] 所有"业务账户"都用 `Account<'info, MyType>` 而不是 `AccountInfo`？
- [ ] TokenAccount / Mint 用 `Account<'info, TokenAccount>` / `Account<'info, Mint>`？
- [ ] 想用未类型化账户时显式写 `owner = ...`？

## 4. Seeds 校验

### 4.1 错误写法

```rust
#[account(
    seeds = [b"vault", pool.key().as_ref()],  // ❌ bump 没声明
    bump,
)]
pub vault: Account<'info, TokenAccount>,
```

Anchor 0.31 之前 bump 不写会 panic；之后会自动推导但不存储 bump，业务侧无法重放。

更糟的情况：

```rust
#[account(
    seeds = [b"vault", pool.key().as_ref()],
    bump = 254,  // ❌ 硬编码 bump，可能错了
)]
pub vault: Account<'info, TokenAccount>,
```

### 4.2 正确写法

```rust
#[account(
    seeds = [b"vault", pool.key().as_ref()],
    bump,  // ✅ Anchor 自动找正确 bump
)]
pub vault: Account<'info, TokenAccount>,

// 如果业务侧要用 bump:
let pool = &mut ctx.accounts.pool;
pool.vault_bump = ctx.bumps.vault;  // 存到业务账户里
```

```rust
// 在 CPI 签名前：
let signer_seeds: &[&[&[u8]]] = &[&[
    b"vault",
    pool.key().as_ref(),
    &[ctx.bumps.vault],  // ✅ 用 ctx.bumps 而不是硬编码
]];
```

### 4.3 EVM 类比

- EVM：`mapping[bytes32]` 直接给一个 key 就行
- Solana：PDA seeds = 你自己定义 key 拼接，bump = 系统找的"修正值"

EVM 习惯"用 key 索引"；Solana 必须"用 seeds + bump 双锁定"。

### 4.4 实战检查点

- [ ] 所有 PDA 都用 `#[account(seeds = ..., bump)]` 不用硬编码？
- [ ] 业务账户里有 `bump: u8` 字段来存它对应的 bump？
- [ ] CPI 签名时用 `ctx.bumps.xxx` 不用 `*bump`？

### 4.5 跨指令的 PDA seeds 必须一致

```rust
// 创建时
seeds = [b"pool", authority, mint]

// 读取时
seeds = [b"pool", authority, mint]
// seeds 顺序、长度、内容必须完全一致，否则是不同 PDA
```

如果创建时 `seeds = [b"pool", authority.key().as_ref(), mint.key().as_ref()]`
读取时 `seeds = [b"pool", authority, mint]` 顺序一致但 key().as_ref() 隐式转换要小心。

## 5. Token 校验

### 5.1 错误写法

```rust
#[account(mut)]
pub user_token: Account<'info, TokenAccount>,  // ❌ 没检查 mint
```

```rust
// CPI 转账
token::transfer(cpi_ctx, amount)?;
// 没检查 user_token.owner == user
// attacker 可以传别人的 token 账户，把别人的 token 给自己
```

### 5.2 正确写法

```rust
#[account(
    mut,
    constraint = user_token.mint == expected_mint.key() @ ErrorCode::WrongMint,
    constraint = user_token.owner == user.key() @ ErrorCode::WrongOwner,
)]
pub user_token: Account<'info, TokenAccount>,
```

或者在 instructions 中显式要求 mint 账户：

```rust
pub mint: Account<'info, Mint>,

#[account(
    mut,
    token::mint = mint,  // 验证 token 的 mint
    token::authority = user,  // 验证 token 的 authority
)]
pub user_token: Account<'info, TokenAccount>,
```

### 5.3 EVM 类比

- EVM：`IERC20(token).transferFrom(from, to, amount)`，token 地址固定
- Solana：传入的 token 账户可能是任何 mint、任何 owner

EVM 习惯"合约 address 写死就行"；Solana 必须"每个 token 账户都验证 mint + owner"。

### 5.4 实战检查点

- [ ] 所有 TokenAccount 都 `constraint = xxx.mint == pool.mint`？
- [ ] 所有用户 ATA 都 `constraint = xxx.owner == user.key()`？
- [ ] 写入 vault 时 vault 是不是 PDA 自己持有 (token::authority = vault_pda)？

## 6. Close 风险

### 6.1 错误写法

```rust
pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
    let profile = &mut ctx.accounts.profile;
    profile.name = String::new();  // ❌ "软"清空
    profile.bio = String::new();
    // data 还在链上，PDA 也没退租
    Ok(())
}
```

或者：

```rust
#[account(mut, close = user)]
pub profile: Account<'info, Profile>,

pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
    // ❌ Anchor close 会退 lamports 到 user，但代码可能再读 profile
    let data = ctx.accounts.profile.try_borrow_data()?;
    // data 仍然是旧的，会读到 0x00...0 之后的实际 data
    Ok(())
}
```

### 6.2 正确写法

```rust
#[account(mut, close = user)]
pub profile: Account<'info, Profile>,

pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
    // 不要再读 profile，让 close 指令回收
    // 退 lamports 给 user
    Ok(())
}

// 想读 close 前的 data：在指令调用前的交易里读
```

### 6.3 EVM 类比

- EVM：`delete map[key]` 仅清空 storage 槽位，不退任何东西
- Solana：PDA 关闭 = 清 data + 退 lamports 到目标账户

EVM 习惯"删除就是设 0"；Solana 关闭 PDA 是"删账户 + 退钱"，必须确保没有"再读"。

### 6.4 实战检查点

- [ ] 关闭 PDA 后，**没有**业务逻辑继续读这个账户？
- [ ] `close = user` 接收者是预期地址（不是 attacker 提供的）？
- [ ] 大型账户关闭前要清空 data，避免"清不掉"导致 rent 不退？

## 7. 整数溢出

### 7.1 错误写法

```rust
let total = pool.amount_a + pool.amount_b;  // ❌ 在 release 模式下可能回绕
```

### 7.2 正确写法

```rust
let total = pool.amount_a
    .checked_add(pool.amount_b)
    .ok_or(ErrorCode::Overflow)?;
```

或者：

```rust
let total = pool.amount_a.saturating_add(pool.amount_b);  // 截断为 u64::MAX
```

Anchor 默认 profile.release 启用了 `overflow-checks = true`，但 `cargo test` 走 test profile，没启。

### 7.3 EVM 类比

- EVM 0.8.x：内置 overflow check，revert
- Solana：`u64` 原生无 check，需要 `checked_*`

EVM 习惯"放心加"，Solana 必须"显式检查"。

### 7.4 实战检查点

- [ ] 所有 `+` / `-` / `*` 都是 `checked_*` / `saturating_*`？
- [ ] 测试中至少有一个"接近 u64::MAX"的边界用例？
- [ ] Anchor.toml 的 `overflow-checks = true` 在 release profile？

## 8. 时间戳风险

### 8.1 错误写法

```rust
require!(Clock::get()?.unix_timestamp >= pool.end_time, NotEnded);
// ✅ 这一行逻辑没错
// ❌ 但 end_time 是用户传入的，没有合理性校验
```

```rust
pub fn create_market(ctx: Context<CreateMarket>, end_time: i64) -> Result<()> {
    // 没校验 end_time > now，可能创建就是已过期
    let market = &mut ctx.accounts.market;
    market.end_time = end_time;
    Ok(())
}
```

### 8.2 正确写法

```rust
pub fn create_market(ctx: Context<CreateMarket>, end_time: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(end_time > now, ErrorCode::InvalidTime);  // ✅ 必须未来
    require!(end_time < now + 365 * 24 * 3600, ErrorCode::InvalidTime);  // ✅ 不能太远
    // ...
}
```

### 8.3 EVM 类比

- EVM：`block.timestamp` 由 miner 提交，±15 秒误差，链上验证
- Solana：Clock 是由 validator 集群共识生成，**误差极小**（< 1 秒），但仍可被 validator 操纵

两者都不会让 attacker "穿越到未来"，但精度不同。

### 8.4 实战检查点

- [ ] 用户传入的 `end_time` 必须 `> now`？
- [ ] 没有"恰好等于 now" 的歧义（用 `>` 还是 `>=` 明确）？
- [ ] 不依赖单个 slot 的时间（用 2-3 个 slot 平均）？

## 9. CPI 风险

### 9.1 风险 1：目标 program 错

```rust
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),  // ❌ 没用真正的 token program
    Transfer { ... },
);
```

如果 attacker 传一个"看起来像 token program"的假 program，会被骗。

### 9.2 正确写法

```rust
pub token_program: Program<'info, Token>,  // ✅ Anchor 检查 program id == spl_token::ID
```

或者：

```rust
#[account(address = anchor_spl::token::ID)]
pub token_program: AccountInfo<'info>,
```

### 9.3 风险 2：Reinvoke 攻击

```rust
// attacker 的 program 调用你的 program
// 你的 program 用 PDA 签 CPI
// CPI 调用 attacker 的 program
// attacker 的 program 再 invoke 你的 program
// 此时你的 program 已经"消费"了 PDA 签名，但 attacker 还在递归
```

### 9.4 正确做法

- 在 `#[account]` 约束里要求"目标 program 必须是 program X"
- 不要让 CPI 目标 program 是用户传入的
- 用 `Program<'info, Token>` 这种类型化 wrapper

### 9.5 风险 3：Signer 滥用

```rust
let cpi_ctx = CpiContext::new(
    ctx.accounts.token_program.to_account_info(),
    Transfer {
        from: vault.to_account_info(),
        to: attacker_ata.to_account_info(),
        authority: vault.to_account_info(),  // 尝试用 PDA 签
    },
    signer_seeds,
);
```

如果 `attacker_ata` 实际是 attacker 的 ATA（不是用户的），attacker 就能用 CPI 偷 vault 的 token。

**正确做法**：

```rust
#[account(
    mut,
    constraint = user_sale_ata.mint == pool.sale_mint @ WrongMint,
    constraint = user_sale_ata.owner == user.key() @ WrongOwner,  // ✅ 必须 user 拥有
)]
pub user_sale_ata: Account<'info, TokenAccount>,
```

### 9.6 EVM 类比

- EVM：合约 A 调合约 B，B 调合约 A 容易 reentrancy（用 `nonReentrant` 防）
- Solana：reinvoke 类似，但用 program 验证 + 账户约束防

### 9.7 实战检查点

- [ ] 所有 program 账户都用 `Program<'info, X>` 不用 `AccountInfo`？
- [ ] 接收 token 的 ATA 都验证了 `owner == user`？
- [ ] 没有"用户传入任意 program id 然后 CPI 过去"？

## 10. 横向检查 Counter / PDA / CPI / Escrow 项目

### 10.1 Lesson 04 - Counter

| 检查点 | 状态 |
| ------ | ---- |
| `#[account(mut, has_one = authority)]` 限定 reset | ✅ |
| `authority: Signer` | ✅ |
| `checked_sub` 避免下溢 | ✅ |
| 没有 close 指令 | N/A |

### 10.2 Lesson 06 - PDA Profile

| 检查点 | 状态 |
| ------ | ---- |
| `seeds = [b"profile", user.key()]` 一致 | ✅ |
| `user: Signer` | ✅ |
| `close = user` 接收者是 user 自己 | ✅ |
| `name: String` 长度限制（lesson 教学范围内） | ⚠️ 生产需 4+max_len 限制 |

### 10.3 Lesson 07 - CPI Transfer SOL

| 检查点 | 状态 |
| ------ | ---- |
| `system_program::transfer` 的 from 是 PDA 持有 lamports | ✅ |
| PDA 签名用 `with_signer` + `ctx.bumps.vault` | ✅ |
| `has_one = authority` 限制 withdraw | ✅ |
| `withdraw` 超过余额校验 | ✅ |

### 10.4 Lesson 16 - Escrow

| 检查点 | 状态 |
| ------ | ---- |
| Vault token::authority = vault PDA | ✅ |
| exchange 时 maker 收 token_b、taker 收 token_a | ✅ |
| cancel 时只有 maker 可调用 | ✅ |
| mint 校验（vault.mint == escrow.mint_a） | ✅ |
| 二次 cancel 防御（escrow.vault.amount == 0 后） | ⚠️ lesson 未显式加 `is_active` 字段 |

## 11. 项目安全检查清单（每节课开始前自问）

| # | 问题                                                                                  | 答案 |
| - | ------------------------------------------------------------------------------------- | ---- |
| 1 | 所有用户/authority 操作都用 `Signer<'info>` 了吗？                                     |  |
| 2 | 所有 TokenAccount 都验了 mint == expected_mint？                                       |  |
| 3 | 所有 TokenAccount 都验了 owner == expected_owner？                                     |  |
| 4 | 所有 PDA 都用 `seeds = [...]` 一致，且 bump 不硬编码？                                 |  |
| 5 | 所有 program 账户都是 `Program<'info, X>` 类型？                                       |  |
| 6 | 所有 `+` / `-` / `*` 都是 `checked_*` / `saturating_*`？                              |  |
| 7 | 所有时间相关 require 都明确 `>` / `>=` / `<` / `<=`？                                 |  |
| 8 | 所有 close 指令都"读完 data 后"才 close，且不读 close 后的 data？                       |  |
| 9 | 所有 CPI 目标 program 都是固定的 `Program<'info, X>`？                                 |  |
| 10 | 所有 receive token 的账户都验了 owner？                                                |  |
| 11 | 业务账户里有 `bump` 字段存 PDA bump？                                                 |  |
| 12 | authority-only 操作有 `has_one = authority` 约束？                                      |  |
| 13 | 状态机字段有 invariant（不变量）？                                                      |  |
| 14 | 错误码清晰，每个 require 都给错误码？                                                   |  |
| 15 | 至少 1 个失败路径测试覆盖每条 require？                                                 |  |

## 12. 推荐工具

- **anchor test**：基础 unit + integration 测试
- **anchor-cli upgrade**：program 升级检查
- **solana-test-validator**：本地 validator，可定制 Clock / 账本
- **anchor book Security**：https://book.anchor-lang.com/anchor_in_depth/Anchor_Safety.html
- **Coral SDK security check**：CI 上 lint PDA seeds 一致性

## 13. 常见错误反模式（Anti-patterns）

| 反模式 | 后果 | 正确做法 |
| ------ | ---- | -------- |
| `user: AccountInfo` 替代 `Signer` | 任意 key 都能传 | 强制 `Signer` |
| `AccountInfo` 替代 `Account<'info, T>` | 不验 owner / discriminator | 用 `Account<'info, T>` |
| 硬编码 bump | 升级时可能错 | `bump,` + `ctx.bumps.xxx` |
| 信任传入的 token program id | 假 program 偷钱 | `Program<'info, Token>` |
| 算术用 `+` / `-` | overflow 风险 | `checked_*` |
| `clock.unix_timestamp` 来自 `i64::MIN` | panic | `require!` 范围 |
| close 后再读 | 读到 0x00 | close 后不再用 |

## 14. 课后检查清单

- [ ] 我能用一句话解释 8 大风险为什么都和"账户"有关。
- [ ] 我能写出 `checked_add` 的安全模板并解释为什么 release 模式不自动检查。
- [ ] 我能识别 Counter / Profile / CPI / Escrow 项目里至少 3 个安全设计点。
- [ ] 我能解释 EVM `msg.sender` 天然签名 vs Solana `Signer` 显式签名的差异。
- [ ] 我能用"项目安全检查清单"中的 15 条逐条审查自己写的程序。

## 15. 下一步

- Lesson 22：Anchor 测试体系（solana-test-validator + bankrun + ts-mocha）
- Lesson 23：错误码与事件（自定义错误码 + 事件日志读取）
