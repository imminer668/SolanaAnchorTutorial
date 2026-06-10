# Lesson 03：EVM 与 Solana 概念对照表

> 目标读者：Solidity 开发者
>
> 本节用一张大表把 EVM 概念与 Solana 概念对应起来，**重点不在"对应"本身，而在每个对应项的迁移注意点**。每个 EVM 概念映射到 Solana 后，**心智模型都会发生微妙的偏移**，这是后续踩坑的根源。

---

## 一、核心对照表

| EVM           | Solana              | 关键差异                                                     |
| ------------- | ------------------- | ------------------------------------------------------------ |
| Contract      | Program             | Program 无状态，状态在 Account 里                            |
| Storage       | Account data        | 必须提前分配 space，必须声明 owner                           |
| mapping       | PDA                 | "键值对"变成"为每个 key 显式创建 Account"                    |
| msg.sender    | Signer              | 必须显式出现在 transaction 的账户列表里                      |
| ERC20         | SPL Token           | 逻辑在 Token Program，状态在 Mint/Token Account              |
| ERC721        | Metaplex NFT        | 链上只有 mint，metadata 普遍放链下（IPFS / Arweave）        |
| Contract Call | CPI                 | 显式传递账户，权限不能无限穿透                               |
| Event         | Event               | 链上日志可索引，但工具链和 EVM 不同                          |
| Proxy         | Upgradeable Program | 升级 = 替换字节码，没有 delegatecall 那种 storage 复用语义   |

下面我们逐项展开。

---

## 二、逐项解读与迁移注意点

### 1. Contract → Program

| 维度     | EVM Contract       | Solana Program         |
| -------- | ------------------ | ---------------------- |
| 是什么   | 部署到链上的代码+状态 | 一段可执行的 BPF 字节码 |
| 状态     | 隐式 storage        | 必须有外部 Account 持有  |
| 部署后   | 地址固定、状态从零开始 | 地址固定、状态不存在      |
| 升级     | Proxy 模式          | Upgradeable Program     |

**迁移注意点**：

- 部署 Program 不等于"实例化"。你部署完 Program，链上**没有任何业务数据**。
- 用户调用 `initialize` 类指令后，业务数据才开始出现在 Account 中。
- 一个 Program 可以"服务"无数个 Account（每个 Account 都是独立的数据文件）。

### 2. Storage → Account

| 维度       | EVM Storage        | Solana Account        |
| ---------- | ------------------ | --------------------- |
| 物理位置   | 合约地址下的 MPT 树 | 独立账户               |
| 大小       | 动态（按使用量）    | 固定（创建时确定）      |
| 持久化     | 默认永久            | 必须 rent-exempt 才永久 |
| 谁可以写   | 合约自己             | owner 指定的 Program    |

**迁移注意点**：

- 你不能"修改变量大小"——比如从 `u32` 改成 `u64` 时，要么迁移数据，要么开新 Account。
- Account 有明确的 owner 字段。owner 不是 Program 时，Program 写它会失败。
- 读 Account 前要确认 `discriminator` 匹配，否则 Anchor 会报 `AccountDiscriminatorMismatch`。

### 3. mapping → PDA

| 维度       | EVM mapping       | Solana PDA            |
| ---------- | ----------------- | --------------------- |
| 是什么     | 哈希表             | 由 seeds 推导出的地址  |
| 存在形式   | 合约 storage 内部  | 一个独立的 Account    |
| 性能       | O(1) 读写          | O(1) 通过 seeds 推导   |
| 删除       | 设零即可           | 调用 `close` 指令退 rent |

**迁移注意点**：

- "查询所有用户的余额" 在 EVM 可以遍历 `mapping` 配合 off-chain indexer。在 Solana 里，你必须用 `getProgramAccounts` RPC 或 off-chain indexer（因为链上没有"全部"的列表）。
- PDA 没有私钥。它的"签名"由对应 Program 用 `invoke_signed` 模拟。
- seeds 设计要稳定且可推导，前端能离线算出地址。

### 4. msg.sender → Signer

| 维度     | EVM msg.sender     | Solana Signer          |
| -------- | ------------------ | ---------------------- |
| 来源     | EVM 自动注入       | transaction 显式声明   |
| 是否必现 | 每个调用都有        | 取决于 instruction 是否需要 |
| 校验     | EVM 自动            | Anchor 自动校验签名     |

**迁移注意点**：

- 在 Solidity 里你可以"读 `msg.sender` 就当校验通过"。在 Solana 里，`Signer` 类型已经替你做了签名校验，**只要你把它写进 instruction struct**。
- 如果一个 instruction 不需要用户签名（比如纯查询），你可以用 `AccountInfo` 而非 `Signer`，但要明确知道这意味着**任何人都能调**。

### 5. ERC20 → SPL Token

