# Lesson 12 - NFT Mint Account 基础文档

> 面向 EVM 开发者的 Solana NFT 基础账户模型实战。  
> 当前实现聚焦 Mint(supply=1, decimals=0) + Token Account，不创建 Metaplex Metadata Account / Master Edition。

## 1. NFT 在 EVM 和 Solana 的本质差异

### Solidity 视角

```solidity
contract MyNFT is ERC721 {
    string private _baseTokenURI;
    uint256 public nextTokenId;

    constructor(string memory base) ERC721("MyNFT", "MNFT") {
        _baseTokenURI = base;
    }

    function mint(address to) external {
        _safeMint(to, nextTokenId);
        nextTokenId++;
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        return string(abi.encodePacked(_baseTokenURI, id.toString()));
    }
}
```

- 一个合约 = 一个集合（collection）
- tokenId 是合约内自增
- ownership 存在合约 storage 里
- metadata 通过 tokenURI 函数返回

### Solana 视角

```text
完整 NFT = Mint Account(supply=1, decimals=0) + Metadata Account + Master Edition + Token Account

每一个 NFT 是一个独立的 Mint
集合（Collection）是另一个 Mint，作为父
metadata 是单独的 PDA，由 Token Metadata Program 管理
ownership 在 Token Account（ATA）里
```

| 维度       | EVM ERC721                | Solana NFT (Metaplex)                |
| ---------- | ------------------------- | ------------------------------------ |
| 集合       | 一个合约 = 一个集合         | 一个 Mint 作为 Collection，多个 NFT 关联 |
| Token ID   | uint256 自增              | 每个 NFT 是独立的 Pubkey              |
| metadata   | tokenURI() 函数返回 URI    | Metadata Account（PDA）保存          |
| 所有权     | mapping(id => owner)      | Token Account 持有 amount = 1         |
| 唯一性     | tokenId 唯一              | mint.supply = 1, decimals = 0         |
| 修改 metadata | 合约函数（如果可写）       | update_metadata 指令（受 update authority 控制） |

## 2. NFT 三大账户解析

### 2.1 Mint Account

```text
82 bytes 基础：
  mintAuthority: Pubkey      // mint 权限（铸造完成后应设为 null）
  supply: u64                // NFT = 1
  decimals: u8               // NFT = 0
  isInitialized: bool
  freezeAuthority: COption<Pubkey>
```

**NFT 的 Mint 必须满足**：

- decimals = 0（不可分割）
- supply = 1（唯一）
- mintAuthority = null（不再增发，但本课为了演示保留）

### 2.2 Metadata Account（Metaplex PDA）

```text
PDA seeds = ["metadata", token_metadata_program_id, mint_pubkey]

包含：
  name: String
  symbol: String
  uri: String                // 链下 JSON 地址
  sellerFeeBasisPoints: u16  // 版税（万分比）
  creators: Vec<Creator>      // 创作者分成
  collection: Option<Pubkey>  // 所属集合
  updateAuthority: Pubkey     // 更新权限
```

### 2.3 Master Edition

```text
PDA seeds = ["metadata", token_metadata_program_id, mint, "edition"]

含义：声明这是 NFT 主版本，supply 永久锁定为 1
```

## 3. 关键 PDA 推导

```typescript
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const [metadata] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    TOKEN_METADATA_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
  ],
  TOKEN_METADATA_PROGRAM_ID,
);

const [masterEdition] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("metadata"),
    TOKEN_METADATA_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
    Buffer.from("edition"),
  ],
  TOKEN_METADATA_PROGRAM_ID,
);
```

**EVM 对照**：相当于通过合约地址 + tokenId 推导出 metadata 存储位置，但 Solana 完全在客户端推导，不需要 RPC 调用。

## 4. 完整 NFT 铸造流程与本课实现范围

完整 Metaplex NFT 铸造流程：

```text
1. 生成 mint keypair
2. 创建 mint account（SystemProgram.createAccount）
3. 初始化 mint（createInitializeMintInstruction，decimals=0）
4. 创建 ATA（如果不存在）
5. mint 1 个 token 到 ATA
6. 调用 Token Metadata Program 创建 Metadata Account
7. 调用 Token Metadata Program 创建 Master Edition
8. （可选）setAuthority(mint, null) 让 supply 永久锁定
```

EVM 一句 `_safeMint(to, id)` 完成；Solana 需要 5-7 条指令组合。

本课当前实现步骤：

```text
1. 生成 mint keypair
2. 创建 mint account
3. 初始化 mint（decimals=0）
4. 创建 owner ATA
5. mint 1 个 token 到 owner ATA
6. 推导 Metadata PDA 与 Master Edition PDA
7. 调用业务 program 的 stamp_owner
```

本课没有创建 Metadata Account / Master Edition。原因是本地 `anchor test` 默认不会自动部署 Metaplex Token Metadata Program；要在本地完整创建这些账户，需要额外加载该 program 的 BPF 或改用 devnet。

## 5. 本课程序的角色

