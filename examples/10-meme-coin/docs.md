# Lesson 10 - Meme Coin 文档

> 面向 EVM 开发者的 Solana Meme Coin 发行实战。

## 1. Meme Coin 在 EVM 和 Solana 的本质差异

### Solidity 视角

```solidity
contract MemeCoin is ERC20 {
    address public team;
    address public community;
    uint256 public immutable maxSupply;

    constructor(uint256 _teamAmount, uint256 _communityAmount) ERC20("Pepe", "PEPE") {
        maxSupply = _teamAmount + _communityAmount;
        _mint(team, _teamAmount);
        _mint(community, _communityAmount);
    }
}
```

- 一个合约搞定：代币 + 业务逻辑 + 状态
- 总量在 constructor 锁定（取决于是否带 mint 函数）

### Solana 视角

```text
Meme Coin = Mint Account + Token Program + (可选) 业务 Program

代币本身：SPL Token 标准，所有逻辑由 Token Program 处理
业务逻辑：自己写的 Anchor Program
锁定供应：放弃 mint authority
```

| 维度         | EVM ERC20                  | Solana SPL Token          |
| ------------ | -------------------------- | ------------------------- |
| 代币合约     | 自己写                     | SPL Token Program（共用）  |
| 总供应       | constructor 一次性 mint     | init 一次性 mint          |
| 业务逻辑     | 写在合约里                 | 自己写 program，按需 CPI   |
| 增发         | mint 函数（owner 控制）     | mint authority 控制       |
| 锁仓         | 销毁 owner key / 写死      | set_authority(mint, None)  |
| 跨合约       | 内置                       | CPI                       |

## 2. Meme Coin 的字节布局

### Mint Account

```text
82 bytes 基础：
  32  - mintAuthority (or COption<Pubkey>)
  8   - supply
  8   - decimals
  1   - isInitialized
  33  - freezeAuthority (COption<Pubkey>)
```

### Config PDA

```text
8 + 32 + 32 + 8 + 8 + 8 + 1 + 1 = 98 bytes
  8   - discriminator
  32  - authority
  32  - mint
  8   - total_supply
  8   - team_amount
  8   - community_amount
  1   - locked
  1   - bump
```

## 3. Mint Authority 选型

| 选项 | 含义 | 适用 |
| ---- | ---- | ---- |
| User keypair | 任何持私钥的人可 mint | 测试、教学 |
| **Config PDA** | 只有 program 可 mint（推荐）| 教学 Meme Coin |
| None | 不可 mint（固定 supply）| 锁仓后 |

我们的设计：mint authority = config PDA

- 初始化时 PDA 一次性 mint 全部
- lock_mint 时 PDA 调用 set_authority(mint, None)
- 没有任何 user keypair 持 mint authority = 真正去中心化

## 4. 一次性 mint 的理由

```rust
// 反例：分多次 mint
mint_to(team_ata, team_amount)?;     // 两次 CPI 调用
mint_to(community_ata, community_amount)?;
```

每次 mint 都是一次 CPI + compute unit 消耗。一次性 mint 节省 compute 和 transaction size。

## 5. 失败路径

### 5.1 团队+社区 != 总供应

```rust
require!(
    team_amount.checked_add(community_amount) == Some(total_supply),
    ErrorCode::AmountMismatch
);
```

防止开发者把一部分 token 留给自己（典型 rug pull 模式）。

### 5.2 增发攻击

如果 mint authority 是 user keypair 而不是 PDA，持有私钥的人可以在初始化后再增发。本课设计是 PDA，**连"非授权增发"都没有入口**。

### 5.3 Lock 后仍想增发

`lock_mint` 后 mint authority 为 None，SPL Token Program 直接拒绝任何 mint 指令。

## 6. 实战对比表

| 场景             | EVM 模式                                 | Solana 模式                          |
| ---------------- | ---------------------------------------- | ------------------------------------ |
| 部署             | 部署 ERC20 合约                          | init mint account + 一次性 mint      |
| 初始分发         | constructor 多次 _mint                   | 一次性 mint_to(team) + mint_to(community) |
| 锁仓             | 销毁 admin key / renounceOwnership        | set_authority(mint, None)            |
| 验证 supply      | 读 totalSupply()                          | 读 mint.supply                        |
| 验证已锁         | 验证 owner() == address(0)               | 验证 mint.mint_authority == null      |

## 7. 风险提示

> ⚠️ 本课是**教学示例**，不是真实代币发行建议。
>
> 真实 Meme Coin 发行需要：
> - 第三方审计
> - 流动性池子设计（Raydium / Orca）
> - 社区治理机制
> - 法律合规
> - 团队多签
>
> 仅靠 `mint authority = None` 不能保证代币价值。

## 8. 常见误区

### 误区 1：以为 mint authority = None 就安全

错。Token 持有者可以**自己 transfer 走**所有 token。锁仓只保证不增发，不保证不抛售。

### 误区 2：团队 token 应该在 lock_mint 之后才能 transfer

错。SPL Token 本身没有"锁仓"概念。如果要锁仓团队 token，需要：
- 写一个 vesting program
- 或把 team ATA 的 owner 改成 vesting PDA

### 误区 3：decimals 选 9 是"最安全"

错。decimals 只影响 UI 显示和最小转账单位。9 是 SOL 的标准，但对纯社区代币可能 6 更合适。

## 9. 课后检查清单

- [ ] 我能解释 ERC20 与 SPL Token 的核心差异。
- [ ] 我能写出"config PDA 作为 mint authority"的初始化代码。
- [ ] 我能用 set_authority 锁仓 mint。
- [ ] 我能解释为什么 supply 一次性 mint 更优。
- [ ] 我能解释 lock_mint 后的安全保障边界。
- [ ] 我能识别典型的 Meme Coin rug pull 模式。

## 10. 下一步

- Lesson 11：ERC721 与 Metaplex
- Lesson 12：Mint NFT
- Lesson 17：Voting 投票系统
