# Lesson 15 - 前端调用 SPL Token

> 用 web3.js + @solana/spl-token 完成 Read Balance / Create ATA / Transfer 的最小前端。

## 项目结构

```
spl-token-demo/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── WalletContextProvider.tsx
├── next.config.mjs
└── package.json
```

## 功能

| 操作            | 说明                                             |
| --------------- | ------------------------------------------------ |
| Read Balance    | 输入 mint + owner，查 ATA 是否存在 + 余额          |
| Create ATA      | ATA 不存在时一键创建                              |
| Transfer Token  | 把当前钱包的 token 转给目标地址（自动建对方 ATA）   |

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- @solana/spl-token
- @solana/web3.js
- @solana/wallet-adapter-react

## 运行步骤

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## Devnet 测试

1. Phantom 切换到 Devnet。
2. 获取 devnet SOL：
   ```bash
   solana airdrop 2 <你的地址> --url devnet
   ```
3. 创建一个测试 mint（命令行）：
   ```bash
   solana config set --url devnet
   spl-token create-token --decimals 6
   # 复制返回的 mint address
   spl-token create-account <MINT>
   spl-token mint <MINT> 1000
   ```
4. 在 Demo 里：
   - **Mint address** 填刚创建的 mint
   - **Owner address** 默认填了你的钱包
   - 点 **Read Balance**，应该显示 1000

### 用主网 USDC 试读（只读）

```
Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
Owner: 你的主网钱包
```

> 需要前端连主网：`NEXT_PUBLIC_NETWORK=mainnet-beta npm run dev`

## 验证

```bash
npm run lint    # ✔ 通过
npm run build   # ✔ 通过
```

## 详细文档

参见 [docs.md](./docs.md)。
