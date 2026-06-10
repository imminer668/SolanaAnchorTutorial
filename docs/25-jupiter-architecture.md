# Lesson 25 - Jupiter架构拆解：从1inch视角理解 Solana聚合器

> 面向 EVM开发者：用 Uniswap Router /1inch /0x 的心智模型，拆解 Jupiter 的 Quote / Swap / On-chain 三层架构。
> 重点回答一个 EVM 没有直接对应物的问题：**Solana交易账户列表（≤64账户 / ≤1232字节 / Address Lookup Tables）如何反向塑造 Jupiter 的路由算法**。

---

## 0. 本课定位与心智地图

读完本课，你应该能用下面这张心智地图回答任何"Jupiter是什么"的问题：

```
用户想换 SOL -> USDC
 |
 v
 ┌───────────────┐
 │ Frontend UI │ (jup.ag /钱包 dApp)
 └──────┬────────┘
 │1) GET /order 或 GET /build
 v
 ┌───────────────┐
 │ Jupiter API │ Route阶段：多引擎报价 / Metis 路由
 │ Metis + RFQ │ -> 返回 routePlan + outAmount + tx/ix
 └──────┬────────┘
 │2) /swap/v2/execute（仅 /order 路径）/tx/v1/submit（任意已签交易）
 v
 ┌───────────────┐
 │ Jupiter API │ Landing阶段：托管落地或自发交易
 │ Build Server │ -> 返回 signature / 自行确认
 └──────┬────────┘
 │3)钱包签名
 v
 ┌───────────────┐
 │ Solana RPC │ Submit阶段：交易上链
 └──────┬────────┘
 │4)链上执行
 v
 ┌───────────────┐
 │ jupiter_ │ On-chain Router：顺序遍历 routePlan，
 │ aggregator-v6 │ CPI 调用每个 AMM program
 └───────────────┘
```

**EVM 心智类比（务必先建立）：**

| EVM概念 | Solana 对应 | Jupiter 中的角色 |
|---|---|---|
|1inch Pathfinder（off-chain路径搜索） | Jupiter Route API / Metis引擎 | "算哪条路最便宜" |
|1inch AggregationRouterV5（on-chain dispatcher） | `jupiter_aggregator_v6` program | "链上按顺序跳" |
| Uniswap V3 / Sushi / Curve各自的 Router | 每个 AMM program（Raydium CLMM、Orca Whirlpool 等） | "单跳 DEX" |
| `Multicall`（打包交易） | Versioned Transaction + Address Lookup Tables | "把所有账户塞进一笔 tx" |

**为什么 EVM开发者要专门学这一课？**
- Solana 没有 `msg.sender` 一句话调用的便利——一笔 swap涉及30-60 个账户。
- 1inch路由失败的"账户超限"问题在 Solana 是**结构性硬限制**（1232字节 /64账户），不是 gas 问题。
- Jupiter 的 on-chain program 是一个 **metaprotocol router**，和1inch 的 `AggregationRouterV5` 是同一类东西，只是 Solana 用 CPI跳，EVM 用 `delegatecall`。

> **教学抽象声明**：本章用"前端 → API → on-chain program → AMM program"四层讲 Jupiter。**官方事实**是 Jupiter实际上把 Quote/Build/Submit拆成更多内部微服务（Metis binary、Juno、Iris、Beam 等），但本课只讲清楚"外部可观察的接口"，避免被实现细节带偏。详见 §11。

---

## 1. 目标读者 &验收标准

读完后你应该能：

- [ ] 说出 Jupiter 的三层接口（Route API / Swap API / on-chain program）分别对应 EVM哪一层。
- [ ] 解释为什么 Jupiter 不像1inch 把路由全塞在链上。
- [ ] 读懂 Jupiter 的 `routePlan`字段，把它翻译成 "在哪些 DEX 上走几跳"。
- [ ] 说出 Solana 1232字节 /64账户限制对路由算法的3 个具体影响。
- [ ] 区分 Jupiter v6 与之前版本的三个关键差异（Token2022 / 多跳 / split route）。
- [ ] 知道如果想用 CPI 在自己合约里调 Jupiter，应该用哪个 program。

---

## 2. Jupiter是什么：一句话 + 一段历史

### 2.1 一句话定义

Jupiter 是 Solana 上的 **DEX聚合器**——给定 input mint、output mint 和 amount，返回"走哪些 AMM、按什么比例切分、最终能拿到多少 output"的报价，并把这个报价打包成可签名的 Solana交易。

### 2.2 历史脉络（仅作背景，不深究版本号）

Jupiter 自 v4 起成为 Solana生态最大的聚合器。v6 是当前主力的 on-chain router 程序（mainnet program id 见 §3.3）。v6之后，官方推出 **Swap API v2** 和 **Ultra API**，把"纯 on-chain路由"扩展成"on-chain + RFQ + meta-aggregator"的混合形态。**教学抽象**：你可以把 v6看成"1inch AggregationRouter 的 Solana 版本"，把 v2/Ultra看成"加了 MetaMask Swap / Matcha UX 的版本"。

> **待官方确认**：v6之后是否还有 v7 on-chain program？目前公开仓库里只有 `jupiter_aggregator_v6`。详见 §11。

### 2.3 EVM 类比

| |1inch (EVM) | Jupiter (Solana) |
|---|---|---|
|入口 | `https://api.1inch.io/v5.0/.../quote` | `https://api.jup.ag/swap/v2/order` 或 `/build` |
|路径计算 | Pathfinder（off-chain） | Metis（off-chain） |
|链上 dispatcher | `AggregationRouterV5` | `jupiter_aggregator_v6` |
| 单 DEX | Uniswap / Sushi / Curve | Raydium / Orca / Phoenix / Meteora |
|拆单 | `swap(address[], uint256[], ...)` 单笔多跳 | routePlan 多 step + bps拆分 |

---

## 3. 三层架构：Route API / Swap API / On-chain Program

Jupiter 是**典型三层结构**：off-chain API算路径 → off-chain API打包交易 → on-chain program顺序执行。

### 3.1 第一层：Route API（"算路径"）

**官方入口（Swap API V2 当前，2026-06-11 抽查）**：

- Meta-Aggregator 托管执行：`GET https://api.jup.ag/swap/v2/order`
- Router 自组交易：`GET https://api.jup.ag/swap/v2/build`

**Legacy / Metis V1 旧心智**：

- `GET https://api.jup.ag/swap/v1/quote`
- `/quote + /swap-instructions` 的迁移方向是 V2 Router 的 `/build`。

> **重要更新**：不要再把 `GET /swap/v2/quote` 当作当前 V2 主入口。Jupiter 当前官方文档把 Swap API V2 分成 `/order + /execute` 与 `/build + /tx/v1/submit` 两条路径。

**请求关键参数**：

| 参数 |含义 | EVM 类比 |
|---|---|---|
| `inputMint` | 输入 token mint | `srcToken` |
| `outputMint` | 输出 token mint | `dstToken` |
| `amount` | 输入数量（最小单位） | `amount` |
| `slippageBps` |滑点容忍（基点，100 =1%） | `slippage` |
| `swapMode` | `ExactIn` 或 `ExactOut` |1inch 的 `disableEstimate` 反义 |
| `onlyDirectRoutes` | 只走单跳 | "no multi-hop" |
| `maxAccounts` |限制 route账户数（1-64） | **Solana独有**，详见 §7 |
| `dexes` / `excludeDexes` |限定/排除 AMM类别 |1inch 的 `protocols`过滤 |