本课的 Anchor program 不创建 metadata。它提供一个 `stamp_owner` 指令，用来演示业务逻辑如何**在链上记录"某个 NFT 已被某地址声明"** 的事件。

```rust
pub fn stamp_owner(ctx: Context<StampOwner>) -> Result<()> {
    msg!(
        "NFT {} stamped to {}",
        ctx.accounts.nft_mint.key(),
        ctx.accounts.owner.key()
    );
    Ok(())
}
```

真实场景可扩展为：

- 任务系统：用户 stamp NFT 后获得奖励
- Loyalty 系统：stamp 次数累计积分
- 游戏装备：stamp 后激活属性

## 6. 失败路径

### 6.1 decimals 不是 0

```rust
require!(mint.decimals == 0, ErrorCode::InvalidNftDecimals);
```

NFT 必须 decimals=0，否则可以"持有 0.5 个 NFT"。

### 6.2 supply 不是 1

```rust
require!(mint.supply == 1, ErrorCode::InvalidNftSupply);
```

NFT 必须 supply=1，否则失去唯一性。

### 6.3 没有 Metadata 账户

只有 Mint 没有 Metadata 的 token，不被钱包识别为 NFT。Phantom / Solflare 会显示为普通 SPL Token。

这正是本课当前实现的边界：它能解释 NFT 的 Mint/ATA 所有权模型，但不是可被钱包完整识别的 Metaplex NFT。

### 6.4 Metadata uri 指向 404

链下 JSON 加载失败，钱包显示图片和属性为空。

## 7. 链下 Metadata JSON 格式

```json
{
  "name": "My First NFT #1",
  "symbol": "MNFT",
  "description": "Lesson 12 demo NFT",
  "image": "https://arweave.net/xxx.png",
  "attributes": [
    { "trait_type": "Color", "value": "Blue" },
    { "trait_type": "Rarity", "value": "Common" }
  ],
  "properties": {
    "files": [
      { "uri": "https://arweave.net/xxx.png", "type": "image/png" }
    ],
    "category": "image"
  }
}
```

**EVM 对照**：和 ERC721 的 tokenURI JSON 几乎一样，OpenSea 标准基本通用。

## 8. 推荐存储

| 选择       | 优点                      | 缺点                       |
| ---------- | ------------------------- | -------------------------- |
| Arweave    | 永久存储、抗审查          | 一次付费贵                 |
| IPFS       | 去中心化                  | 需要 pinning 服务保活      |
| Shadow Drive | Solana 原生              | 生态较小                   |
| HTTP（公司服务器）| 成本低、可控           | 中心化、可被关闭            |

NFT 项目主流：Arweave + nft.storage（pin 到 IPFS）。

## 9. 版税（Royalty）

Metadata 里的 `sellerFeeBasisPoints` 表示版税（万分比）：

```text
500 = 5%
sellerFeeBasisPoints / 10000 = 实际比例
```

`creators` 字段定义如何分配版税：

```rust
Creator {
    address: Pubkey,
    verified: bool,
    share: u8,   // 总和必须 = 100
}
```

> ⚠️ **2023 年后**：很多 Solana 市场（Magic Eden、Tensor）已经把版税改为"可选"或"由买家决定"。链上版税不是强制的。

## 10. 集合（Collection）

```text
Collection = 一个特殊的 NFT Mint，作为"父"
集合下的 NFT.metadata.collection = collection_mint_pubkey
然后 verify_collection 把 NFT 标记为已验证
```

未验证的 collection 字段可以被任何人填写（钓鱼风险），必须经过 `verify_collection` 才能信任。

## 11. 与 EVM 思维差异最大的几点

| 思维迁移点                | EVM 习惯           | Solana 真相                          |
| ------------------------ | ------------------ | ------------------------------------ |
| "NFT 是一个 tokenId"      | uint256            | 每个 NFT 是独立的 Pubkey              |
| "ownership 在合约里"      | mapping            | ownership 在 Token Account（ATA）    |
| "balanceOf"              | 直接调函数         | 没有 balanceOf，需要扫描所有 ATA       |
| "tokenURI 函数返回 URI"   | view 函数          | URI 是 Metadata Account 的字段        |
| "approve"                | 标准 ERC721        | 用 delegate（独立指令）               |
| "transfer 调合约"         | safeTransferFrom   | 调 SPL Token Program 的 transfer      |

## 12. 课后检查清单

- [ ] 我能解释 ERC721 与 Solana NFT 的核心差异。
- [ ] 我能列出一个完整 Metaplex NFT 涉及的所有账户。
- [ ] 我能在客户端推导 metadata PDA 和 master edition PDA。
- [ ] 我能解释 supply = 1, decimals = 0 的必然性。
- [ ] 我能写出"创建 mint + 创建 ATA + mint 1 个 token"的交易。
- [ ] 我能解释 Master Edition 的作用。
- [ ] 我能说明本课实现与完整 Metaplex NFT mint 的差距。

## 13. 下一步

- Lesson 13：Next.js + Anchor，把链上能力接入前端
- Lesson 14：前端推导 PDA
- Lesson 15：前端调用 SPL Token
