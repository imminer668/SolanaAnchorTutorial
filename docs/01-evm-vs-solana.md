# Lesson 01：为什么 Solana 和 EVM 完全不同

> 目标读者：Solidity 开发者
>
> 读完这节课，你能用一句话向同事说清楚 Solana 和 EVM 的核心差异，并且不再把 Program 当成合约、把 Account 当成 storage。

## 一、一句话总结

**EVM 把代码和状态捆绑在一起；Solana 把代码和状态彻底拆开。**

这就是你学 Solana 之前必须先吃透的最核心差异。后面所有的 PDA、Account、Space、显式传参，本质上都是这一句话的展开。

## 二、EVM 心智模型

在 EVM 世界里，你部署的是一个 **合约（Contract）**。合约有两部分：

- **Code（字节码）**：写好的逻辑，部署后不可变（除非用 Proxy）。
- **Storage（状态）**：每个合约地址下都有一棵 MPT 树，保存所有状态变量。

合约 = Code + Storage，二者绑定在一个地址上，地址就是合约的"身份证"。

```text
0x1234...abcd
├── code:   0x6080...（字节码）
└── storage: { count: 0, owner: 0xabcd... }
```

调用合约时：

1. 你发送一个 transaction 到 `0x1234...abcd`。
2. EVM 在该地址下找到 code 并执行。
3. code 读写该地址下的 storage。
4. 状态变更被记录。

**EVM 开发者已经习惯的心智**：

- "调用合约" = "向地址发交易"。
- "状态" = "合约地址下的 storage"。
- "我的合约" = "我部署在 0x1234 的东西"。

## 三、Solana 心智模型

Solana 把这套东西拆成了两个独立的概念：

- **Program（程序）**：纯代码，等价于 EVM 合约的 code 部分。Program 部署后**不保存任何状态**。
- **Account（账户）**：纯数据，等价于 EVM 合约的 storage 部分。Account 可以保存任意数据，由 owner 字段指定谁能改它。

```text
Program  (11111111111111111111111111111111)
└── code:   BPF 字节码（无状态）

Account  (任意 32 字节地址)
├── data:   { count: 0, authority: Pubkey }
├── owner:  上面的 Program ID
└── lamports: 1000000
```

调用 Program 时：

1. 你发送一个 transaction，里面**显式列出**所有要读写的 Account。
2. Solana Runtime 校验这些 Account 的 owner 是否正确、签名是否有效。
3. Program 执行，**只能**读写 transaction 里声明的 Account。
4. 状态变更被记录。

**Solana 开发者应有的心智**：

- "调用 Program" = "向 Program 发交易，并指明要操作哪些 Account"。
- "状态" = "分散在多个 Account 中的数据，每个 Account 由某个 Program 拥有"。
- "我的合约" = "我的 Program + 我创建的若干 Account"。

## 四、最小对照：Counter

### Solidity 版本

```solidity
// SPDX-License-Identifier: MIT
contract Counter {
    uint256 public count;

    function increment() external {
        count += 1;
    }
}
```

部署这个合约会发生什么：

1. EVM 在某个新地址创建账户。
2. 把 code 部署到这个地址。
3. storage 初始化为 `count = 0`。
4. 之后所有调用都通过 `counter.increment()` 修改这个地址下的 storage。

`count` 这个状态**永久绑定在合约地址上**。

### Anchor 版本

```rust
use anchor_lang::prelude::*;

declare_id!("Counter111111111111111111111111111111111111");

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.user.key();
        counter.count = 0;
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 32 + 8)]
    pub counter: Account<'info, CounterData>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, has_one = authority)]
    pub counter: Account<'info, CounterData>,
    pub authority: Signer<'info>,
}

#[account]
pub struct CounterData {
    pub authority: Pubkey,  // 32 bytes
    pub count: u64,         // 8 bytes
}
```

部署这个 Program 会发生什么：

1. Solana 在某个地址部署 BPF 字节码。
2. **Program 自己没有任何状态。**
3. 用户调用 `initialize` 时：
   - 显式传入 `counter`（要创建的 Account）、`user`（付费者）、`system_program`。
   - Anchor 在链上创建一个新 Account，把 `authority` 和 `count` 写进去。
4. 用户调用 `increment` 时：
   - 显式传入 `counter`（要修改的 Account）和 `authority`（签名者）。
   - Program 修改该 Account 的 data。

**关键差异**：

- `count` 不在 Program 里，在 `counter` 这个 Account 里。
- Account 是客户端"带"过来的，Program 不保管它。
- 如果不把 `counter` 传进去，`increment` 根本不知道改哪个数据。

## 五、为什么 Solana 交易必须显式传入账户

EVM 的 transaction 只指定 `to` 地址。EVM 执行时，合约代码可以**任意**读写自己 storage 里的任何 slot，也可以通过 `CALL` 静态分析出需要调用哪些地址（虽然 EVM 没有强制显式声明，但实践中还是隐式由 EVM 加载）。

Solana 走的是另一条路：**必须显式声明**。