**响应关键字段**（来源：Jupiter 官方 V2 响应，字段会因 `/order` 与 `/build` 路径不同而略有差异）：

```jsonc
{
 "inputMint": "So11111...",
 "outputMint": "EPjFWdd...",
 "inAmount": "100000000",
 "outAmount": "152300000",
 "otherAmountThreshold": "150777000", //扣掉 slippage后的最小收到
 "swapMode": "ExactIn",
 "slippageBps":50,
 "priceImpactPct": "0.12",
 "routePlan": [ //关键：路径计划
 {
 "swapInfo": {
 "ammKey": "58oQChx4...", //池子地址
 "label": "Raydium CLMM", // AMM类别
 "inputMint": "...",
 "outputMint": "...",
 "inAmount": "60000000",
 "outAmount": "91380000"
 },
 "percent":60, // v1:百分比
 "bps":6000 // v2: 基点（canonical）
 },
 { "swapInfo": { "label": "Whirlpool", ... }, "bps":4000 }
 ],
 "contextSlot":312345678,
 "timeTaken":0.045
}
```

> **教学抽象**：`routePlan` 是 Jupiter算出来的"执行剧本"。每一步是一个 AMM pool 的 swap指令。**bps** 表示"这一跳占 input 的比例"，所有 step 的 bps 加起来 =10000（100%）。这是 split route（拆单路由）的体现——v6之前常常走单跳或简单两跳，v6之后可以拆成 N步、跨 N 个 AMM。

**EVM 类比**：

```solidity
//1inch 的 swap 参数会带一个 paths数组：
// paths[0] = [{ token: USDC, percentage:60 }, { token: WETH, percentage:40 }]
// 这就是 Jupiter routePlan bps字段在 EVM 上的对应物。
```

### 3.2 第二层：Swap API（"打包交易"）

给定 QuoteResponse，把它转成可签名的 Solana transaction。两条路径：

#### 3.2.1 Meta-Aggregator路径：`/swap/v2/order` + `/swap/v2/execute`

**适用场景**：你只想拿最好的价、不想自己落地交易。
**关键特征**：
- 返回 base64 的 assembled transaction，你签名后 POST 给 `/execute`。
- Jupiter 用 Jupiter Beam引擎帮你落地交易（亚秒级延迟）。
- 自动 RTSE（Real-Time Slippage Estimator）。
- 支持 gasless（RFQ路径）。
- 包含 Jupiter platform fee（5-10 bps）+ 可选 integrator fee。

#### 3.2.2 Router路径：`/swap/v2/build` + `/tx/v1/submit`

**适用场景**：你要在 Jupiter swap之外加自己的指令（CPI、memo、转账等）。
**关键特征**：
- 返回**原始 swap instructions**（不是装好的 transaction），你自己组装 v0 tx。
- 只走 Metis on-chain路由，不走 JupiterZ RFQ。
- 不收 Jupiter平台费，但你要自己处理 RPC、priority fee、落地。
- **支持 CPI**——这是核心优势。

**响应字段（来自官方 `/build`文档）**：

```jsonc
{
 "computeBudgetInstructions": [...], // CU price指令（不含 CU limit）
 "setupInstructions": [...], //预指令，如 createAssociatedTokenAccountIdempotent
 "swapInstruction": {
 "programId": "JUP6LkbZbjS1jKKwap4HNdet74bE2T1SSPdS6rQdKx",
 "accounts": [
 { "pubkey": "...", "isWritable": true, "isSigner": false },
 ...
 ],
 "data": "base64..." // routePlan序列化
 },
 "cleanupInstruction": null, //清理指令，如关闭 wSOL ATA
 "otherInstructions": [],
 "tipInstruction": null,
 "addressesByLookupTableAddress": { //关键：v0 tx用的 ALTs
 "ALT_ADDRESS_1": ["acc1", "acc2", ...],
 "ALT_ADDRESS_2": [...]
 },
 "blockhashWithMetadata": {
 "blockhash": "...",
 "lastValidBlockHeight":312345900
 }
}
```

> **教学抽象**：`swapInstruction`里的 `data` 是 Jupiter 把 `routePlan`序列化成二进制的结果。链上 `jupiter_aggregator_v6` program解析这个 `data`，按顺序 CPI 调用每个 AMM program。

#### 3.2.3 EVM 类比

| | Jupiter |1inch |
|---|---|---|
|拿到 quote / route | `/order` 或 `/build` | `getQuote()` |
|拿到可签名的 tx | `/order` 返回 assembled transaction；`/build` 返回 raw instructions | `swap()` calldata + 自己编码 |
|帮你发交易 | `/execute`（仅 `/order` 交易）或 `/tx/v1/submit`（任意已签交易） |1inch dApp 自己处理 |

### 3.3 第三层：On-chain Program（"顺序执行"）

**Mainnet program id**：`JUP6LkbZbjS1jKKwap4HNdet74bE2T1SSPdS6rQdKx`
**来源**：`jup-ag/jupiter-amm-implementation`仓库的 `jupiter-aggregator-v6/src/lib.rs` 通过 `anchor_lang::declare_program!`声明。

这个 program接收 `swapInstruction.data`，反序列化出 routePlan，**按顺序 CPI 调用每个 AMM program**。

**核心数据流**：

```
swapInstruction.data
 |
 v
deserialize -> Route {
 in_amount: u64,
 quoted_out_amount: u64,
 slippage_bps: u16,
 platform_fee_bps: u16,
 route_plan: Vec<RoutePlanStep>,
 accounts: Vec<AccountMeta> //包含每个 AMM所需账户
}
 |
 v
for each step in route_plan:
 match step.swap_variant { // ~60+ variants
 RaydiumSwap => cpi_to(raydium_program, accounts[step.accounts_offset..]),
 WhirlpoolSwapV2 => cpi_to(orca_program, ...),
 PhoenixSwap => cpi_to(phoenix_program, ...),
 MeteoraDlmmSwapV2 => cpi_to(meteora_program, ...),
 ...
 }
 verify step.out_amount >= min_out_for_step;
 update cumulative_input_amount;
```

> **教学抽象**：`swapInstruction.accounts` 是一个**巨型扁平数组**，按 routePlan顺序切片。每个 step拥有自己的账户段，program 用剩余账户索引 (`remaining_accounts`) 来定位。EVM 类比：可以理解为1inch 的 `paths`数组在扁平化后的"超长 calldata"。

**EVM 类比**：

| EVM (1inch AggregationRouterV5) | Solana (jupiter_aggregator_v6) |
|---|---|
|单一 `swap(address executor, SwapDescription calldata desc, bytes permit, bytes data)`入口 |单一 `route` / `route_with_swap`入口 |
|内部 delegatecall 到各 DEX |内部 CPI 到各 AMM program |
| 通过 `clipperExecutor` / `uniswapV3Executor`库分发 | 通过 `Swap` enum 分发 |
| EVM字节码是 monolithic | Anchor IDL 是 declarative |

### 3.4 三层关系图

