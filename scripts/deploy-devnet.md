# Lesson 24：Devnet 部署

> 面向 EVM 开发者的 Solana Program 部署指南。把"Foundry 部署到 Sepolia"翻译成"Anchor 部署到 Devnet"。

---

## 0. 目标

完成本课后，你应当能够：

1. 把本地 Anchor 项目构建为可执行 Program（ELF + BPF）。
2. 在 Solana CLI 中切换本地 validator / devnet / mainnet。
3. 给部署钱包准备 devnet SOL。
4. 把 Program 部署到 devnet 并验证 on-chain 状态。
5. 区分 build / deploy / upgrade / close 的命令边界。
6. 排查部署阶段 6 类典型错误。

---

## 1. EVM 心智 vs Solana 心智

| 维度         | EVM（Foundry / Hardhat）                                     | Solana（Anchor）                                                |
| ------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| 产物         | 字节码 + ABI 字节码 + Metadata JSON                         | 共享对象 `.so`（BPF 字节码）+ IDL JSON                          |
| 地址         | CREATE 推导：deployer + nonce                                | 显式 keypair：上传时由钱包签名指定 program id                   |
| 状态载体     | 合约 storage（链上）                                         | 独立账户（链上，单独 address）                                  |
| 部署脚本     | `forge create` / `hardhat deploy`                            | `anchor deploy` 内部调用 `solana program deploy`               |
| 升级         | Proxy 模式：实现合约地址写入代理 storage                    | 官方 `--upgradeable` + 升级 authority 签名                      |
| 验证         | Sourcify / Etherscan 字节码匹配                              | 链上 IDL（Anchor 自动） + 源码仓库自验证                        |
| 测试网 SOL   | Sepolia ETH：faucet                                          | Devnet SOL：`solana airdrop` 或 web faucet                      |
| 部署成本     | 一次 gas，量大时单价高                                       | 一次性租金（rent），可关闭回收                                  |
| 默认终结性   | probabilistic（12+ 区块）                                    | 亚秒级 deterministic（30+ slot）                               |

**关键边界**：EVM 的"deploy 一次就拿到合约地址"和 Solana 的"deploy 一次就拿到 program id"在表面上很像，但 Solana 的 program id 是部署前就确定（从 keypair 文件推导），而 EVM 的合约地址是部署时才计算。

---

## 2. 准备工作

### 2.1 工具链

```bash
# 必需
node --version      # >= 18
rustc --version     # >= 1.78
cargo --version
solana --version    # >= 1.18，建议 2.x
anchor --version    # 建议 0.30+
yarn --version      # 或 npm

# 工具链安装参考
# Rust:   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Solana: sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
# Anchor: cargo install --git https://github.com/coral-xyz/anchor avm --locked
#         avm install latest && avm use latest
```

> 警告：`cargo install anchor --locked` 在 0.30+ 已被弃用，必须通过 `avm`。

### 2.2 钱包准备

Solana CLI 默认钱包路径：`~/.config/solana/id.json`。

```bash
# 生成新钱包（生产请用硬件钱包或多签，本地 devnet 可用文件系统钱包）
solana-keygen new --outfile ~/.config/solana/devnet-wallet.json

# 查看公钥（= 钱包地址）
solana-keygen pubkey ~/.config/solana/devnet-wallet.json
```

EVM 类比：`solana-keygen new` ≈ `cast wallet new`，但文件里直接存私钥数组（明文 JSON 数组），没有助记词封装层。

---

## 3. Solana CLI Config

`~/.config/solana/cli/config.yml` 控制 RPC URL、commitment、默认钱包。

```bash
# 查看当前配置
solana config get

# 输出示例：
# Config File: /Users/fone/.config/solana/cli/config.yml
# RPC URL: https://api.devnet.solana.com
# WebSocket URL: wss://api.devnet.solana.com/ (computed)
# Keypair Path: /Users/fone/.config/solana/id.json
# Commitment: confirmed
```

### 3.1 切换 cluster

```bash
# 切到 devnet
solana config set --url devnet

# 切到 mainnet
solana config set --url mainnet-beta

# 切到 local validator
solana config set --url localhost

# 切到自定义 RPC（QuickNode / Helius）
solana config set --url https://your-rpc.example.com
```

### 3.2 切换钱包

```bash
# 单次使用（不写 config）
solana balance ~/.config/solana/devnet-wallet.json

# 默认钱包切换
solana config set --keypair ~/.config/solana/devnet-wallet.json
```

### 3.3 Commitment 等级

