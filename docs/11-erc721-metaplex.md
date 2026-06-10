# Lesson 11 - ERC721 与 Metaplex NFT

> 面向 EVM 开发者讲解 Solana NFT 体系：Mint Account、Metadata Account、Master Edition 与 ERC721 的本质差异。

## 1. 核心差异一句话

```text
EVM ERC721:    一个合约 = 一个 NFT 集合
Solana NFT:    一个 Mint = 一个 NFT 实体，集合只是 off-chain 的概念
```

ERC721 把"集合"和"NFT"绑在合约里；Solana 把"集合"留给钱包和市场前端去推断（通过 Metaplex 的 Collection NFT 字段）。

## 2. Solana NFT 的三个账户

### 2.1 Mint Account（NFT 身份）

```text
82 bytes - 标准 SPL Token Mint 布局
```

和 ERC20 Mint 一样的 SPL Token Mint。NFT 的"唯一性"来自：
- supply = 1（铸造时强制）
- decimals = 0（没有小数）

```rust
mint::decimals = 0,
mint::authority = creator,  // 铸造时
mint::supply = 1,           // 铸造后
```

### 2.2 Metadata Account

```rust
// Metaplex Token Metadata 标准
pub struct Metadata {
    pub key: Key,                    // 1 byte = 4 (MetadataV1)
    pub update_authority: Pubkey,    // 谁能改 metadata
    pub mint: Pubkey,                // 关联的 mint
    pub name: String,                // 例如 "Solana Monkey #1234"
    pub symbol: String,              // 例如 "SMB"
    pub uri: String,                 // 链下 JSON 的 URL
    pub seller_fee_basis_points: u16,// 二级市场版税
    pub creators: Vec<Creator>,      // 创作者分润
    pub primary_sale_happened: bool,
    pub is_mutable: bool,
    // ... 还有 collection, uses, etc.
}
```

Metadata 账户**派生自 mint**：
```text
seeds = ["metadata", token_metadata_program_id, mint_pubkey]
```

### 2.3 Master Edition Account

```text
派生自 mint: seeds = ["metadata", token_metadata_program_id, mint_pubkey, "edition"]
```

控制：
- 总供应（print_edition 上限）
- NFT 是否可以"印刷"出多个版本（print_edition）

## 3. 链上 vs 链下

```text
On-chain (链上):
  - Mint (NFT 身份)
  - Metadata (name, symbol, uri, creators, royalty)
  - Master Edition (supply cap, print authority)

Off-chain (链下):
  - JSON 文件 (uri 指向)
    - image: IPFS / Arweave URL
    - attributes: 各种 trait
    - description
    - animation_url
    - external_url
```

### 关键边界

| 信息           | 在哪           | 谁能改                 |
| -------------- | -------------- | ---------------------- |
| 谁拥有 NFT     | Token Account  | owner（持有私钥的人）   |
| NFT 名字       | Metadata       | update_authority       |
| NFT 图片       | 链下 JSON + IPFS| 链下数据永久就永久     |
| 二级版税       | Metadata       | update_authority       |
| 集合信息       | Metadata.collection | update_authority  |
| 总供应 1       | Master Edition | 不可改                 |

## 4. 集合（Collection）是什么？

ERC721 的集合写在合约里：
```solidity
contract BAYC {
    string public name = "Bored Ape";  // 集合名
    uint256 public totalSupply = 10000; // 数量
    function tokenURI(uint256 id) ...   // 单个 NFT 数据
}
```

Solana 的集合只是 **Metadata 里的一个字段**：
```rust
pub struct Collection {
    pub verified: bool,         // 创作者是否确认这个 mint 属于这个集合
    pub key: Pubkey,            // 集合的 mint（是的，集合本身也是一个 NFT）
}
```

- "集合"也是 NFT！一个 mint 即可代表一个 collection
- 单个 NFT 的 metadata.collection.key 指向这个 collection mint
- "verified" 表示 NFT mint 的 creator 是否确认这个归属关系

## 5. 完整 NFT Mint 流程

```text
1. 创建 Mint Account
   - decimals = 0
   - mint authority = creator（铸造后可以放弃）
   - supply = 0 → 铸造 → supply = 1

2. 创建 Metadata Account (CPI Metaplex)
   - name / symbol / uri
   - creators: Vec<Creator>
   - collection: Some(Collection) 可选

3. 创建 Master Edition Account (CPI Metaplex)
   - max_supply = 0 表示不可印刷
   - print_supply: 0

4. (可选) 铸造 1 个 token 到 creator 的 ATA

5. (可选) 放弃 mint authority
```

对应 EVM：
```solidity
// ERC721 一步搞定
_mint(to, tokenId);
_setTokenURI(tokenId, uri);
```

