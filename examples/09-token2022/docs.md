# Lesson 09 - Token2022 文档

> 面向 EVM 开发者讲解 Solana Token2022（Token Extensions Program）。

## 1. Token2022 vs Token Program

```text
SPL Token Program:    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
Token2022 Program:    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
```

Token2022 = Token Program + 可选 Extensions。两者在 Solana runtime 是独立的两个 program，ATA（Associated Token Program）支持两者，区别仅在派生的 Token Account 的 owner 是哪个 program。

### EVM 类比

```text
ERC20                          →  SPL Token
ERC20 + Transfer Fee Hook      →  Token2022 + TransferFeeConfig extension
ERC20 + Permit / Delegation    →  Token2022 + PermanentDelegate extension
ERC20 + EIP-1046 / 1155+meta   →  Token2022 + TokenMetadata extension
```

## 2. 核心扩展

### 2.1 TransferFeeConfig

```rust
// 初始化指令
createInitializeTransferFeeConfigInstruction(
    mint,
    config_authority,    // 修改/关闭 fee 的权限
    withdraw_authority,  // 提取累积 fee 的权限
    fee_basis_points,    // 1% = 100 bps
    maximum_fee,         // 单笔 fee 上限
    TOKEN_2022_PROGRAM_ID,
)
```

行为：每次 `transfer` 自动从源头扣 fee，fee 暂存在 source token account 的 `withheld_amount` 字段，需要被 `harvestWithheldTokensToMint` 收集到 mint，再由 `withdrawAuthority` 提取到任意账户。

### 2.2 PermanentDelegate

```rust
createInitializePermanentDelegateInstruction(
    mint,
    permanent_delegate_pubkey,  // 可以从任何 holder 账户 burn/transfer
    TOKEN_2022_PROGRAM_ID,
)
```

行为：permanent delegate 可以：
- 调用 `transfer` 把任意账户的 token 转到任何地方
- 调用 `burn` 销毁任意账户的 token

这是**最强的权限**之一。EVM 开发者注意：等同于给某个地址"owner 级"的 ERC20 权限。

### 2.3 MetadataPointer

```rust
createInitializeMetadataPointerInstruction(
    mint,
    metadata_authority,   // 谁能修改 pointer
    metadata_address,     // 实际的 metadata 账户
    TOKEN_2022_PROGRAM_ID,
)
```

行为：把 metadata 关联到 mint。`metadata_address` 通常指向用 Metaplex Token Metadata 程序创建的账户，**注意：本课不实现 metadata 本身**，只演示 pointer 配置。

## 3. mint 账户的字节布局

```text
Base Mint: 82 bytes
+ TransferFeeConfig:  108 bytes
+ PermanentDelegate:    4 bytes (pubkey)
+ MetadataPointer:      4 bytes (pubkey) + 1 byte (authority flag) = ~5 bytes
─────────────────────────────────
Total: ~199 bytes
```

对比普通 Token mint = 82 bytes。Token2022 mint 因为扩展更大，要提前算 `getMintLen(extensions)` 并充值 lamports。

## 4. 与 EVM 关键差异

| 维度           | ERC20                            | SPL Token2022                  |
| -------------- | -------------------------------- | ------------------------------ |
| 部署单位       | 一个合约                         | 一个 mint account              |
| 业务逻辑       | 写在合约里                       | 写在 program 里，Token Program 不管 |
| 转账 fee       | 自己实现（takeFee / hooks）      | 扩展内置（TransferFeeConfig）   |
| 销毁           | owner 调 burn                    | owner / permanent delegate 都可 |
| 元数据         | EIP-1046 / 1155                  | TokenMetadata extension         |
| 升级           | proxy                            | 不需要（program 可换，mint 不变）|

## 5. 在 Anchor program 中使用 Token2022

```rust
use anchor_spl::token_2022::{Token2022, MintTo, Transfer};
use anchor_spl::token_interface::{Mint, TokenAccount};
```

注意：
- `Token` 替换为 `Token2022`
- `Mint` / `TokenAccount` 用 `token_interface::*` 里的版本，可以兼容 SPL Token 和 Token2022

## 6. 失败路径

### Fee 不累计到 mint

Token2022 的 fee 是 lazy 累积的：每次 transfer 后，fee 暂存在 source token account 的 `withheld_amount` 字段（被锁定、不可用），需要 `harvestWithheldTokensToMint` 才会真正归集到 mint。

### Permanent delegate 滥用

如果 mint authority 错配了一个 permanent delegate，对方可以随时抽走所有 holder 的 token。EVM 开发者注意：**没有 timelock、没有多签**——这是个一开就难以收回的权限。

### 扩展顺序不可改

mint 初始化时必须**一次性**指定所有扩展。后续不能添加或删除扩展，只能修改扩展的字段（如果有 authority）。

## 7. 实操要点

```typescript
// 1. 算 mint 空间
const mintLen = getMintLen([ExtensionType.TransferFeeConfig, ExtensionType.PermanentDelegate]);

// 2. 充值 rent
const rent = await connection.getMinimumBalanceForRentExemption(mintLen);

// 3. 顺序：create_account → 扩展 init → mint init
const tx = new Transaction()
  .add(SystemProgram.createAccount({ ..., space: mintLen, programId: TOKEN_2022_PROGRAM_ID }))
  .add(createInitializeTransferFeeConfigInstruction(...))
  .add(createInitializePermanentDelegateInstruction(...))
  .add(createInitializeMintInstruction(...));
```

## 8. 常见误区

### 误区 1：以为 Token2022 是 SPL Token 的升级

错。Token2022 是**独立的 program**，有自己的 program ID。Token Account 必须明确指定 owner 是哪个 program，ATA 派生也要传 program ID。

### 误区 2：transfer fee 立刻就能提取

错。fee 暂存在 source 账户，需要 `harvestWithheldTokensToMint` 归集到 mint，然后 `withdrawWithheldTokensFromAccounts` 才能提到目标账户。

### 误区 3：permanent delegate 等于 mint authority

错。mint authority 决定谁能 mint 新 token。permanent delegate 决定谁能 burn/transfer 任何已存在的 token。两者完全独立。

## 9. 课后检查清单

- [ ] 我能解释 Token Program 与 Token2022 的关系。
- [ ] 我能写出 mint with TransferFeeConfig 的初始化指令序列。
- [ ] 我能解释 permanent delegate 与 mint authority 的区别。
- [ ] 我能解释 transfer fee 的"lazy 累积"机制。
- [ ] 我能用 getMintLen 计算 mint 字节数。
- [ ] 我能在 program 中用 `token_interface::*` 兼容两种 token。

## 10. 下一步

- Lesson 10：Meme Coin
- Lesson 11：ERC721 vs Metaplex
- Lesson 12：Mint NFT
