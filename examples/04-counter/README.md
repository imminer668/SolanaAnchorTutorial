# Lesson 04 - Counter

> 第一个 Anchor Program：用最小示例展示 Account、Signer、authority 校验、错误码。

## 项目结构

```
04-counter/
├── Anchor.toml              # Anchor 配置文件
├── Cargo.toml               # Workspace 配置
├── package.json             # JS 依赖与脚本
├── tsconfig.json            # TS 测试配置
├── programs/
│   └── counter/
│       ├── Cargo.toml
│       ├── Xargo.toml
│       └── src/
│           └── lib.rs       # Counter Program
└── tests/
    └── counter.ts           # TS 测试
```

## 功能

- `initialize`：创建 counter 账户，把调用方设为 authority
- `increment`：count += 1
- `decrement`：count -= 1（下溢时报错）
- `reset`：count = 0

## 环境要求

- Rust 1.86+
- Anchor CLI 0.31.1
- Solana CLI 2.1+
- Node.js v20+
- Yarn 或 npm

## 运行步骤

### 1. 安装依赖

```bash
yarn install
# 或
npm install
```

### 2. 编译 Program

```bash
anchor build
```

### 3. 启动本地 validator

另开一个终端：

```bash
solana-test-validator
```

### 4. 运行测试

```bash
anchor test
```

测试覆盖：

1. ✅ initialize 成功
2. ✅ increment 成功
3. ✅ decrement 成功
4. ✅ reset 成功
5. ✅ 非 authority 调用失败
6. ✅ count 为 0 时 decrement 失败

## Program ID

```
4ZBoKY6WTDBTKbRZuqnWALwCBMr54Zitq3pVdTckziby
```

可通过 `anchor keys list` 查看或重新生成。

## 详细文档

参见 [docs.md](./docs.md)。
