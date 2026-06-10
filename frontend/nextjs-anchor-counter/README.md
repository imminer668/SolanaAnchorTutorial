# Lesson 13 - Next.js + Anchor Counter

> 把 Lesson 04 的 Counter 程序接入前端：Connect Wallet → Initialize → Read → Increment。

## 项目结构

```
nextjs-anchor-counter/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── WalletContextProvider.tsx
├── lib/
│   ├── idl/
│   │   ├── counter.json
│   │   └── counter.ts
│   └── program.ts
├── next.config.mjs
├── tsconfig.json
└── package.json
```

## 功能

| 操作              | 说明                                          |
| ----------------- | --------------------------------------------- |
| Connect Wallet    | 用 Solana wallet adapter 连接 Phantom/Solflare |
| Initialize        | 生成新 counter keypair 并发送 initialize 指令    |
| Increment         | 调用 program.methods.increment().rpc()        |
| Refresh           | 重新拉取 counter 账户数据                       |

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- @coral-xyz/anchor
- @solana/web3.js
- @solana/wallet-adapter-react / -react-ui / -wallets

## 运行步骤

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 连接本地 validator

1. 启动 validator：
   ```bash
   solana-test-validator
   ```
2. 在 `examples/04-counter/` 部署 Counter program：
   ```bash
   anchor build
   anchor deploy --provider.cluster localnet
   ```
3. Phantom 钱包切换到 **Localnet**，URL 设置为 `http://127.0.0.1:8899`。
4. 用 `solana airdrop 5 <你的地址>` 给钱包打点 SOL。
5. 默认环境变量已指向 `http://127.0.0.1:8899`，无需修改。

## 连接 devnet

```bash
NEXT_PUBLIC_NETWORK=devnet npm run dev
```

Phantom 切换到 Devnet，前端会自动连接 `https://api.devnet.solana.com`。

## 验证

```bash
npm run lint    # 应该通过
npm run build   # 应该输出生产构建
```

构建产物：

- 单页路由 `/`
- First Load JS ≈ 219 kB

## Program ID

```
4ZBoKY6WTDBTKbRZuqnWALwCBMr54Zitq3pVdTckziby
```

（与 Lesson 04 的 Counter 程序一致）

## 详细文档

参见 [docs.md](./docs.md)。