```
┌────────────────────────────────────────────────────────────────┐
│ Layer1: Route API (off-chain) │
│ - 输入：inputMint, outputMint, amount │
│ - 输出：routePlan + outAmount + priceImpact │
│ - 计算：Metis引擎在内存中搜所有 AMM 的池子，组合最优路径 │
│ -部署：jup.ag 的 Metis binary (closed source) │
│公开仓库镜像：github.com/jup-ag/metis-binary │
└────────────────────────────────────────────────────────────────┘
 │
 │ /order 直接返回 assembled transaction；/build 直接返回 raw instructions
 ▼
┌────────────────────────────────────────────────────────────────┐
│ Layer2: Swap/Build API (off-chain) │
│ - 输入：taker + payer + slippage/maxAccounts/... │
│ -任务：把 routePlan +账户列表打包成 v0 transaction │
│ 计算需要哪些 Address Lookup Tables │
│ 计算 priority fee / compute units │
│ - 输出：base64 tx / raw instructions + ALTs │
└────────────────────────────────────────────────────────────────┘
 │
 │钱包签名后送链
 ▼
┌────────────────────────────────────────────────────────────────┐
│ Layer3: jupiter_aggregator_v6 (on-chain, public) │
│ - program_id: JUP6LkbZbjS1jKKwap4HNdet74bE2T1SSPdS6rQdKx │
│ - 输入：swapInstruction.data │
│ -任务：deserialize ->顺序 CPI 到 routePlan 中每个 AMM │
│ - 输出：用户的 USDC ATA收到 outAmount（扣完 slippage） │
└────────────────────────────────────────────────────────────────┘
 │
 │ CPI跳到
 ▼
┌────────────────────────────────────────────────────────────────┐
│ Layer4: 各 AMM program (Raydium, Orca, Phoenix, ...) │
│ -真正发生 swap 的程序 │
│ -同样接收 swap指令，做数学计算 │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. 路由引擎工作流（Metis on-chain路径）

> 本节详解 `/build`路径下的内部计算。`/order` 多了一步 RFQ 比价，详见 §8。

### 4.1 路由算法输入

Metis 在 off-chain 计算时，输入是一张 **market graph**：

```
nodes = 所有已知 AMM池子（Raydium AMM / CLMM / CPMM / Orca / Phoenix / Meteora / ...）
edges = 每个池子 input_mint -> output_mint的一条边
edge_weight =边的"报价"——给定 amount，能换出多少目标 token
```

这张图是 **动态发现** 的（参见 Jupiter官方文档 "market listing"）：
- **Instant Routing**：新池子出生后自动加入，无需通过流动性门槛（基于 token age 的 grace period）。
- **Normal Routing**：每30 分钟重检一次流动性，低于阈值（round-trip 价格差 >30% 或 price impact >20%）的池子被剔除。

### 4.2 路由搜索：单跳 / 多跳 /拆单

Metis 会同时评估：

1. **Direct route**：A -> B 在某个池子里直接换。
2. **Multi-hop route**：A -> 中间币 -> B。中间币从 USDC、USDT、SOL 等高流动性币中选。
3. **Split route**：把 amount拆成 N份，分别走不同 AMM，bps 加起来 =10000。

**EVM 类比**：
- 1inch Pathfinder同样支持 split route，但 EVM链上 gas成本会让 split 不划算，除非单笔金额大。
- Solana链上**没有 gas-per-byte 这种线性成本**（只有固定5000 lamports base fee + priority fee），所以 split 在 Solana 上更便宜。

### 4.3 路由打分

Metis 用 outputAmount 作为评分函数。对于 split route，加权平均输出量 = `sum(step.outAmount * step.bps /10000)`。

```text
score = best_route.outAmount
 - price_impact_penalty
 - slippage_buffer
```

### 4.4 交易账户预算：约束求解

这一步是 **Solana独有** 的关键约束：

```
min_accounts_required_for_route >=64? ->拒绝该 route，要求 maxAccounts收紧
route_accounts + setup_accounts + cleanup_accounts >64?
 -> 选择更短的 route 或限制 maxAccounts
total_account_bytes >1232 - blockhash_bytes - sig_bytes - header?
 ->启用 Address Lookup Tables
```

`maxAccounts` 参数（1-64，默认64）允许前端**显式约束**路由算法的搜索空间——这在 EVM 不存在。

> **教学抽象**：可以把 `maxAccounts`理解为1inch 的 "split across N protocols"，但 EVM 的 N 是 gas-cost 计算出来的，Solana 的 N 是账户硬限制计算出来的。

### 4.5 账户 → ALT打包

Build阶段把路由用到的所有账户，按 Solana 的 ALT协议打包：

1. 查询 Jupiter 自己维护的 ALT（已存在的常用池子表）。
2. 把超出账户列表面（>35 个）的部分自动塞进新建的临时 ALT。
3. 把这些 ALT 地址放进 transaction.message.addressTableLookups。

**EVM 类比**：类似于1inch 的 `multicall` 把多个调用打包，但 Solana 的 ALT 是把"地址"也打包（不只是 calldata）。

### 4.6 路由引擎工作流图

```
GET /swap/v2/build?inputMint=X&outputMint=Y&amount=Z&taker=USER
 │
 ▼
┌─────────────────────────────────────────────────────┐
│1. Market Graph Loader │
│ - 从 platform-list仓库拉 pool list │
│ -加载每个 pool 的 reserves / tick state │
│ -缓存到内存 (cache TTL ~ 数秒) │
└─────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────┐
│2. Route Search (Metis) │
│ -枚举所有 direct / multi-hop / split routes │
│ - 对每个 route 调用 AMM.quote() (off-chain) │
│ -过滤：account_count <= maxAccounts │
│ -排序：best_out_amount first │
└─────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────┐
│3. Route Selection │
│ - 取 top-1 route │
│ - 计算 route.accounts 的字节大小 │
│ -决定是否启用 ALT │
└─────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────┐
│4. Transaction Build │
│ - prepend: compute budget ix │
│ - prepend: create ATA ix (if needed) │
│ - middle: swap ix (data = routePlan序列化) │
│ - append: cleanup ix (close wSOL ATA 等) │
│ - addressesByLookupTableAddress字段返回 ALTs │
└─────────────────────────────────────────────────────┘
 │
 ▼
┌─────────────────────────────────────────────────────┐
│5. Return │
│ - swapInstruction { programId, accounts, data } │
│ - setup/cleanup/other/tip instructions │
│ - ALTs数组 │
│ - blockhash + lastValidBlockHeight │
└─────────────────────────────────────────────────────┘
```

---

## 5. AMM Adapter抽象（如何把60+ 个 DEX 接进来）

Jupiter 的核心难题：每个 AMM 的状态布局、报价函数、CPI 接口都不一样。如何让路由引擎**不关心**这些差异？

### 5.1 抽象：`jupiter_amm_interface` crate

仓库位置：<https://github.com/jup-ag/jupiter-amm-implementation>（monorepo）

**核心 trait（来自官方文档 "dex integration"）：**

```rust
//简化示意，不代表真实字段
pub trait Amm {
 fn from_keyed_account(&self, ka: &KeyedAccount) -> Result<Self>;
 fn label(&self) -> AmmLabel;
 fn program_id(&self) -> Pubkey;

 fn get_reserve_mints(&self) -> Vec<Pubkey>;

 //关键：报价（纯 off-chain 计算）
 fn quote(&self, quote_params: &QuoteParams) -> Result<Quote>;

 //关键：生成 swap instruction（CPI所需的 AccountMeta列表）
 fn get_swap_and_account_metas(
 &self,
 swap_params: &SwapParams,
 ) -> Result<SwapAndAccountMetas>;

