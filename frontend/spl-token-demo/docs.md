# Lesson 15 - 前端调用 SPL Token 文档

> 面向 EVM 开发者：对比 ERC20 与 SPL Token 在前端的调用差异。

## 1. ERC20 与 SPL Token 的前端模型差异

### ERC20 视角

```typescript
const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

const balance = await token.balanceOf(user);
await token.transfer(recipient, amount);
```

- 余额存在合约 storage 的 `mapping(address => uint256)`
- 一个 token = 一个合约
- 前端只关心：token 合约地址、用户地址、金额

### SPL Token 视角

```typescript
const ata = getAssociatedTokenAddressSync(mint, owner);
const account = await getAccount(connection, ata);
const balance = account.amount; // bigint

const tx = new Transaction().add(
  createTransferInstruction(fromAta, toAta, owner, amount),
);
```

- 余额存在**独立的 Token Account**（ATA）里
- 一个 token = 一个 Mint，每个 owner 都有自己的 ATA
- 前端必须知道：Mint、Owner、自己的 ATA、对方的 ATA

## 2. 三大账户的关系

```text
Mint Account        ← 定义 token（decimals, supply, mint authority）
    │
    ├── ATA(owner=Alice)   ← Alice 持有的 amount
    ├── ATA(owner=Bob)     ← Bob 持有的 amount
    └── ATA(owner=Charlie) ← Charlie 持有的 amount
```

| 账户          | 字段                          | 谁能改                            |
| ------------- | ----------------------------- | --------------------------------- |
| Mint          | supply, decimals, authority   | mint authority（如果有）             |
| Token Account | mint, owner, amount, delegate | owner / delegate                  |

## 3. 核心 API 速查

### 3.1 推导 ATA 地址

```typescript
const ata = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey);
```

ATA 本质是 PDA：

```text
seeds = [owner, TOKEN_PROGRAM_ID, mint]
program_id = ASSOCIATED_TOKEN_PROGRAM_ID
```

前端可以**完全离线**算出地址。

### 3.2 读余额

```typescript
const account = await getAccount(connection, ata);
console.log(account.amount);   // bigint，未除 decimals
console.log(account.mint);     // PublicKey
console.log(account.owner);    // PublicKey
```

ERC20 的 `balanceOf(user)` 一个调用搞定；SPL 需要先**推导 ATA**，再读 account。

### 3.3 创建 ATA

ATA 必须先创建（rent-exempt 占约 0.002 SOL）：

```typescript
const ix = createAssociatedTokenAccountInstruction(
  payer,    // 付 rent 的人
  ata,      // ATA 地址
  owner,    // ATA 的 owner
  mint,     // 关联的 mint
);
```

**EVM 没有这一步**——任何地址都默认能持任意 ERC20。这是 Solana 最反直觉的差异之一。

### 3.4 Transfer

```typescript
const ix = createTransferInstruction(
  fromAta,     // 来源 ATA
  toAta,       // 目标 ATA
  fromOwner,   // 来源 owner（必须是签名者）
  amount,      // bigint，单位是 raw（要乘 10^decimals）
);
```

**注意**：transfer 不传 mint，因为 fromAta 自带 mint 字段。

### 3.5 UI 数量 ↔ Raw 数量

```typescript
// UI: 1.5 USDC, decimals=6
const raw = BigInt(1.5 * 10 ** 6);  // 1500000n

// Raw 转 UI
const ui = Number(account.amount) / 10 ** decimals;
```

## 4. 转账给"没有 ATA"的人

EVM transfer 给一个从没用过 token 的地址 —— 直接到账。Solana 必须**先帮对方建 ATA**：

```typescript
const tx = new Transaction();
try {
  await getAccount(connection, toAta);
} catch {
  tx.add(createAssociatedTokenAccountInstruction(payer, toAta, toOwner, mint));
}
tx.add(createTransferInstruction(fromAta, toAta, fromOwner, amount));
```

这就是为什么 Solana 钱包"第一次收某个 token 会扣点 SOL"——给 ATA 付 rent。

## 5. balanceOf 在 Solana 的反模式

EVM 习惯：

```typescript
// 查某地址的所有 ERC20 持仓 → 不可能（没有 indexer 帮不了）
```

Solana 习惯：