| Level        | 含义             | 部署场景               |
| ------------ | ---------------- | ---------------------- |
| `processed`  | 节点已收到       | 调试、只看是否进 mempool |
| `confirmed`  | 集群多数票通过   | devnet / 部署后查看     |
| `finalized`  | 31+ slot 不可逆  | mainnet / 跨链桥依赖   |

部署命令默认 `confirmed`，要查"已经写入"用 `finalized`。

---

## 4. 获取 Devnet SOL

部署一个 Program 大约需要 **2~3 SOL**（rent 缓冲 + 交易费 + 账户分配）。开发阶段建议钱包常备 **5 SOL**。

### 4.1 CLI airdrop

```bash
# 单次最多 5 SOL
solana airdrop 2

# 指定钱包
solana airdrop 2 ~/.config/solana/devnet-wallet.json

# 指定 cluster
solana airdrop 2 --url devnet
```

**限制**：devnet airdrop 有速率限制（通常每笔 ≤ 5 SOL，每天受限）。如果失败，使用 web faucet。

### 4.2 Web Faucet

访问以下任一：

- 官方：<https://faucet.solana.com/>
- QuickNode：<https://faucet.quicknode.com/solana/devnet>

把钱包公钥贴进去，每次 1~2 SOL。

### 4.3 验证余额

```bash
solana balance

# 公共 RPC 查任意地址
solana balance <PUBKEY> --url devnet
```

> 消耗 devnet SOL 的命令：`anchor deploy`、`solana program deploy`、`solana airdrop`（消耗 airdrop 配额）。

---

## 5. Anchor.toml 准备

Anchor 的 `Anchor.toml` 是部署入口，分四个 cluster 段：

```toml
[toolchain]
package_manager = "yarn"

[features]
resolution = true
skip-lint = false

[programs.localnet]
counter = "Counter1111111111111111111111111111111111"

[programs.devnet]
counter = "Counter1111111111111111111111111111111111"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```

### 5.1 关键字段

- `programs.<cluster>.<name>`：每个 cluster 下该 program 的 program id。
- `provider.cluster`：默认 `anchor test` / `anchor deploy` 走哪个 cluster。
- `provider.wallet`：默认钱包 keypair 路径。

### 5.2 cluster 与 anchor deploy 行为

```bash
# 默认使用 [provider].cluster
anchor deploy

# 显式指定
anchor deploy --provider.cluster devnet

# 编译 + 部署一步
anchor build && anchor deploy --provider.cluster devnet
```

> EVM 习惯：Foundry 用 `--rpc-url` 选网络，Hardhat 用 `--network`。Anchor 把"网络"做成 Anchor.toml 段名 + CLI 标志。

---

## 6. Program ID 准备与更新

Solana 的 program id **必须** 在 `declare_id!()` 里和部署 keypair 推导出一致。

### 6.1 Anchor 自动管理

```bash
# 列出所有 program 的 keypair 路径
anchor keys list

# 输出
# counter: 9XQM9X8...keypairs/counter-keypair.json
```

Anchor 默认在 `target/deploy/<program_name>-keypair.json` 存 program id keypair。**该 keypair 是 program id 的私钥**，丢了再也无法升级该 program。

### 6.2 手动同步

```bash
# 同步 Anchor.toml 中 [programs.localnet] 的 program id
anchor keys sync

# 输出
# "counter" keypair updated to 9XQM9X8... in Anchor.toml
```

该命令把 `target/deploy/counter-keypair.json` 的公钥写回 `[programs.<cluster>]`。

### 6.3 手动指定 keypair

如果要把 program id 写成可复现值（多签 / 灰度），可以用固定 keypair：

```bash
# 1. 生成固定 keypair
solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/my_program-keypair.json

# 2. 写回 Anchor.toml
anchor keys sync

# 3. 把公钥粘到 declare_id!() 中（不是编译时自动读取）
```

### 6.4 declare_id!() 的角色

```rust
declare_id!("9XQM9X8xxxxxxx");
```

这是**编译期**的 program id，必须等于：

- 部署时 `solana program deploy` 指定的 keypair 公钥；
- `Anchor.toml` 中 `[programs.<cluster>]` 的 program id；
- 前端 IDL / `programId` 引用。

**三者必须一致**。不一致会报 `program id mismatch`（错误排查章节展开）。

---

## 7. 部署流程

### 7.1 anchor build

```bash
# 标准流程
anchor build
```

内部步骤：

1. 编译 `programs/*/src/*.rs` 为 BPF 共享对象（`target/deploy/*.so`）。
2. 生成 IDL（`target/idl/*.json`）和类型（`target/types/*.ts`）。
3. 把 program id 写进 `Anchor.toml`（如果 keys 已存在）。

