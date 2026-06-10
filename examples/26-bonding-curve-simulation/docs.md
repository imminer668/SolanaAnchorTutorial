# Lesson 26 — 架构拆解 & EVM 对照

> 目标读者：有 Solidity / Foundry 经验，正在迁移到 Solana Anchor 的工程师。
> 教学目标：用最少的代码讲清"bonding curve 的数学结构"和"liquidity migration 的状态机"。

---

## 1. 教学模型与真实 Pump.fun 的差异

| 维度 | 真实 Pump.fun（v1 公开文档） | 本模拟 |
| --- | --- | --- |
| 公式 | virtual reserve + constant product (x\*y=k) | **沿用** |
| 初始虚拟储备 | 30 SOL / 1.073B token | **沿用**（可配置） |
| 迁移阈值 | ~85 SOL | 沿用（可配置） |
| 协议费 / 平台抽成 | 有，按比例分配给 creator / protocol | 省略 |
| SPL Token 铸造 | 链上用 token program / Token-2022 创建 mint | 内存计数模拟 |
| 账户模型 | bonding_curve PDA + vault PDA + token mint + creator ATA | 单一 `BondingCurveState` 对象 |
| 签名校验 / 权限 | 必须 signer、必须 PDA 派生 | 全部省略 |
| 错误处理 | Anchor `error!!` + 自定义错误码 | throw `Error` |
| 事件 | `emit!` 上链 | console.log |
| 计算精度 | 整数 / 定点（避免浮点漂移） | 浮点（教学用） |

> 简化原则：**不模拟链上执行环境的复杂度，只模拟数学与状态机。**
> 一旦读者理解本文件中的 `buy/sell/migrate` 在干什么，回头读 Pump.fun 的 `programs/pump/src/lib.rs` 时，能立刻定位到对应的 `curve.rs` 计算模块。

---

## 2. 账户模型（若放上链，应有哪些账户）

本模拟只有一个 `BondingCurveState`。真实 Anchor 程序里，至少需要：

```
- mint:          SPL Token Mint PDA                // token-2022 可由 create_mint 创建
- bonding_curve: PDA 账户                          // 状态（virtualSol、virtualToken、complete 等）
- vault:         PDA SOL 账户                      // 持有用户投入的真实 SOL
- token_vault:   PDA SPL Token 账户（ATA 形式）    // 持有曲线侧 token
- creator:       钱包（仅签名用）                   // 初始化时付费 + 拿 creator 分成
- user:          钱包（仅签名用）                   // 发起 buy/sell
```

调用关系：

```
buy(solAmount):
  user --SOL--> vault (system_program::transfer)
  bonding_curve --CPI: mint_to--> user.token_account
  state: virtualSol += solAmount; virtualToken -= tokensOut

sell(tokenAmount):
  user --tokens--> token_vault (spl_token::transfer)
  bonding_curve --SOL--> user (PDA signer seed)
  state: virtualToken += tokenAmount; virtualSol -= solOut

migrate():
  vault --SOL--> raydium_amm (CPI)
  token_vault --tokens--> raydium_amm (CPI)
  raydium_amm.mint_lp -> burn (锁死流动性)
  state.complete = true
```

教学要点（对比 EVM）：
- EVM 里这些逻辑全在 **一个合约** 的 storage 里；
- Solana 强制把"状态 / 金库 / mint"拆成 **多个独立账户**，由程序按需读写。
- "PDA 签名 + CPI" 是 EVM 没有的原生模式：vault 持有 SOL，但要由 program PDA 签名才能转出。

---

## 3. EVM Bonding Curve 合约对照

### 3.1 Uniswap V2 Pair（恒定乘积）

```solidity
// 简化伪代码
function swap(uint amount0Out, uint amount1Out, address to) external {
    require(amount0Out > 0 || amount1Out > 0);
    (uint112 _reserve0, uint112 _reserve1,) = getReserves();
    uint amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
    require(amount0In * 1000 <= amount0In * 3, "UniswapV2: K"); // 0.3% fee
    ...
    _update(_balance0, _balance1, _reserve0, _reserve1);
}
```

- `k = reserve0 * reserve1` 守恒；
- **没有"virtual reserve"概念** —— 所有 reserve 都是真金白银；
- 没有"迁移"动作 —— 池子可以永久存在。

本模拟与 Uniswap V2 的**核心数学一致**，差异在于：Pump.fun 用虚拟储备"造"出初始价格，且有迁移终点。

### 3.2 Curve StableSwap