 //缓存刷新：拉取链上 reserves / tick 等
 fn update(&mut self, account_map: &AccountMap) -> Result<()>;

 // 提供给路由引擎：哪些账户需要在 update阶段拉
 fn get_accounts_to_update(&self) -> Vec<Pubkey>;
}
```

**关键约束（来自官方 README）：**
> "Limit the Amm implementation to deserializing the state and calling your SDK to quote. Move everything that needs to be done only when the state changes to update, rather than quote."

含义：
- `quote()`必须是**纯计算**，不能发起 RPC 调用。
- `update()` 才负责拉链上数据。
- 这样路由引擎可以缓存 AMM 实例，反复调用 `quote()` 而不重复 IO。

### 5.2 注册表：`PROGRAM_ID_TO_AMM_LABEL_WITH_AMM_FROM_KEYED_ACCOUNT`

在 `jupiter-core/src/amms/loader.rs` 里：

```rust
pub fn amm_factory(
 keyed_account: &KeyedAccount,
 amm_context: &AmmContext,
) -> Result<Option<Box<dyn Amm + Send + Sync>>> {
 let owner = keyed_account.account.owner;
 PROGRAM_ID_TO_AMM_LABEL_WITH_AMM_FROM_KEYED_ACCOUNT
 .get(&owner)
 .map(|(_, f)| f(keyed_account, amm_context))
 .transpose()
}
```

这段代码**用 program owner 做 dispatch**——只要某个 account 的 owner 是已注册的 AMM program id，就用对应的工厂函数构造一个 `Box<dyn Amm>`。

**教学抽象**：本质上是一个"按 program id 注册 AMM handler"的 map。每个新 AMM 加入时，往这个 map 加一行。

### 5.3 拆 swap变体：`Swap` enum

`jupiter-aggregator-v6` 在 `lib.rs` 里把抽象 `Swap` enum映射到 Anchor IDL生成的 `types::Swap`：

```rust
//简化示例（实际 enum 有60+ variants）
pub enum Swap {
 RaydiumSwap(RaydiumSwap),
 RaydiumClmmSwap(RaydiumClmmSwap),
 WhirlpoolSwap(WhirlpoolSwap),
 WhirlpoolSwapV2(WhirlpoolSwapV2),
 PhoenixSwap(PhoenixSwap),
 MeteoraDlmmSwap(MeteoraDlmmSwap),
 MeteoraDlmmSwapV2(MeteoraDlmmSwapV2),
 // ...
 SanctumS(SanctumS),
 Perps(Perps),
 PumpSwap(PumpSwap),
 // ...
}

impl From<Swap> for types::Swap { ... } //60+ 行 match
```

**EVM 类比**：

```solidity
//1inch AggregationRouterV5内部类似结构：
enum ExecutorType { UniswapV3, Sushi, Curve, ... }
struct SwapDescription {
 IERC20 srcToken;
 IERC20 dstToken;
 address[] receivers;
 uint256[] amounts;
 bytes[] calldatas; // 每个 executor 的 calldata
}
```

但 Solana 的 `Swap` enum 是**显式列举**每个 AMM 的 schema（因为每个 AMM 的 CPI 数据格式不同），EVM 是**统一 calldata bytes + executor address**（让 executor库自行 decode）。

### 5.4 集成一个新 DEX 的流程（来自官方文档）

来源：[Jupiter dex-integration文档](https://github.com/jup-ag/docs/blob/main/swap/routing/dex-integration.mdx)

1. 提供一个**遵循 `jupiter_amm_interface` 的 Rust SDK**。
2. 允许 Jupiter **fork** 这个 SDK（保证维护权）。
3. 把你的 AMM 加进 `PROGRAM_ID_TO_AMM_LABEL_WITH_AMM_FROM_KEYED_ACCOUNT` 注册表。
4. 通过安全审计 + 代码健康度评估 +真实交易量证明。
5. 测试：在 `jupiter-amm-implementation`跑 `cargo test`，对比你的 SDK quote vs on-chain simulation 结果。

**EVM 类比**：类似于把新 DEX集成进1inch 的 PMM (Protocol's Matching Module) 系统。

### 5.5 教学抽象 vs官方事实

> **教学抽象**：Jupiter 把每个 DEX视为一个 `Amm` trait 实现。trait 把"报价"和"swap指令生成"标准化。
> **官方事实**（见 §3.3）：on-chain program还会把每个 DEX 的 swap指令通过 `From<Swap>`显式枚举映射到 Anchor IDL 类型。链上代码**不是 trait-based**——链上必须用 enum枚举所有可能变体，因为 Solana runtime 没有 dynamic dispatch。

---

## 6. 完整 Swap Flow（从用户点击到链上确认）

### 6.1 时序图

```
用户 Frontend Jupiter API Solana RPC jupiter_v6 AMM program
 │ │ │ │ │ │
 │ 点击"SWAP" │ │ │ │ │
 │───────────────>│ │ │ │ │
 │ │1. GET /build │ │ │ │
 │ │───────────────────>│ │ │ │
 │ │ │内部搜 market graph│ │ │
 │ │ │算所有 routes │ │ │
 │ │ │返回 route + raw ix │ │
 │ │<───────────────────│ │ │ │
 │ │ 显示: outAmount, │ │ │ │
 │ │ priceImpact, route │ │ │ │
 │ │ │ │ │ │
 │ 用户点确认 │ │ │ │ │
 │───────────────>│ │ │ │ │
 │ │2. 组装 v0 tx │ │ │ │
 │ │ compute/setup/swap/cleanup ix │ │
 │ │ 合并 ALTs │ │ │ │
 │ │ serialize │ │ │ │
 │ │ │ │ │ │
 │ │3. simulateTransaction (可选) │ │ │
 │ │───────────────────────────────────────>│ │ │
 │ │<───────────────────────────────────────│ │ │
 │ │模拟 CU 用量 │ │ │ │
 │ │ │ │ │ │
 │钱包签名 │ │ │ │ │
 │───────────────>│ │ │ │ │
 │ │ │ │ │ │
 │ │4. sendTransaction │ │ │ │
 │ │───────────────────────────────────────>│ │ │
 │ │ │ │5.验证 tx │ │
 │ │ │ │验证 ALTs │ │
 │ │ │ │验证 signers │ │
 │ │ │ │ 解码 ix.data │ │
 │ │ │ │─────────────>│ │
 │ │ │ │ │6.顺序 CPI │
 │ │ │ │ │────────────────>│
 │ │ │ │ │ Raydium swap │
 │ │ │ │ │<────────────────│
 │ │ │ │ │ Whirlpool swap │
 │ │ │ │ │────────────────>│
 │ │ │ │ │<────────────────│
 │ │ │ │ │7.校验 outAmount
 │ │ │ │ │ >= threshold
 │ │ │ │<─────────────│ │
 │ │ │ │8.状态更新 │ │
 │ │ │ │ 用户 ATA │ │
 │ │ │ │ AMM池子 │ │
 │ │ │ │ │ │
 │ │9.等待 confirm │ │ │ │
 │ │<───────────────────────────────────────│ │ │
 │ │10. UI 更新 "Swap成功" │ │ │
 │<───────────────│ │ │ │ │