| 维度     | ERC20              | SPL Token             |
| -------- | ------------------ | --------------------- |
| 代码     | 每个项目自己写     | 官方 SPL Token Program |
| 状态     | 合约内 mapping      | Mint + Token Account   |
| 部署     | 一个合约地址        | 一个 Mint + 多个 ATA   |
| 扩展     | 任意写              | Token2022 扩展 mint    |

**迁移注意点**：

- **不要自己实现 ERC20 等价物**。SPL Token Program 已经做了所有事：你只需要创建 Mint、创建 ATA、调用 `mint_to` / `transfer`。
- 余额不直接挂在某个合约上，而是挂在每个用户的 ATA（Associated Token Account）里。
- decimals 在创建 Mint 时固定（常见 6 或 9），不可改。

### 6. ERC721 → Metaplex NFT

| 维度     | ERC721              | Metaplex NFT          |
| -------- | ------------------- | --------------------- |
| 标识     | `contract + tokenId` | 一个 Mint 账户        |
| 元数据   | 通常在合约 storage   | 普遍在 IPFS / Arweave |
| 所有权   | mapping 在合约里     | 用户的 ATA 持有 1 个 mint |
| 集合     | 合约地址             | Creator + Collection Mint |

**迁移注意点**：

- Solana 没有 `tokenId`。每个 NFT 就是一个独立的 Mint Account。
- 一个 Collection 通常由 "Collection Mint" + 多个 "Member Mint" 组成。
- Metadata JSON 几乎都放在链下（IPFS / Arweave），链上只存指向 JSON 的 URI。
- 复制 / 烧毁 NFT = 在 ATA 里 mint 0 个 / 烧掉 1 个。

### 7. Contract Call → CPI

| 维度     | Contract Call        | CPI                    |
| -------- | -------------------- | ---------------------- |
| 写法     | `contractB.foo()`    | `invoke` / `invoke_signed` |
| 权限     | 直接传递             | 显式列出账户、signer seeds |
| 深度     | 任意                 | 受 CPI 深度限制         |
| 失败处理 | try/catch            | 整个 transaction 回滚    |

**迁移注意点**：

- CPI 失败会回滚整个 transaction，不存在"部分 CPI 成功"的概念。
- PDA 签名能力通过 `invoke_signed` 注入，但**只对当前调用有效**。在 CPI 中再 `invoke_signed` 时，权限不会自动传递。
- Anchor 提供了 `CpiContext` 简化常见调用（token 转账、system transfer 等）。

### 8. Event → Event

| 维度     | Solidity Event      | Anchor Event           |
| -------- | ------------------- | ---------------------- |
| 触发     | `emit X(...)`        | `emit!(X { ... })`     |
| 存储     | 交易 receipt 日志     | 交易日志，可被 indexer 抓取 |
| 索引     | 简单，开箱即用        | 需要 indexer（Helius、The Graph 等）|
| 字段     | indexed + data       | 普通字段，可序列化为 JSON |

**迁移注意点**：

- 链上日志是同一回事（都是交易日志），但**索引工具链完全不同**。
- EVM 开发者最熟悉的 The Graph 在 Solana 上不是默认方案，更常用 Helius DAS、自建 indexer、或者 Bonfida 等。
- Anchor event 用 `#[event]` 宏 + `emit!()`，调用方需要在 IDL 中能找到类型。

### 9. Proxy → Upgradeable Program

| 维度     | EVM Proxy            | Upgradeable Program     |
| -------- | -------------------- | ----------------------- |
| 升级对象 | 改 implementation 地址 | 替换 BPF 字节码          |
| Storage  | delegatecall 复用     | 同地址替换字节码，Account 仍在原位 |
| 撤销升级 | 把 implementation 设为 0x0 | 撤销 upgrade authority  |
| 风险     | 存储 layout 不兼容会导致 corruption | 同上，且 BPF 字节码整体替换 |

**迁移注意点**：

- 部署 Program 时默认有 upgrade authority。**生产环境必须撤销**。
- 升级权限放在 multisig 或硬件钱包里。
- 升级时没有"老 storage 兼容"问题——Account 还是同一个，但代码已经变了。
- 如果新代码改了数据结构，需要写迁移逻辑（或者重新初始化）。

---

## 三、三个"看起来相似但本质不同"的例子

### 例 1：mapping vs PDA

**EVM 视角**：

```solidity
mapping(address => uint256) public balances;
```

读 `balances[0xAlice]` 就是哈希表查找，O(1)。

**Solana 视角**：

```rust
// 表面上等价
let (pda, _) = Pubkey::find_program_address(&[b"balance", alice.key().as_ref()], &program_id);
```

但 `pda` 是一个**独立 Account**。没有"全表扫描"操作。要列所有 balance，必须用 `getProgramAccounts` RPC 让节点遍历链上所有属于该 Program 的 Account。

