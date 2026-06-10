# Lesson 07 - CPI Transfer SOL 文档

> 面向 EVM 开发者的 CPI（跨程序调用）实战讲解

## 1. CPI 是什么？

CPI = Cross-Program Invocation。Solana 版的"合约调用"。

在 Solana 里，你的 Program 想用别处逻辑（比如转 SOL、转 Token）时，必须显式构造一次"调用"。这个调用就是 CPI。

**EVM 类比**：

```solidity
// Solidity
(bool success, ) = address(system).call{value: amount}("");
```

**Solana 视角**：

```rust
let cpi_accounts = Transfer {
    from: ctx.accounts.from.to_account_info(),
    to: ctx.accounts.vault.to_account_info(),
};
let cpi_ctx = CpiContext::new(
    ctx.accounts.system_program.to_account_info(),
    cpi_accounts,
);
transfer(cpi_ctx, amount)?;
```

## 2. CPI 与 EVM Contract Call 的差异

| 维度     | EVM Contract Call          | Solana CPI                  |
| -------- | -------------------------- | --------------------------- |
| 写法     | `target.call(...)`         | `CpiContext::new(...)` + 框架函数 |
| 权限     | 自动沿用                   | 显式列出账户、signer seeds  |
| 失败处理 | 局部 try/catch              | 整个 transaction 回滚        |
| 深度     | 无限制                      | 受 CPI 深度限制（实际 ≤ 4）    |
| 传递账户 | 由 EVM 自动追踪             | 必须显式 to_account_info()   |

**关键差异**：Solana CPI 是**完全显式**的——你必须自己列出账户、program、signer seeds。

## 3. 普通 CPI（用户签名转账）

```rust
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let cpi_accounts = Transfer {
        from: ctx.accounts.authority.to_account_info(),   // user 是签名者
        to: ctx.accounts.vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
    );
    transfer(cpi_ctx, amount)?;
    Ok(())
}
```

要点：

- `from` 是 authority（用户），有签名
- `to` 是 vault（要接收 SOL 的账户）
- 不用 signer seeds，因为是用户自己的签名

## 4. PDA 签名 CPI（用 `new_with_signer`）

Vault 是 PDA，没有私钥。但 Vault 想"自己"发起 transfer 时，需要 Program 帮它模拟签名。

```rust
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // 构造 signer seeds
    let authority_key = ctx.accounts.authority.key();
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        authority_key.as_ref(),
        &[ctx.accounts.vault.bump],   // bump 必须在最后
    ];
    let signer_seeds = &[vault_seeds];

    // 构造 CPI 上下文，传入 signer seeds
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    transfer(cpi_ctx, amount)?;
    Ok(())
}
```

**关键点**：

- `new_with_signer`（不是 `new`）
- signer_seeds 是 `&[&[&[u8]]]` 三层嵌套
- seeds 必须包含 bump
- seeds 必须与 Vault 创建时**完全一致**

## 5. CPI 限制

| 限制     | 说明                                          |
| -------- | --------------------------------------------- |
| 深度     | CPI 最大调用深度 4 层（含原始 transaction）   |
| 账户数量 | 一次 CPI 可传 35+ 个账户，受 transaction size 限制 |
| 失败处理 | 失败回滚整个 transaction                       |
| 权限     | PDA 签名只能传一层（再 invoke_signed 不会继承） |

## 6. PDA 模拟签名的本质

```text
Solana Runtime 看到 invoke_signed 的 seeds：
1. 用这些 seeds + 当前 program id 重新推导 PDA 地址
2. 比对推导出的地址是否等于被签账户
3. 如果相等，runtime 接受这个签名
```

这意味着：

- 任何 Program 都可以"尝试签名"任何 PDA
- 但只有用对的 seeds 推导出来的地址才是有效的 PDA
- **种子是 PDA 签名的唯一凭证**

## 7. CPI 失败的处理

CPI 失败会让整个 transaction 回滚：

```rust
// 假设 transfer 失败（余额不足）
transfer(cpi_ctx, amount)?;  // ← ? 触发回滚
// 后续代码不会执行
```

**EVM 类比**：

```solidity
(bool success, ) = target.call(data);
require(success, "CPI failed");
// 失败时整个 transaction revert
```

## 8. 与 EVM Contract Call 的心智对照

### EVM：调用者即签名者

```solidity
contract Vault {
    function withdraw() external {
        payable(msg.sender).transfer(address(this).balance);
    }
}
```

`msg.sender` 自动是签名者。

### Solana：必须显式 signer

```rust
pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
    // 必须把 authority 显式声明为 Signer
    // 必须用 vault_seeds 让 PDA 模拟签名
    let cpi_ctx = CpiContext::new_with_signer(...);
    transfer(cpi_ctx, amount)?;
    Ok(())
}
```

Solana 把签名这件事彻底显式化。

## 9. 常见误区

### 误区 1：忘记加 signer seeds

错。如果 PDA 收款人没传 seeds，runtime 找不到对应 PDA，转账失败。

### 误区 2：seeds 顺序写反

错。`[b"vault", authority, bump]` 和 `[b"vault", bump, authority]` 推出来的 PDA 不同。

### 误区 3：在 CPI 中嵌套 invoke_signed 期望权限传递

错。Solana 不会把 PDA 签名能力传下去。

## 10. 课后检查清单

- [ ] 我能解释 CPI 与 EVM Contract Call 的差异。
- [ ] 我能解释为什么 PDA 模拟签名需要 seeds。
- [ ] 我能写出正确的 signer_seeds 嵌套结构。
- [ ] 我能解释 CPI 失败时整个 transaction 回滚的语义。
- [ ] 我能区分 `CpiContext::new` 和 `CpiContext::new_with_signer`。

## 11. 下一步

- Lesson 08：SPL Token（CPI 调 SPL Token Program）
- Lesson 16：Escrow（PDA + Vault + CPI + SPL Token 综合）