## 6. ERC721 vs Metaplex 对照表

| 维度             | ERC721                                | Solana NFT (Metaplex)               |
| ---------------- | ------------------------------------- | ----------------------------------- |
| 集合定义         | 合约地址                              | Collection NFT（一个 mint）         |
| 单 NFT 身份      | uint256 tokenId                       | Mint Account                        |
| 单 NFT 数据      | tokenURI 返回的 JSON                  | Metadata Account + uri              |
| 总供应           | totalSupply()                          | Master Edition supply               |
| 版税             | EIP-2981 / 自实现                     | Metadata.seller_fee_basis_points    |
| 创作者分润       | 自实现                                | creators Vec + 链上分配             |
| 增发（多份）     | 合约函数                              | print_edition（由 Master Edition 控制）|
| 销毁             | burn(tokenId)                          | burn token account                  |
| 升级 / 不可变性  | 合约不可升级（默认）                  | is_mutable 字段 + update_authority  |
| 跨程序           | 合约内函数                            | CPI to Metaplex Token Metadata      |

## 7. 派生地址速查

```text
Mint Account:                          无派生，keypair 生成
Associated Token Account (持有者):     ATA(mint, owner)
Metadata Account:                      ["metadata", MPL_PROGRAM, mint]
Master Edition Account:                ["metadata", MPL_PROGRAM, mint, "edition"]
Collection Mint:                       就是另一个 NFT mint
```

## 8. 创作者分润（Royalty）

```rust
pub struct Creator {
    pub address: Pubkey,
    pub verified: bool,    // 是否经过签名验证
    pub share: u8,         // 百分比（总和 = 100）
}
```

- 多个 creator，share 之和 = 100
- 二级市场通过 Metaplex 的 pnft 或 Bubblegum 等协议自动分润
- 链上强制，卖家无法绕过

## 9. CPI 调用 Metaplex 写 metadata

```rust
use mpl_token_metadata::instruction::{create_metadata_accounts_v3, create_master_edition_v3};

let ix = create_metadata_accounts_v3(
    metadata_program_id,
    metadata_account,
    mint,
    mint_authority,
    payer,
    update_authority,
    name,
    symbol,
    uri,
    creators,
    seller_fee_basis_points,
    false,  // is_mutable
    None,   // collection
    None,   // uses
    None,   // collection_details
);
invoke(&ix, &accounts)?;
```

## 10. 链上 vs 链下信息边界图

```text
┌─────────────────────────────────┐
│ Token Account                   │  ← 链上：谁拥有 NFT
│ (ATA for mint)                  │
└─────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Mint Account                    │  ← 链上：supply=1, decimals=0
└─────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Metadata Account                │  ← 链上：name, uri, royalty
│   uri: "https://arweave.net/..."│
└─────────────────────────────────┘
           │
           │ uri
           ▼
┌─────────────────────────────────┐
│ JSON 文件 (Arweave / IPFS)      │  ← 链下：image, traits, description
│   {                              │
│     "image": "...",              │
│     "attributes": [...]          │
│   }                              │
└─────────────────────────────────┘
```

## 11. 常见误区

### 误区 1：以为 Solana NFT 有 tokenId

错。Solana NFT 的"身份"是 mint address（公钥），没有递增的 tokenId。tokenId 是 ERC721 的发明。

### 误区 2：以为销毁 NFT 要销毁 mint

错。销毁 NFT = 销毁 token account（让 supply 变 0）。mint 本身可以保留（"dead mint"）作为收藏证明。

### 误区 3：以为 Metaplex 是 Solana 官方标准

Metaplex 是事实标准但不是 Solana 协议层的标准。你完全可以不依赖 Metaplex 自己写 metadata 账户。

### 误区 4：以为 metadata.uri 必须用 IPFS

错。可以是任何 URL：IPFS、Arweave、AWS S3、甚至中心化服务器。**Arweave 才是永久存储的常见选择**。

### 误区 5：以为 NFT 不能分润给多个 creator

错。`creators` 字段支持多个地址 + 各自 share。链上强制分润。

## 12. 课后检查清单

- [ ] 我能列出 Solana NFT 的三个核心账户。
- [ ] 我能解释 Metadata Account 派生自 mint。
- [ ] 我能解释"集合"只是 metadata 里的一个字段。
- [ ] 我能解释链上和链下信息的边界。
- [ ] 我能用一句话解释 ERC721 和 Metaplex 的最大差异。
- [ ] 我能解释 royalty 是怎么强制分润的。
- [ ] 我能解释"销毁 NFT"和"销毁 mint"的区别。

## 13. 下一步

- Lesson 12：用 Anchor 实际 mint 一个 NFT
- Lesson 17：Voting
- Lesson 18：Airdrop（NFT 版）