```

### 6.2 关键步骤详解

#### 步骤1：GET /build

**目的**：返回最优 Metis 路由和用于自组交易的 raw instructions。

**关键陷阱**：V2 Router 的 `/build` 不再要求你先拿一个 `/quote` 响应再原样传回。它直接返回 `computeBudgetInstructions`、`setupInstructions`、`swapInstruction`、`cleanupInstruction`、`addressesByLookupTableAddress` 等自组交易材料。

#### 步骤2：组装 Versioned Transaction

**目的**：把 `/build` 返回的 raw instructions 转成可签名的 v0 transaction。

**关键点**：
- `swapInstruction.data` 是 base64编码的二进制，包含完整 routePlan。
- `addressesByLookupTableAddress`是个 map：ALT address -> 该 ALT包含的地址列表。前端无需 RPC 调用，直接拿这些 ALT拼出 `AddressLookupTableAccount[]`。
- `blockhashWithMetadata.lastValidBlockHeight` 让前端知道 tx何时过期。

#### 步骤3：simulateTransaction（推荐）

**目的**：估算实际 CU 用量。

**为什么必要**：`/build` 默认返回的 CU limit 是 `1,400,000`（最大值）。但 priority fee = `CU_price * CU_limit`，CU limit 设太大就是多花 priority fee。**官方建议**：模拟后用 `1.2 * simulated_CU` 作为最终 CU limit。

#### 步骤4：钱包签名

**注意**：
- `taker` 必须签名（`isSigner: true`）。
- `userPublicKey`之外没有 signer——所有 AMM池子账户、`jupiter_aggregator_v6` program 都**不签名**。

#### 步骤5：链上落地

**关键校验**：
- ALTs 必须包含 swapInstruction.accounts 引用的所有地址（否则 tx失败）。
- blockhash 必须未过期（lastValidBlockHeight > 当前 slot）。
- priority fee 必须 ≥节点要求的最低（base fee + tip）。

#### 步骤6-7：jupiter_aggregator_v6 执行

**链上逻辑**：
1. `deserialize(swapInstruction.data) -> Route`
2. 检查 `taker` 是 signer
3. 检查 `taker` ATA 是 input mint 的 owner
4. for each step in `route_plan`:
 - 选择对应的 CPI program（基于 step.swap_variant）
 -构造 CPI instruction（用 `remaining_accounts[step.accounts_offset..step.accounts_offset+step.accounts_len]`）
 - invoke CPI
 -校验收到的中间 token amount ≥ `min_out_for_step`
 - 更新 `cumulative_input_amount`供下一步用
5. 校验最终 outAmount ≥ `otherAmountThreshold`（slippage 检查）
6. 如果设置了 `platform_fee_bps`，收取平台费到 `fee_account`

### 6.3 Frontend 代码骨架（教学用途，非生产）

```ts
// Router路径：GET /build 返回 raw instructions，适合你追加自定义指令。
const build = await fetch(
 `https://api.jup.ag/swap/v2/build?inputMint=${SOL}&outputMint=${USDC}&amount=100000000&taker=${wallet.publicKey.toBase58()}&slippageBps=50`,
 { headers: { 'x-api-key': API_KEY } }
).then(r => r.json());

// 伪代码：把 compute/setup/swap/cleanup instructions 反序列化，
// 合并 addressesByLookupTableAddress，compile 成 v0 transaction。
const tx = compileJupiterBuildResponseToV0Transaction(build, wallet.publicKey);
// const sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true });
tx.sign([wallet.payer]);

// 你可以自己发 RPC，也可以把已签交易交给 Jupiter /tx/v1/submit。
const sig = await connection.sendRawTransaction(tx.serialize());
```

---

## 7. Solana交易账户列表对路由的影响（关键 EVM边界）

> **本节是本课核心**——这是 EVM开发者转型 Solana 必须内化的硬约束。

### 7.1 三条硬约束

来源：[Solana官方文档](https://solana.com/docs/core/transactions)

|限制 |数值 |推导 |
|---|---|---|
|交易大小 | **≤1232字节** | IPv6最小 MTU1280 -48字节网络头 |
|账户数 | **≤64 个** |旧标准；理论上 `increase_tx_account_lock_limit` feature激活后可达128 |
| 单笔签名 |1-多个，但每个签名都消耗字节 | Ed25519签名 =64字节 |

### 7.2 对路由算法的3 个具体影响

#### 影响1：路由不能无限"拆"

**EVM 上**：1inch Pathfinder 会拆成 N份（甚至10+份）以求最优。EVM 的成本是"每份单独的 gas"，但拆得越多越不划算——所以拆分上限由 gas 经济性决定。

**Solana 上**：每多拆一份 route，**账户数线性增长**（每个 pool至少10 个账户：pool state、vault A、vault B、LP mint、user ATA、...）。很快触到64账户上限。

**Jupiter应对**：
- `maxAccounts` 参数（1-64，默认64）让前端显式约束。
- Metis 在路由搜索阶段就把 "account count > maxAccounts" 的 candidate砍掉。
- 官方警告：**maxAccounts <50 可能导致 "no route found" 或更差报价**，因为路由引擎访问不到足够的 DEX。

#### 影响2：账户列表被塞进 tx body →字节预算紧

**EVM 上**：calldata 上限32KB，但单笔 swap 通常 <1KB。

**Solana 上**：每笔交易1232字节封顶。**单个 pubkey32字节 + isSigner/isWritable标志位**，64 个账户 =64 ×33 =2112字节**就已经超限**！

**Jupiter应对**：Address Lookup Tables (ALTs)
- ALT 是一个**链上账户**，存储"地址数组"。
- v0 transaction 通过 `addressTableLookups`字段引用 ALT。
- 同一个地址在 tx body 里只占 **1字节**（索引），而不是32字节。
- 一个 tx 可以引用多个 ALT，理论上把账户数上限从64拉到 "几乎无限"。

Jupiter 的 `/build` 自动：
1. 把常用池子放进预创建的 ALT。
2. 把超出64账户的 route 自动塞进新建的临时 ALT。
3. 返回 `addressesByLookupTableAddress`字段，前端无需额外 RPC。

#### 影响3：CPI 受 ALT限制

**EVM 上**：你的合约可以 `delegatecall` 到1inch AggregationRouter，可以传任意 calldata。

**Solana 上**：CPI 调用时**不能使用 ALT**！这是 Solana runtime 的硬约束（`AddressLookupTable` 不能跨 CPI边界传递）。

**Jupiter应对**：
- 用 `maxAccounts` 参数限制 route账户数 ≤64（让 swap ix 不需要 ALT）。
- 提供 **Flash Fill** 作为 alt-ALT路径（支持 ALTs跨程序边界）。
- 把 swap拆成多条 tx（教学抽象：实际上 UI 通常不这么做）。

**你的合约应对**：如果要在自己的 program 里 CPI Jupiter，设置一个 `MAX_ACCOUNTS` 常量（如28，给 setup 和 cleanup留空间），调用 `/build` 时传 `maxAccounts` 参数。

### 7.3 v0 Transaction 结构（教学用）

```
v0 Transaction
├── message
│ ├── header (3 bytes) // num_required_signatures, num_readonly_signed, num_readonly_unsigned
│ ├── address_table_lookups // ALT引用列表
│ │ ├── account_key (1 byte) // ALT 中账户在 tx里的索引位置
│ │ ├── writable_indexes
│ │ └── readonly_indexes
│ ├── recent_blockhash (32 bytes)
│ ├── instructions //实际指令列表
│ └── (账户列表由 header + instructions + ALT共同决定)
└── signatures // Ed25519签名数组
```

字节预算近似：
- header:3
- blockhash:32
- 每条 ix:1 (program_id_idx) + N (account_idx) +1 (data_len) + data
- 签名:64 × num_signers
- ALT lookups: ~20-50字节

**如果你有一条5 个 ix、每个15账户、1 个 signer 的 tx**：~5 × (1 +15 +1 +100) +64 +32 +3 ≈940字节。还有约290字节空间。

### 7.4 `maxAccounts` 参数详解

**来源**：[Jupiter /build文档 "reduce-transaction-size"](https://github.com/jup-ag/docs/blob/main/swap/advanced/reduce-transaction-size.mdx)

```
GET /build?inputMint=X&outputMint=Y&amount=Z&taker=...&maxAccounts=20
```

使用场景：
- 你已经有其他 ix 想加进来（memo、转账、...），账户预算紧张。
- 你要 CPI Jupiter 到自己的合约，需要把账户数压到 CPI限制以内。
- 你观察到 tx 大小超过1232字节。

权衡：
- maxAccounts太小 →路由算法找不到好路径。
- 官方建议：**不低于50**，除非你明确知道目标 DEX列表小。

### 7.5 EVM 心智：必须放弃"账户无限"的假设

在 EVM，你写 `swap(address, address, uint256)` 只关心**合约地址**和**金额**。在 Solana，你必须先问自己：

> "我要让这笔 tx落地，需要把所有 AMM池子地址 +用户的 ATA + 程序 ID + ... 一字不漏地塞进1232字节（或者通过 ALT引用），账户数 ≤64 (或者通过 ALT扩展)。"

这就是为什么 `maxAccounts` 是 Jupiter必备参数，而1inch 没有这种东西。

---

## 8. v6重大变化（与之前版本对比）

> **教学抽象**：下面的"v6之前"指 v4 / v5 等历史版本。具体每个版本的变更，请以官方 changelog 为准。

### 8.1 三个关键差异

#### 差异1：Token2022完整支持

**v6之前**：Jupiter 主要支持 SPL Token program（`TokenkegQ...`），Token2022（`TokenzQd...`）的 transfer hook 等扩展处理不完整。

**v6**：所有 AMM adapter 必须显式支持 Token2022 的 mint / transfer hook。`jupiter_aggregator_v6` 通过 `RemainingAccountsInfo::TransferHookA/B` 把 transfer hook程序的账户注入 CPI链。

**EVM 类比**：类似于 ERC-777 / ERC-1363（带 hooks 的 token）在1inch v3 → v4之间的支持演进。

#### 差异2：拆单路由（split route）成熟化

**v6之前**：Jupiter走的多是1-2跳。拆单路由是新增能力，但不总是最优。

**v6**：split route 成为核心能力。`routePlan` 中的 `bps`字段明确表示每跳占比，加和为10000。所有 AMM都被强制纳入同一套 `Amm` trait，所以 router 可以跨 AMM拆单。

**EVM 类比**：1inch 的 PMM (Protocol's Matching Module) 在 v3 → v4之间的演进。

#### 差异3：单一入口 + CPI友好

**v6之前**：不同 route走不同 program path（v4 有多个 program），CPMM/CLMM/DLMM 各有入口。

**v6**：统一在 `jupiter_aggregator_v6` 一个 program 内通过 `Swap` enum 分发。CPI友好——你的合约只需要调一个 program id。

### 8.2 v6之后的演进（教学抽象）

**Swap API V2**：把 on-chain-only扩展成 Meta-Aggregator + Router 双路径。
- Meta-Aggregator：`/order` + `/execute`（managed landing）。
- Router：`/build` + `/tx/v1/submit`（self-managed landing）。
- 新增 JupiterZ RFQ引擎（off-chain 做市商报价）。

**Ultra API**：进一步把"Juno流动性引擎 + Jupiter Beam落地引擎 + RTSE"打包成"一键 swap"。
- RPC-less：不需要前端持有 RPC节点。
- Gasless：RFQ路径市商付 gas。
- 95%交易 <2 秒。

**官方公告**（来源：Jupiter docs）：
> "Ultra Swap API is no longer actively maintained and has been superseded by Swap V2."
> —来自 `https://developers.jup.ag/docs/ultra`