> EVM 对照：`anchor build` ≈ `forge build` 产物，**不部署**。产物路径 `target/deploy/<name>.so` 类似 Foundry 的 `out/<Name>.sol/<Name>.json` + `out/<Name>.sol/<Name>.svelte.sol`。

### 7.2 anchor deploy

```bash
# 本地 validator
anchor deploy

# devnet
anchor deploy --provider.cluster devnet

# 指定 program 名（多 program 项目）
anchor deploy --program-name counter --provider.cluster devnet
```

内部调用：

```
solana program deploy \
  --keypair ~/.config/solana/devnet-wallet.json \
  target/deploy/counter.so \
  --program-id target/deploy/counter-keypair.json
```

### 7.3 直接 solana program deploy

`anchor deploy` 是 wrapper；底层是 Solana CLI 命令：

```bash
solana program deploy \
  --url devnet \
  --keypair ~/.config/solana/deployer.json \
  --program-id target/deploy/counter-keypair.json \
  --max-sign-attempts 5 \
  --use-rpc \
  target/deploy/counter.so
```

常见 flag：

- `--max-sign-attempts N`：blockhash 失效后重试次数。
- `--use-rpc`：通过 RPC 发送（默认走 TPU），更稳定但稍慢。
- `--with-compute-unit-price <price>`：支付优先费（拥堵时）。
- `--buffer <address>`：升级时先写到 buffer，再原子切到可执行 program。

### 7.4 部署后验证

```bash
# 查看 program on-chain 状态
solana program show <PROGRAM_ID> --url devnet

# 输出
# Program Id: 9XQM9X8...
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# ProgramData Address: ...
# Authority: <你的钱包>
# Last Deployed In Slot: 123456789
# Data Length: 245760 (240.00 KiB)

# 查询 IDL（Anchor 自动上链）
anchor idl fetch <PROGRAM_ID> --provider.cluster devnet -o idl.json
```

---

## 8. 升级与关闭

### 8.1 升级

```bash
# 第一次部署就用可升级 loader
anchor deploy --provider.cluster devnet -- --upgradeable

# 之后升级
solana program deploy \
  --url devnet \
  --keypair ~/.config/solana/deployer.json \
  --program-id target/deploy/counter-keypair.json \
  target/deploy/counter.so
```

升级 authority 默认是部署者钱包；要转移给多签：

```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <MULTISIG>
```

### 8.2 关闭回收

```bash
# 关闭 program 并回收 lamports 给接收方
solana program close <PROGRAM_ID> --recipient <RECIPIENT_PUBKEY> --url devnet
```

> 关闭后 program id 仍存在（账户不删），但任何调用都会失败。重新 `solana program deploy` 到同一 id 会重置账户（仅当 keypair 还在）。

---

## 9. 常见错误排查

### 9.1 余额不足

```
Error: Account <PUBKEY> does not have enough SOL for rent
```

- 检查：`solana balance`
- 解决：`solana airdrop 5`（devnet）或往钱包转入 SOL。

### 9.2 Program ID 不一致

```
Error: IDL was generated for program ID X, but the on-chain program ID is Y
```

或部署时报：

```
Error: deploying program failed: Provided program id <X> does not match the id of the program in the keypair <Y>
```

- 解决：

```bash
# 用 keypair 公钥覆盖 Anchor.toml 和 declare_id!
anchor keys sync
anchor build
anchor deploy
```

### 9.3 Keypair 文件找不到

```
Error: keypair file not found at ~/.config/solana/id.json
```

- 解决：`solana-keygen new` 或 `solana config set --keypair <path>`。

### 9.4 BPF 编译失败

```
error: linking with `cc` failed: exit status: 1
```

- 多半是 `anchor-lang` / `anchor-spl` 版本与 BPF SDK 不匹配。
- 解决：

```bash
anchor build --no-doc  # 跳过 IDL 生成加速
cargo update -p anchor-lang
cargo build-bpf  # 旧式命令
```

### 9.5 RPC 超时 / Blockhash 失效

```
Error: unable to confirm transaction
```

- 解决：加 `--use-rpc`、加 `--max-sign-attempts 10`、或换 RPC 提供商。

### 9.6 部署时 program 已存在但不是 upgradeable

```
Error: Program is not upgradeable
```

- 解决：先 `solana program close` 再用同一 keypair 重新 deploy。

### 9.7 IDL 缺失

```
Error: Account does not exist or has no data: <IDL_ADDRESS>
```

- 原因：program 是用 `solana program deploy` 部署而非 `anchor deploy`，链上没有 IDL 账户。
- 解决：

```bash
anchor idl init <PROGRAM_ID> --filepath target/idl/counter.json --provider.cluster devnet
```

---

## 10. 完整 Devnet 部署示例（以 Lesson 04 Counter 为例）