```solidity
// StableSwap: x^3*y + y^3*x = k
```

- 适合稳定币 / 锚定资产的低滑点交易；
- 与本模拟无关，但概念上都是"按曲线定价"。

### 3.3 Balancer Weighted Pool

```solidity
// V = ∏(balance_i ^ weight_i)
```

- 多资产、加权；
- Pump.fun 的虚拟储备思想更接近 Balancer（"协议先注入占位资金"），但 Balancer 没有迁移终点。

### 3.4 Bonding Curve 教学合约（EVM 经典示例）

```solidity
contract SimpleBondingCurve {
    uint public constant VIRTUAL_SOL = 30 ether;
    uint public constant VIRTUAL_TOKEN = 1_073_000_000e18;

    function buy(uint solIn) external payable returns (uint tokensOut) {
        require(msg.value == solIn);
        uint k = VIRTUAL_SOL * VIRTUAL_TOKEN;
        uint newVirtualSol = VIRTUAL_SOL + solIn;
        uint newVirtualToken = k / newVirtualSol;
        tokensOut = VIRTUAL_TOKEN - newVirtualToken;
        // 真实实现里要 mint token 给买家
    }
}
```

这几乎就是 `src/curve.ts` 的 Solidity 翻译。**公式层面 EVM/Solana 无差异**，差异在账户结构和执行模型。

---

## 4. Liquidity Migration 概念

### 4.1 为什么要迁移？

Bonding curve 的"无限"价格曲线在低价区效率高（早期买入便宜），但在高价位滑点极大、对大户不友好。Pump.fun 的解决方案：

1. **v1 阶段**：所有交易走 bonding curve，virtual reserve + constant product；
2. **触发**：当真实 SOL 累计达到 ~85 SOL，`complete = true`；
3. **迁移**：把 bonding curve 里的 SOL + token 一次性注入 Raydium AMM，建一个普通 LP；
4. **v2 阶段**：所有后续交易走 Raydium，享受更深的流动性与更低滑点。

### 4.2 教学上的状态机

```
       buy          sell          buy ...
[INIT] -----> [ACTIVE] -----> [ACTIVE] -----> ...
                  |
                  | realSolReserves >= threshold
                  v
              [MIGRATED]  (buy/sell 抛错；流动性已在 Raydium)
```

### 4.3 本模拟中的 `migrate()`

```typescript
export function migrate(state, threshold) {
  if (state.complete) return false;
  if (!isMigratable(state, threshold)) {
    throw new Error("not yet migratable");
  }
  state.complete = true;
  return true;
}
```

真实链上对应：

```rust
// 简化伪代码
pub fn migrate(ctx: Context<Migrate>) -> Result<()> {
    require!(ctx.accounts.bonding_curve.complete == false);
    require!(ctx.accounts.bonding_curve.real_sol_reserves >= THRESHOLD);

    // 1. 把 vault 里的 SOL 转给 Raydium
    // 2. 把 token_vault 里的 token 转给 Raydium
    // 3. 调 Raydium 的 initialize / add_liquidity
    // 4. burn 掉 LP
    // 5. 翻 complete
    ctx.accounts.bonding_curve.complete = true;
    Ok(())
}
```

---

## 5. 风险声明

- **本仓库代码是教学模拟，不构成任何投资建议。**
- **不要把 `src/curve.ts` 的公式直接搬到生产协议**：缺少手续费、缺少精度处理、缺少边界检查、缺少迁移的真正 CPI。
- **不要在未审计的情况下基于本模型发币或上线合约**：本文件省略了 anti-rug、creator 权限回收、紧急暂停等关键安全机制。
- Pump.fun 上 99% 的 meme 币最终归零 —— bonding curve 不改变这一点，只是把"交易"与"建池"合并到一个原子流程里。
- 本模拟不构成对 Pump.fun 官方协议、Pump.fun 公司、Raydium 协议或任何相关方的推荐或背书。

---

## 6. 进一步阅读

- [Pump.fun 公开文档](https://pump.fun)（实时交易规则可能与本模拟不同）
- [Uniswap V2 Whitepaper](https://uniswap.org/whitepaper.pdf) — 恒定乘积的原始推导
- Solana 官方文档：[Account Model](https://solana.com/docs/core/accounts) / [PDA](https://solana.com/docs/core/pda)
- 本教程 Lesson 21: `docs/21-anchor-security.md` — 真实链上 Anchor 程序的安全模式
- 本教程 Lesson 27: `examples/27-simple-perp-model/` — 同系列的另一个教学简化模型
