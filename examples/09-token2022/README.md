# Lesson 09 - Token2022

> Token2022 = Token Program + Extensions。本课演示 Transfer Fee、Permanent Delegate、Metadata Pointer 三个扩展。

## 项目结构

```
09-token2022/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── token2022/
│       └── src/lib.rs
└── tests/
    └── token2022.ts
```

## 功能

- 创建一个 Token2022 mint，配置：
  - **Transfer Fee**: 1%（100 basis points）
  - **Permanent Delegate**: 可以从任何 holder 账户 burn/transfer
  - **Metadata Pointer**: 指向链下 metadata 账户
- mint 1000 token 给 source ATA
- 转移 1000 token，验证 fee = 10 token 自动扣留
- 用 permanent delegate 身份 burn 100 token
- 用非 delegate 身份 burn，预期失败
- 调用本 program 的 `record_burn` 指令

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
5uuUBcU6BRQ5Z2BhM1giJd7uzJD8ecD6KKmfo2sdPB54
```

## 详细文档

参见 [docs.md](./docs.md)
