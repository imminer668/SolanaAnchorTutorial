# Lesson 06 - PDA User Profile

> 用 PDA 实现 EVM 中 `mapping(address => Profile)` 的等价物

## 项目结构

```
06-pda-user-profile/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── pda-user-profile/
│       ├── Cargo.toml
│       ├── Xargo.toml
│       └── src/
│           └── lib.rs
└── tests/
    └── pda-user-profile.ts
```

## 功能

- `create_profile(name, bio)`：首次创建
- `update_profile(name, bio)`：更新已有
- `close_profile()`：关闭并退还 rent

## PDA 设计

```rust
seeds = [b"profile", user.key().as_ref()]
```

- `b"profile"`：命名空间，避免与同 program 的其他 PDA 冲突
- `user.key()`：每个用户独立推导

## 对应 EVM

```solidity
mapping(address => Profile) public profiles;
struct Profile { string name; string bio; }
```

## 运行步骤

```bash
yarn install
anchor build
anchor test
```

## Program ID

```
B9LbcgwyuVSM2dMvhN4Mu1d6zLoUncwHpVLzwVNDCMsy
```

## 详细文档

参见 [docs.md](./docs.md)