> **教学抽象**：Ultra → Swap V2 是"产品线收敛"。Ultra强调"开箱即用"，Swap V2强调"灵活组合"。两者底层都依赖 Metis引擎。

### 8.3 与 v6之前的对比表

|维度 | v6之前 | v6 | Swap V2 / Ultra（v6之后） |
|---|---|---|---|
| 单跳支持 | ✅ | ✅ | ✅ |
| 多跳支持 | 部分 | ✅成熟 | ✅ |
|拆单路由 |弱 | ✅核心 | ✅ |
| Token2022 | 部分 | ✅完整 | ✅ |
| RFQ引擎 | ❌ | ❌ | ✅（JupiterZ） |
| Meta-aggregator | ❌ | ❌ | ✅（V2 + Ultra） |
| Managed landing | ❌ | ❌ | ✅（Beam） |
| CPI友好 |多个 program | ✅ 单 program | ✅ 单 program |

---

## 9. 与1inch / UniswapX 的心智模型对比

### 9.1 三者对比总览

|维度 |1inch | UniswapX | Jupiter |
|---|---|---|---|
|链 | EVM 多链 | EVM（Ethereum 主推） | Solana |
|路径计算 | Pathfinder（off-chain） | Order book + Dutch auction | Metis + JupiterZ RFQ |
|链上 dispatcher | AggregationRouterV5 | UniswapX Reactor | jupiter_aggregator_v6 |
|拆单 | ✅ | 部分（按 order） | ✅ 完全（bps） |
| Fill or kill | ❌ | ✅（Dutch auction） | ❌ |
| RFQ | ✅（Limit Order Protocol） | ✅ | ✅（JupiterZ） |
|跨链 | ✅ | ❌ | ❌（仅 Solana） |

### 9.2 "看起来相似但本质不同"的3 个对比点

#### 对比点1：拆分粒度

- **1inch Pathfinder**：按"百分比"拆分（`path.percentage =50`），最多 ~10 个 path。Gas 经济性是软约束。
- **Jupiter Metis**：按"基点"拆分（`bps =6000`），可以拆成 ~20 个 step。**账户数是硬约束**（≤64）。

**本质差异**：EVM 的 split 是 gas-driven，Solana 的 split 是 account-driven。

#### 对比点2：链上 dispatcher 的"账户列表管理"

- **1inch AggregationRouterV5**：单一 `swap()`入口，参数是 `SwapDescription calldata desc` + `bytes permit` + `bytes data`。**链上不关心具体 DEX**，由 `clipperExecutor`、`uniswapV3Executor` 等库 decode。
- **Jupiter jupiter_aggregator_v6**：单一 `route()`入口，参数是 `Route { route_plan: Vec<RoutePlanStep>, accounts: Vec<AccountMeta> }`。**链上必须显式枚举每个 DEX 的 swap variant**（~60+ enum variants）。

**本质差异**：EVM 的 dispatcher靠"通用 calldata + executor delegatecall"，Solana 的 dispatcher靠"enum 分发"。这是因为 Solana CPI 不支持动态调用（每个 program都有明确的 IDL）。

#### 对比点3：失败处理

- **1inch**：`swap()`失败 revert，整个交易回滚。
- **Jupiter**：链上 v6 program 是**单笔交易原子性**——任意一步 CPI失败，所有 AMM状态都回滚。但和 EVM不同的点：Jupiter 的 API 层（`/build`）会主动给你一个 "estimated CU" + "potential failure modes"，前端可以先 simulate。