```bash
# 1. 切到 devnet
solana config set --url devnet
solana config set --keypair ~/.config/solana/devnet-wallet.json

# 2. airdrop
solana airdrop 5
solana balance

# 3. 准备项目
cd examples/04-counter

# 4. 检查 program id
anchor keys list
cat Anchor.toml | grep counter
cat programs/counter/src/lib.rs | grep declare_id

# 5. 同步（如有需要）
anchor keys sync

# 6. build
anchor build

# 7. deploy
anchor deploy --provider.cluster devnet

# 8. 验证
solana program show <PROGRAM_ID> --url devnet
anchor idl fetch <PROGRAM_ID> --provider.cluster devnet

# 9. 跑 devnet 测试（修改 Anchor.toml 暂时指向 devnet program id）
anchor test --provider.cluster devnet --skip-build --skip-deploy
```

---

## 11. EVM 部署脚本对照

| 步骤             | Foundry（Sepolia）                                          | Anchor（Devnet）                                                |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| 选择网络         | `--rpc-url https://sepolia.infura.io/v3/...`                | `solana config set --url devnet`                                |
| 部署者钱包       | `cast wallet derive` 或 keystore                            | `solana-keygen new --outfile deployer.json`                     |
| 获取测试 ETH     | Sepolia faucet                                              | `solana airdrop 5` / web faucet                                 |
| 编译             | `forge build`                                               | `anchor build`                                                  |
| 部署             | `forge create --rpc-url <url> --private-key <pk> src/C.sol:Counter` | `anchor deploy --provider.cluster devnet`                       |
| 验证             | Sourcify API / Etherscan                                     | `anchor idl fetch` + 源码仓库自验证                              |
| 升级             | 部署新实现 + 升级代理调用                                    | `solana program deploy` 同 keypair 重传（authority 签名）       |
| 关闭             | `selfdestruct`（已禁用）                                    | `solana program close`                                          |
| 索引事件         | The Graph / Etherscan                                        | Helius / Triton 索引 `Program data:` 日志                       |

---

## 12. 安全 & 工程 checklist

部署到 **mainnet** 之前必须逐项确认：

- [ ] Program id keypair 已备份（target/deploy/<name>-keypair.json），且有多副本。
- [ ] 升级 authority 已转移到多签 / 治理合约。
- [ ] `declare_id!()` 与 Anchor.toml、与 on-chain program id 三者一致。
- [ ] Program 已 `--upgradeable` 部署，或明确决定 `final`。
- [ ] IDL 上链（`anchor idl init` 或通过 `anchor deploy` 自动上链）。
- [ ] 部署钱包与升级钱包分离（部署钱包只要一次签名，之后销毁）。
- [ ] 部署钱包 SOL 余额预留 >= 5 SOL（防止后续操作 fee 不足）。
- [ ] `.gitignore` 排除 `target/` 与 `*-keypair.json`。
- [ ] 已 `anchor test` 在本地 + devnet 跑通。
- [ ] `anchor audit` / 第三方审计报告已存档。
- [ ] Bug bounty / 紧急暂停方案明确。

---

## 13. 课后检查清单

完成本课后，请自检：

- [ ] 能用 `solana config get` 看到当前 cluster。
- [ ] 能用 `solana airdrop` 给本地钱包充 devnet SOL。
- [ ] 解释为什么 program id 必须在部署前确定。
- [ ] 说明 `declare_id!()`、Anchor.toml、keypair 文件三者的关系。
- [ ] 能区分 `anchor build`、`anchor deploy`、`anchor test` 的执行边界。
- [ ] 能解释 devnet / testnet / mainnet 名称在 Solana 中的差异（与 EVM 的 testnet/mainnet 对应关系）。
- [ ] 能说出 6 种部署错误的修复方式。
- [ ] 能在 10 分钟内把 Lesson 04 的 Counter 部署到 devnet 并验证。
- [ ] 知道部署会消耗哪些资源（SOL / 区块空间 / 上传字节）。
- [ ] 能用一句话区分 Solana 升级 authority 与 EVM 代理管理员。

---

## 14. 进一步阅读

- Solana CLI：<https://solana.com/docs/intro/installation>
- Anchor CLI：<https://www.anchor-lang.com/docs/installation>
- 部署命令：<https://solana.com/docs/intro/deploying>
- BPF loader：<https://github.com/solana-labs/solana/blob/master/sdk/program/src/bpf_loader_upgradeable.rs>
- IDL 规范：<https://www.anchor-lang.com/docs/idl>

> 提示：本文档不要求也不推荐你立刻部署到 mainnet。devnet 跑通 + mainnet 审计 + 多签管理是三件独立的事，不要混在一起。