一个 Solana transaction 大致长这样：

```text
Transaction
├── Signer: 0xAlice
├── Program: CounterProgram
└── Account Meta[]:
    ├── counter (writable)        ← 这就是要改的 Account
    ├── authority (signer)        ← 签名者
    └── system_program (readonly)  ← 系统程序
```

为什么 Solana 要这么做？

1. **并行执行**：Solana Runtime 在执行前就知道要读写哪些 Account，可以并行调度不冲突的交易。
2. **明确权限**：每个 Account 的可写性、是否签名、是否只读，都在 transaction 里写明，运行时强制校验。
3. **客户端可控**：钱包、dApp、indexer 都能在签名前看到要操作什么账户，更安全。

对 EVM 开发者来说，这意味着：

- "调一个函数" 不再是只传 calldata，而是要把涉及的账户全列出来。
- 这也是为什么 Solana 交易的 size 经常偏大、为什么 Solana 工具链都要做 Account 压缩。
- 这也是为什么你必须学习 PDA、Space、Owner、Signer——它们都是这个显式模型的产物。

## 六、为什么 Program 不等于智能合约实例

EVM 中，每个合约部署都是一个**独立的实例**：

```text
USDT (0xdac1...):     code + storage
USDC (0xa0b8...):     code + storage
DAI  (0x6b17...):     code + storage
```

即使两个合约源码完全一样，它们在链上是两个独立的地址、两份独立的状态。

Solana 完全不同：

- **一个 Program 就是一份代码**，可以被任意多个 Account 引用。
- Program 自己不存任何业务状态。
- 业务状态在 Account 里，Account 显式由这个 Program 拥有（owner = program id）。

```text
CounterProgram (11111...)
   ├── Account A (authority=Alice, count=3)   owner = Program
   ├── Account B (authority=Bob,   count=7)   owner = Program
   └── Account C (authority=Carol, count=0)   owner = Program
```

EVM 类比：你可以把它想象成"一个合约代码，多个用户各自部署了 Counter"，但又完全不同——在 Solana 里，Account 不是"部署"，是 Program 的"数据文件"。

更准确的理解是：

- Program = 一份函数库（library）
- Account = 调用这个 library 时被读写的文件

## 七、EVM 开发者最容易误解的三个地方

### 误解 1："我部署了合约，就有了状态"

错。在 Solana 里，部署 Program 之后链上**没有任何业务状态**。状态必须由用户后续调用 `initialize` 之类的指令创建 Account 后才存在。

### 误解 2："调用合约就是给合约地址发交易"

错。调用 Program 是给 **Program 地址**发交易，但 Program 的逻辑只能读写你**显式传入**的 Account。如果你忘了把某个 Account 写进 transaction 列表，你的 instruction 会直接失败。

### 误解 3："每个用户都有自己的合约实例"

错。一个 Program 一份代码。所有用户共享同一份代码，各自的数据存在不同的 Account 里。如果你想要"每个用户独立的状态"，你需要为每个用户创建独立的 Account，并使用 PDA 保证账户地址确定性可推导。

## 八、EVM 与 Solana 对照表

| 概念             | EVM                                | Solana                                  |
| ---------------- | ---------------------------------- | --------------------------------------- |
| 代码             | 合约字节码                         | Program (BPF)                           |
| 状态             | 合约 storage                       | Account data                            |
| 代码与状态关系   | 同地址绑定                         | 分离，靠 owner 字段关联                 |
| 调用入口         | `to` 字段                          | `program_id` + 显式 Account 列表        |
| 状态可写性       | EVM 自动追踪                       | transaction 中显式标记 `writable`       |
| 身份证明         | `msg.sender`（隐式）               | `Signer`（必须在 transaction 中）       |
| 部署产物         | 一个新地址的合约                   | 一份无状态的 Program                    |
| 升级             | Proxy 模式（delegatecall）         | Upgradeable Program（BPF loader 升级权限） |
| 并行执行         | 单线程状态机                       | Account 显式声明，可并行调度            |

## 九、课后检查清单

完成本节后，你应该能够回答以下问题：

- [ ] 我能用一句话说出 Solana 与 EVM 的核心差异。
- [ ] 我能解释 Program 与 Account 的关系。
- [ ] 我能解释为什么 Solana transaction 必须显式列出 Account。
- [ ] 我能解释为什么 Program 自己没有状态。
- [ ] 我能看懂 Solidity Counter 与 Anchor Counter 的对应关系。
- [ ] 我能列出至少 3 个 EVM 开发者最容易踩的误解。
- [ ] 我能说出至少 3 个 EVM 概念在 Solana 中的对应物。

## 十、下一节预告

下一节（Lesson 02）我们会展开 10 个具体坑：msg.sender 不存在、mapping 不存在、storage 不存在、PDA 不是钱包地址、Account Space 必须提前计算、rent 机制、upgradeable program 等。这些坑都是从 EVM 迁移到 Solana 必然会遇到的"卡点"。

---

**最后更新：** 2026-06-10
