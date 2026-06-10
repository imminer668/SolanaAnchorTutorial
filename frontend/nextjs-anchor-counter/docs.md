# Lesson 13 - Next.js + Anchor 文档

> 面向 EVM 开发者：把链上 Anchor 程序接入前端的最小可用模式。

## 1. EVM 前端 vs Solana 前端

### EVM 思维

```typescript
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const contract = new ethers.Contract(address, abi, signer);
await contract.increment();
```

- `window.ethereum` 是 EIP-1193 标准，所有钱包都提供同一接口
- ABI 由 Solidity 编译产物给出
- 一行 `contract.increment()` 就完成签名 + 广播

### Solana 思维

```typescript
const wallet = useAnchorWallet();                       // 钱包 adapter
const provider = new AnchorProvider(connection, wallet); // 包装连接 + 钱包
const program = new Program(idl, provider);              // 用 IDL 实例化 Program
await program.methods.increment().accounts({...}).rpc();
```

- 钱包标准是 **Wallet Adapter**（Solana 自己的抽象）
- 程序入口是 **IDL**（类似 ABI，但描述 instruction 不是 method）
- 调用需要**显式声明账户列表**（EVM 由合约存储自动推断）

## 2. Wallet Adapter 架构

```text
ConnectionProvider     ← 提供 connection 实例
    └── WalletProvider ← 注入可用钱包列表
        └── WalletModalProvider ← UI：连接弹窗
            └── 你的页面
```

| Provider              | 提供的 hook        | 作用                          |
| --------------------- | ------------------ | ----------------------------- |
| ConnectionProvider    | useConnection()    | 拿 RPC connection             |
| WalletProvider        | useWallet()        | 当前钱包状态                  |
| 同上                  | useAnchorWallet()  | 返回 AnchorProvider 兼容的 wallet |
| WalletModalProvider   | useWalletModal()   | 控制连接弹窗显示              |

## 3. IDL 的角色

```typescript
import counterIdl from "./idl/counter.json";

const program = new Program(counterIdl as Idl, provider);
```

IDL 描述了：
- 程序 ID
- 所有 instruction 的名字、参数、账户列表
- 所有 account 的字段类型
- 自定义 error 的 code 和 msg

Anchor 在编译时产出 `target/idl/counter.json` 和 `target/types/counter.ts`，前者用于运行时，后者用于 TS 类型推断。

## 4. 我们的最小调用流程

### 4.1 创建 counter 账户

```typescript
const newCounter = Keypair.generate();
await program.methods
  .initialize()
  .accounts({
    counter: newCounter.publicKey,
    user: publicKey,            // 自动注入 SystemProgram
  })
  .signers([newCounter])         // counter keypair 必须签名（init 需要）
  .rpc();
```

**为什么 counter 需要 signers**：`#[account(init, payer = user, space = ...)]` 内部 CPI 调 SystemProgram.createAccount，被 init 的账户必须是签名者。

### 4.2 读 counter

```typescript
const account = await (program.account as any).counter.fetch(pk);
console.log(account.count.toString()); // BN -> string
```

**注意**：Anchor 0.31 的 program.account 在某些场景没有完美类型，用 `as any` 绕过 generic 推断。

### 4.3 increment

```typescript
await program.methods
  .increment()
  .accounts({
    counter: counterPubkey,
    authority: publicKey,        // 必须等于 counter.authority
  })
  .rpc();
```

## 5. 状态管理模式

我们的页面用 4 个 state：

```typescript
const [counterPubkey, setCounterPubkey] = useState<PublicKey | null>(null);
const [count, setCount] = useState<string>("-");
const [status, setStatus] = useState<Status>({ kind: "idle" });
```

`Status` 是个 discriminated union：

```typescript
type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string; signature?: string }
  | { kind: "error"; message: string };
```

这样 UI 永远只展示一个明确状态，避免 EVM 项目里常见的 `isLoading + error + success` 三个 bool 互相矛盾。

## 6. 容易踩的坑

### 6.1 SSR 与 wallet adapter

wallet adapter 用浏览器 API（localStorage、window.ethereum 风格的注入），在 SSR 会爆。所有用 useWallet/useConnection 的组件必须 `"use client"`。

### 6.2 React 18/19 类型冲突

wallet adapter 的依赖链拉进了 `react-native`，间接装 `@types/react@19`，和 Next.js 14 默认的 React 18 类型冲突。

修复：`package.json` 加 overrides 强制版本。

```json
"overrides": {
  "@types/react": "^18.3.3",
  "@types/react-dom": "^18.3.0"
}
```

### 6.3 connection endpoint 切换

不要在组件里 useState 存 endpoint。`ConnectionProvider` 重渲染时 endpoint 改变会导致整棵子树重建（钱包断开）。

我们的做法：endpoint 从环境变量读，构建时确定。

### 6.4 BN 不是 number

链上 u64 在 JS 端是 `BN`（big.js）实例。直接 `console.log(count)` 输出对象。要用 `count.toString()` 或 `count.toNumber()`（注意 u64 可能溢出 number 范围）。

## 7. 与 EVM 工程的真实差异

| 维度             | EVM/ethers                  | Solana/anchor                       |
| ---------------- | --------------------------- | ----------------------------------- |
| 钱包连接         | window.ethereum             | Wallet Adapter（多 provider）         |
| ABI / IDL        | ABI（JSON 数组）              | IDL（JSON 对象，含 account 描述）     |
| 调用             | contract.method(args)        | program.methods.foo(args).accounts({...}).rpc() |
| 账户             | 由合约内部存储                | 客户端**显式传**                       |
| 读链上数据       | contract.view()              | program.account.foo.fetch(pubkey)    |
| 类型             | ABI 推导                     | IDL TypeScript 类型                  |
| 签名/广播        | provider.send()              | provider.sendAndConfirm() / .rpc()    |
| Gas              | gas estimate + gas price     | compute units + lamports per signature |

## 8. 课后检查清单

- [ ] 我能解释 Wallet Adapter 的 Provider 层级结构。
- [ ] 我能用 IDL 实例化一个 Program 并调用 method。
- [ ] 我能解释为什么 init 的账户需要 signer。
- [ ] 我能识别 SSR 报错的钱包代码位置并加 "use client"。
- [ ] 我能处理 BN 与 string/number 的转换。
- [ ] 我能在不修改组件代码的前提下切换 endpoint（dev/devnet/mainnet）。

## 9. 下一步

- Lesson 14：前端推导 PDA（无需 keypair）
- Lesson 15：前端调用 SPL Token（与 ERC20 思维差异）