**本质差异**：Solana 的原子性和 EVM一样强，但**没有 `try/catch` 等中间步骤**——你要么全成功要么全失败，没法在中间 swap失败时只回滚一半。

### 9.3 什么时候选谁？

- **想用 EVM**：选1inch（DEX 多） / UniswapX（限价单 / Dutch auction）。
- **想用 Solana**：选 Jupiter（绝对头部，几乎垄断），不要重新发明轮子。
- **想跨链**：1inch > Jupiter（Solana 没有等价产品）。

---

## 10. 在自己的 Anchor Program 里 CPI Jupiter（实战示例）

### 10.1 为什么要在自己的合约里调 Jupiter？

典型场景：你的 Launchpad / Escrow / Vault合约，需要把收到的 SOL 自动换成 USDC 给用户。

### 10.2 三种方式

#### 方式1：从你的 program调 Jupiter v6（已 archived）

**仓库**：`jup-ag/jupiter-cpi`（**已于2025-11-14 archived**，但 IDL `idl.json`仍可用）

```rust
use jupiter_cpi::{/* generated types */};

let swap_ix = Instruction {
 program_id: jupiter_cpi::ID,
 accounts,
 data: jupiter_override::Route {
 swap_leg,
 in_amount: quote_response.in_amount,
 quoted_out_amount:0,
 slippage_bps:0,
 platform_fee_bps:0,
 }.data(),
};
```

> **官方事实**：jupiter-cpi仓库已 archived。教学时仍可作为参考，但**生产环境建议用方式2 或方式3**。

#### 方式2：手动构造 Route CPI（推荐）

```rust
use anchor_lang::prelude::*;

// 从 Jupiter /quote拿到 routePlan 后，手动序列化
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct Route {
 pub in_amount: u64,
 pub quoted_out_amount: u64,
 pub slippage_bps: u16,
 pub platform_fee_bps: u16,
 pub route_plan: Vec<RoutePlanStep>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RoutePlanStep {
 pub swap: Swap, //60+ variants
 pub percent: u8,
 pub input_index: u8,
 pub output_index: u8,
}

pub fn jupiter_swap(ctx: Context<JupiterSwap>, route_data: Vec<u8>) -> Result<()> {
 // route_data 是从链下 /build拿到的 base64 解码结果
 let ix = Instruction {
 program_id: jupiter_aggregator_v6::ID,
 accounts: ctx.accounts.to_account_metas(None),
 data: route_data,
 };
 // invoke
 solana_program::program::invoke(&ix, &ctx.accounts.to_account_infos())?;
 Ok(())
}
```

**关键约束**：
- `ctx.accounts`必须在编译时**穷举**所有账户（不能用 `remaining_accounts`偷懒）。
- 总账户数 ≤64（**CPI 不能用 ALT**！）。
- 因此 `/build` 必须传 `maxAccounts=30` 左右（留空间给 setup/cleanup）。

#### 方式3：从前端调用，program 只做状态管理

最简单：program 不直接调 Jupiter，让前端用 Jupiter SDK 完成 swap，program 只更新自己的 state。

**EVM 类比**：让前端用1inch swap，合约只更新 storage。

### 10.3 三种方式对比

|方式 |复杂度 | gas成本 | ALT 支持 | 推荐场景 |
|---|---|---|---|---|
|1. jupiter-cpi (archived) | 低 | 中 | ❌ | 学习 / PoC |
|2.手动构造 CPI | 中 | 中 | ❌ | 生产（明确 route） |
|3. 前端调 +链上记账 | 低 | 低 | ✅ |简单业务（Vault / Launchpad） |

---

## 11. 引用来源（带 URL）

> 所有引用均为教学文档撰写时通过 WebFetch / GitHub公开页面查证。

### 11.1 Jupiter官方

- Jupiter主页：<https://jup.ag/>
- Jupiter开发者文档（v2 docs）：<https://developers.jup.ag/docs>
- Jupiter开发者文档（ultra，superseded）：<https://developers.jup.ag/docs/ultra>
- Jupiter docs仓库：<https://github.com/jup-ag/docs>
 - Order & Execute：<https://developers.jup.ag/docs/swap/order-and-execute.md>
 - Swap API V2 index：<https://developers.jup.ag/docs/swap/index.md>
 - Build endpoint：<https://github.com/jup-ag/docs/blob/main/swap/build/index.mdx>
 - Reduce transaction size：<https://github.com/jup-ag/docs/blob/main/swap/advanced/reduce-transaction-size.mdx>
 - Compute units：<https://github.com/jup-ag/docs/blob/main/swap/advanced/compute-units.mdx>
 - Slippage / RTSE：<https://github.com/jup-ag/docs/blob/main/swap/advanced/slippage.mdx>
 - Migration Metis → Build：<https://github.com/jup-ag/docs/blob/main/swap/migration/metis-to-build.mdx>
 - DEX集成要求：<https://github.com/jup-ag/docs/blob/main/swap/routing/dex-integration.mdx>
 - 市场上下架：<https://github.com/jup-ag/docs/blob/main/swap/routing/market-listing.mdx>

### 11.2 Jupiter GitHub仓库

- 组织主页：<https://github.com/jup-ag>
- AMM 实现指南（**核心仓库，含 v6 program id声明**）：<https://github.com/jup-ag/jupiter-amm-implementation>
 - `jupiter-aggregator-v6/src/lib.rs`：<https://github.com/jup-ag/jupiter-amm-implementation/blob/main/jupiter-aggregator-v6/src/lib.rs>
 - `jupiter-core/src/amms/loader.rs`：<https://github.com/jup-ag/jupiter-amm-implementation/blob/main/jupiter-core/src/amms/loader.rs>
 - `jupiter-core/src/amms/amm.rs`：<https://github.com/jup-ag/jupiter-amm-implementation/blob/main/jupiter-core/src/amms/amm.rs>
- Quote API Node.js bindings：<https://github.com/jup-ag/jupiter-quote-api-node>
- Swap API Rust client：<https://github.com/jup-ag/jupiter-swap-api-client>
- CPI crate（**archived 2025-11-14**）：<https://github.com/jup-ag/jupiter-cpi>
- Metis binary：<https://github.com/jup-ag/metis-binary>
- CLI：<https://github.com/jup-ag/cli>

### 11.3 Solana交易约束

- Solana官方文档：<https://solana.com/docs/core/transactions>
- Transaction terminology：<https://docs.solana.com/transaction_confirmation/terminology>

### 11.4 EVM 对照

- 1inch主页：<https://1inch.com/>
- 1inch Pathfinder（产品页）：<https://1inch.com/pathfinder>
- 1inch商业 portal：<https://business.1inch.com/portal/documentation/overview>

---

## 12. 教学抽象 vs官方事实（明确声明）

> 本课在写作过程中，不可避免地做了"简化"。下面是已知简化清单。

### 12.1 教学抽象（简化模型）