**本质不同**：mapping 是合约 storage 内部结构，PDA 是链上独立账户。

### 例 2：Contract Call vs CPI

**EVM 视角**：

```solidity
// 一行调用
IERC20(token).transfer(to, amount);
```

**Solana 视角**：

```rust
// 必须显式构造 CpiContext
let cpi_accounts = Transfer {
    from: ctx.accounts.from.to_account_info(),
    to: ctx.accounts.to.to_account_info(),
    authority: ctx.accounts.authority.to_account_info(),
};
let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
token::transfer(cpi_ctx, amount)?;
```

**本质不同**：EVM 合约调用是隐式的（EVM 自动 load 目标合约代码）；Solana CPI 是显式的（你必须自己列出账户、program、signers）。

### 例 3：ERC20 balanceOf vs SPL Token getAccount

**EVM 视角**：

```solidity
uint256 balance = IERC20(token).balanceOf(alice);
```

合约自己保存所有人的余额。

**Solana 视角**：

```ts
// 前端调用
const ata = await getAssociatedTokenAddress(mint, alice);
const account = await getAccount(connection, ata);
const balance = account.amount;
```

余额存在 Alice **自己的 ATA** 里。Token Program 只是个"会计"，每个用户的余额在各自账户上。

**本质不同**：ERC20 是"中心化账本"，SPL Token 是"分布式账本"——每个用户的余额都是独立的链上账户。

---

## 四、学习路线建议

对于 EVM 转型 Solana 的开发者，建议按以下顺序学习：

### 第 1 周：基础概念

1. **Account 模型**：Solana 怎么组织状态、rent 怎么算、owner 怎么校验
2. **Program 与 Instruction**：transaction 里到底装了什么
3. **Signer / System Program**：最基础的转账和账户创建

### 第 2 周：核心组件

4. **PDA**：用 `findProgramAddress` 推导，模拟签名的语义
5. **CPI**：调用 SPL Token、转 SOL、调用自己的 Program
6. **Anchor 框架**：`#[program]`、`#[account]`、`#[derive(Accounts)]` 的设计哲学

### 第 3 周：代币体系

7. **SPL Token**：Mint、Token Account、ATA
8. **Token2022**：Transfer Fee、Metadata Pointer、Permanent Delegate
9. **Metaplex NFT**：Metadata、Mint、Collection

### 第 4 周：项目实战

10. **Escrow、Voting、Airdrop**：PDA + CPI + SPL Token 综合运用
11. **Launchpad、Prediction Market**：更复杂的多账户状态机

### 后续：源码阅读

12. **Jupiter**：聚合器、Router、AMM Adapter
13. **Pump.fun**：Bonding Curve、流动性迁移
14. **Drift**：永续合约账户模型、清算引擎

---

## 五、课后自测题

1. **填空**：EVM 的 `mapping(address => T)` 在 Solana 里最接近的等价物是 ______。

2. **判断**：Solana 的 Program 部署后，链上立即有了该 Program 的业务状态。  （  ）

3. **简答**：用一句话解释为什么 `msg.sender` 在 Solana 中不存在。

4. **代码**：写一个 Anchor `#[derive(Accounts)]`，让用户能为自己的钱包地址创建一个 PDA Profile。

5. **辨析**：以下两段代码语义相同吗？为什么？

   ```solidity
   // EVM
   IERC20(token).transferFrom(from, to, amount);
   ```

   ```rust
   // Solana
   token::transfer(cpi_ctx, amount)?;
   ```

6. **思考**：为什么 Solana 的 Account size 必须在创建时确定，而 EVM 的 storage 大小是动态的？这个差异带来哪些 trade-off？

---

## 六、答案提示

1. PDA。还需要补充：每个"key"对应一个独立 Account。

2. 错。Program 部署后没有业务状态，业务状态在后续 `initialize` 类指令中由用户显式创建。

3. 因为 Solana 不会"自动把调用者塞进"交易，调用方必须作为 `Signer` 显式声明在 instruction 的账户列表中。

4. 提示：使用 `init`、`payer = user`、`seeds = [b"profile", user.key().as_ref()]`。

5. 不完全相同。Solidity `transferFrom` 内部自动从 `from` 的 allowance 扣减；Solana 的 `token::transfer` 只是把 token 从一个 ATA 转到另一个 ATA，allowance 校验由 SPL Token Program 内部完成。语义接近，但**调用方式**完全不同：Solana 必须显式构造 `CpiContext`，并把所有相关账户列出来。

6. 提示：固定 size 带来 rent 预算明确、并行执行可预测；动态 size 带来使用灵活、迁移成本低。两边各有 trade-off。

---

**最后更新：** 2026-06-10
