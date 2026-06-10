# Lesson 14 - 前端推导 PDA Profile Demo

> 演示前端如何使用 `PublicKey.findProgramAddressSync()` 推导 PDA，对接 Lesson 06 的 profile program。

## 项目结构

```
profile-demo/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── WalletContextProvider.tsx
├── lib/
│   ├── idl/
│   │   └── profile.json
│   └── program.ts
├── next.config.mjs
└── package.json
```

## 功能

| 操作              | 说明                                            |
| ----------------- | ----------------------------------------------- |
| Connect Wallet    | 连接钱包                                          |
| PDA 推导          | seeds = [&quot;profile&quot;, wallet]，前端直接推算  |
| Create Profile    | 调用 createProfile(name, bio) 初始化 PDA         |
| Update Profile    | 调用 updateProfile，需 has_one 验证                |
| Read Profile      | 自动从 PDA 拉取并展示                              |

## 关键演示点

- **页面顶部清晰展示**：Program ID、Seeds、推导出的 PDA、Bump
- **PDA 与 EOA 完全独立**：没有创建账户的"keypair"，只有种子推导
- **同一 wallet → 同一 PDA**：换钱包 → 不同 PDA（多用户彼此独立）

## 技术栈

- Next.js 14 (App Router)
- TypeScript
- @coral-xyz/anchor / @solana/web3.js
- @solana/wallet-adapter-react

## 运行步骤

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 连接本地 validator

1. 启动本地 validator：
   ```bash
   solana-test-validator
   ```
2. 进入 `examples/06-pda-user-profile` 并部署：
   ```bash
   anchor build
   anchor deploy --provider.cluster localnet
   ```
3. Phantom 切换到 Localnet（RPC URL `http://127.0.0.1:8899`）。
4. `solana airdrop 5 <你的地址>` 给钱包打 SOL。

## 配置 program ID 与 IDL

- IDL 文件：`lib/idl/profile.json`（从 `examples/06-pda-user-profile/target/idl/pda_user_profile.json` 复制）
- Program ID：`lib/program.ts` 顶部的 `PROFILE_PROGRAM_ID`

如果你重新部署了 program 拿到新 ID：
- 替换 `lib/program.ts` 里的常量
- 更新 `lib/idl/profile.json` 顶部的 `"address"` 字段（必须一致）

## 验证

```bash
npm run lint    # ✔ 通过
npm run build   # ✔ 通过
```

## 详细文档

参见 [docs.md](./docs.md)。
