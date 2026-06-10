# Lesson 05 - Account、Space 与 Discriminator

> 演示 Solana 账户的字节布局：为什么需要提前分配空间，每个字段占用多少字节。

## 项目结构

```
05-account-space/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── account-space/
│       └── src/lib.rs
└── tests/
    └── account-space.ts
```

## 字段字节布局

| 字段         | 类型      | 字节数                |
| ------------ | --------- | --------------------- |
| discriminator | [u8; 8]  | 8                     |
| authority    | Pubkey    | 32                    |
| count        | u64       | 8                     |
| label        | String    | 4 + len (最长 50)     |
| scores       | Vec<u32>  | 4 + N × 4 (最多 16 个)|
| bump         | u8        | 1                     |

总空间 = 8 + 32 + 8 + 54 + 68 + 1 = **171 bytes**

## 功能

- `initialize(label)`：创建 counter 并设置 label
- `increment()` / `decrement()` / `reset()`：修改 count
- `update_label(label)`：在限制长度内更新 label
- `push_score(score)`：往 scores 追加，超出 MAX_SCORES 失败

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
2Sc7psRKbd5iNCQ7a5g6rjN8a8QyKXvPSXEP6KjVURoZ
```

## 详细文档

参见 [docs.md](./docs.md)