|教学表述 |实际情况（教学抽象说明） |
|---|---|
| Jupiter路由 = "前端 → API → on-chain program → AMM" 四层 |实际上 Jupiter 有 Metis binary、Juno、Iris、Beam、JupiterZ 等多个内部微服务。教学时聚焦"外部可观察接口"。 |
| `routePlan.bps` 加起来 =10000 | v1响应里是 `percent`字段；v2两者都有但 `bps` 是 canonical。详见 Migration文档。 |
| `jupiter_aggregator_v6` 是单 program | v6之前有多个 program。v6之后，v6 program id (`JUP6LkbZ...`) 是当前主力的 on-chain entry。 |
| `jupiter-cpi` 是"标准做法" | 该 repo 已 archived 2025-11-14。教学时仍可参考，但生产用方式2 /3更好。 |
| "60+ AMM variants" | 这个数字随时间增长。撰写本文档时 `Swap` enum 有 ~60 个 variants，实际可能更多。 |
| `routePlan`字段名固定 |实际 v1/v2字段名有差异：`percent` vs `bps`、`addressLookupTableAddresses` vs `addressesByLookupTableAddress`。 |

### 12.2 官方事实（验证过）

|事实 | 来源 |
|---|---|
| `jupiter_aggregator_v6` mainnet program id = `JUP6LkbZbjS1jKKwap4HNdet74bE2T1SSPdS6rQdKx` | `jupiter-amm-implementation/jupiter-aggregator-v6/src/lib.rs`（`declare_program!`宏） |
| Solana交易 ≤1232字节 | Solana官方文档 |
| Solana 单笔 ≤64账户 | Solana官方文档 |
| Ultra API 已 superseded by Swap V2 | <https://developers.jup.ag/docs/ultra> |
| Meta-Aggregator路径走 `/swap/v2/order + /swap/v2/execute`，Router路径走 `/swap/v2/build + /tx/v1/submit` | Jupiter docs |
| Jupiter Swap路径有 ~5-20 bps优于纯 on-chain | Jupiter docs |
| `jupiter-cpi`仓库 archived on 2025-11-14 | GitHub仓库页面 |
| V2 Router `/build` 取代 V1 `/quote + /swap-instructions` 的组合路径 | Jupiter docs |

### 12.3 待官方确认 / 可能过时的部分

> **以下内容基于撰写时的公开信息，可能已过期。请以最新官方文档为准。**

- ⚠️ **v6之后是否还有 v7 on-chain program？**截至本文撰写，公开仓库只有 `jupiter_aggregator_v6`。建议读者持续关注 [Jupiter docs changelog](https://github.com/jup-ag/docs/tree/main/changelog)。
- ⚠️ **Jupiter platform fee 5-10 bps 是否准确？**来自 Ultra文档的对比表，但可能随时间调整。
- ⚠️ **CU limit 默认1,400,000？**来自 `/build`文档。建议读者始终用 `simulateTransaction`动态估算。
- ⚠️ **`maxAccounts` <50 会导致"no route found"？**来自官方警告，但具体阈值可能因 DEX列表变化而调整。
- ⚠️ **AMM adapter数量 "60+"**？实际数量会因新 AMM集成而变化。

---

## 13. 课后自测题 / 检查清单

### 13.1 概念理解（10 题）

1. 用一句话解释 Jupiter是什么。
2. Jupiter 的三层架构是哪三层？每层对应 EVM哪个组件？
3. `routePlan.bps =6000` 表示什么？如果一条 route 有3 个 step，每个 step 的 bps 加起来应该是多少？
4. `jupiter_aggregator_v6` 的 mainnet program id是什么？
5. 为什么 Solana 单笔 swap 不能像 EVM那样拆分几十份？
6. `Address Lookup Table` 如何缓解64账户限制？**它的边界是什么**（哪些情况下不能用）？
7. Jupiter 的 Meta-Aggregator路径（`/order`）和 Router路径（`/build`）的核心区别是什么？
8. Jupiter v6之前的版本，Token2022 支持为什么是个问题？v6怎么解决的？
9. `jupiter-cpi`仓库的状态如何？（提示：archived？）
10. Jupiter 的 `metis`引擎、`JupiterZ` RFQ引擎、`Ultra` API 三者的关系是什么？

### 13.2 EVM 对照（5 题）

1. 1inch Pathfinder 和 Jupiter Metis 在"拆单粒度"上的本质差异是什么？
2. 1inch AggregationRouterV5 和 jupiter_aggregator_v6 在"链上 dispatcher架构"上的差异是什么？为什么？
3. UniswapX 的 Dutch auction模式 Jupiter 有对应物吗？
4. 在 EVM，你的合约 `swap(address, address, uint256)`只需要关心什么？Solana 上调 Jupiter 需要关心哪些 EVM 不需要的细节？
5. 1inch 的"链上 dispatcher"靠 executor delegatecall，Jupiter 的"链上 dispatcher"靠什么？

### 13.3 实操检查清单

#### Frontend集成

- [ ] 默认从 `/swap/v2/order` 开始；只有需要插入自定义指令、CPI、memo 或自管落地时才用 `/swap/v2/build`。
- [ ] 调 `/swap/v2/build` 时，传 `taker`、`slippageBps`、必要时传 `maxAccounts`。
- [ ] `/order` 路径签名后交给 `/swap/v2/execute`；`/build` 路径自行组装 v0 transaction 后自发 RPC 或交给 `/tx/v1/submit`。
- [ ] 用 `addressesByLookupTableAddress`构造 `AddressLookupTableAccount[]`。
- [ ] 调 `simulateTransaction`估算 CU，用 `1.2 * simulated_CU` 作 CU limit。
- [ ] 检查 `lastValidBlockHeight`，避免发过期的 tx。
- [ ] 监听 `connection.confirmTransaction`拿到确认结果。

#### Anchor Program CPI Jupiter

- [ ] `program_id` 用 `jupiter_aggregator_v6::ID`，**不要**用 jupiter-cpi（archived）。
- [ ] 提前穷举所有账户，不依赖 `remaining_accounts`。
- [ ] 总账户数 ≤64（CPI 不能用 ALT）。
- [ ] 调用 `/build` 时传 `maxAccounts=30` 左右。
- [ ] 检查返回值 `outAmount >= expected_min_out`。
- [ ] 处理 CPI失败（任何一步失败回滚整笔 tx）。

#### 进阶

- [ ] Token2022兼容性：检查 mint 是否是 `TokenzQd...`，准备 transfer hook账户。
- [ ] 多 hop route：检查 `routePlan`长度，理解每一步的 input/output index。
- [ ] Split route：理解 `bps`字段，避免用户传入"全100%"的假 split。
- [ ] RTSE：理解 `slippageBps=rtse` 的含义。

### 13.4 进阶阅读

- 读完 [Jupiter docs 全套 swap文档](https://github.com/jup-ag/docs/tree/main/swap)
- 通读 [`jupiter-amm-implementation`仓库](https://github.com/jup-ag/jupiter-amm-implementation)至少 `jupiter-aggregator-v6/src/lib.rs` 和 `jupiter-core/src/amms/loader.rs`
- 跑一次 `pnpm dev-quote` + `pnpm dev-swap` 在 testnet跑通端到端 swap
- 把 Jupiter 的 `routePlan`翻译成自己的 TypeScript type，模拟一次报价计算

---

## 14. 一句话总结

> Jupiter 是 **"Solana 上的1inch + UniswapX +0x RFQ" 三合一**，但因为 Solana交易账户列表的硬约束（1232字节 /64账户），路由算法必须把"账户数预算"作为一阶约束显式管理。理解这一点，你就理解了为什么 `maxAccounts` 是 Jupiter独有参数、为什么 CPI 受限、为什么 ALT必不可少。