```typescript
// 查某地址持有的所有 token
const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
  programId: TOKEN_PROGRAM_ID,
});
```

**反过来**——Solana 的 `getParsedTokenAccountsByOwner` 是免费 RPC，扫遍这个 owner 的所有 token account。EVM 实现同样功能需要付费 indexer（Alchemy / Moralis / The Graph）。

## 6. ERC20 vs SPL Token 对照表

| 操作               | ERC20                                    | SPL Token                                       |
| ------------------ | ---------------------------------------- | ----------------------------------------------- |
| 查余额             | `token.balanceOf(user)`                   | `getAccount(connection, ata)`                    |
| 推导地址           | 不需要                                    | `getAssociatedTokenAddressSync(mint, owner)`     |
| 准备接收           | 不需要                                    | `createAssociatedTokenAccountInstruction(...)`   |
| Transfer           | `token.transfer(to, amount)`              | `createTransferInstruction(from, to, owner, raw)` |
| Approve            | `token.approve(spender, amount)`          | `createApproveInstruction(account, delegate, owner, raw)` |
| 销毁               | `token.burn(amount)` (如果有)             | `createBurnInstruction(account, mint, owner, raw)` |
| Mint               | `token.mint(to, amount)`（如果有）        | `createMintToInstruction(mint, dest, authority, raw)` |
| Token 元信息       | `token.symbol()`, `token.name()`          | 通过 Metaplex Metadata Account                   |
| 钱包列出持仓       | 需要 indexer / event log                  | `getParsedTokenAccountsByOwner` (RPC)            |

## 7. 容易踩的坑

### 7.1 用 raw amount 但当成 UI 数量

```typescript
// ❌ 错：transfer 1.5 USDC，但实际转了 0.0000015 USDC
createTransferInstruction(fromAta, toAta, owner, 1n);

// ✅ 正确（decimals = 6）
createTransferInstruction(fromAta, toAta, owner, 1_500_000n);
```

### 7.2 浮点 → BigInt 精度丢失

```typescript
// ❌ 错：1.1 * 1_000_000 = 1099999.9999...
const raw = BigInt(1.1 * 10 ** 6);

// ✅ 用字符串解析或 Math.round
const raw = BigInt(Math.round(1.1 * 10 ** 6));
```

### 7.3 不存在的 ATA 直接 transfer

```typescript
// ❌ 失败：to ATA 不存在，TokenAccountNotFoundError
createTransferInstruction(fromAta, toAta, owner, raw);

// ✅ 先创建
tx.add(createAssociatedTokenAccountInstruction(...));
tx.add(createTransferInstruction(...));
```

### 7.4 owner 必须是签名者

```typescript
// from owner 是当前钱包 → 自动签
sendTransaction(tx, connection);

// from owner 是别人 → 需要 delegate 机制（approve + transfer with delegate）
```

## 8. 与 EVM 思维的关键迁移

| EVM 思维                       | Solana 真相                                       |
| ----------------------------- | ------------------------------------------------- |
| "balanceOf 就是函数调用"        | 先推 ATA，再读账户                                    |
| "token 在合约 storage"          | token 在每个 owner 自己的 ATA                        |
| "transfer 不用关心存储"          | transfer 必须知道 from/to 两个 ATA                   |
| "approve 给 spender"            | delegate 是 token account 的字段，全局一个        |
| "想列出所有持仓 → 需要 indexer" | RPC 原生支持 getParsedTokenAccountsByOwner          |
| "transfer 给新地址直接成功"     | 先付 rent 给对方建 ATA                              |

## 9. 课后检查清单

- [ ] 我能解释 Mint、Token Account、ATA 的关系。
- [ ] 我能用 `getAssociatedTokenAddressSync` 推导 ATA。
- [ ] 我能写"读余额"代码，处理 ATA 不存在的情况。
- [ ] 我能写一个"transfer 给可能没有 ATA 的人"的完整交易。
- [ ] 我能解释为什么 Solana 持 token 要先付 rent。
- [ ] 我能区分 UI amount 和 raw amount，避免精度错误。

## 10. 下一步

阶段 2 完成。下一步进入阶段 3：

- Lesson 17：Voting 投票系统
- Lesson 18：Airdrop 空投系统
- Lesson 19：Launchpad
- Lesson 20：Prediction Market
