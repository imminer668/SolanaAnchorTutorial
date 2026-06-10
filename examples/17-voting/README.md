# Lesson 17 - Voting 投票系统

> 完整 voting program：发起投票、投票（防重复）、关闭投票（仅 authority）。

## 项目结构

```
17-voting/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── programs/
│   └── voting/
│       └── src/lib.rs
└── tests/
    └── voting.ts
```

## 功能

- `create_poll(poll_id, title, options, duration_seconds)`：创建投票
- `vote(option_index)`：投票，**通过 VoteRecord PDA 防重复**
- `close_poll()`：关闭投票（仅 poll authority 可调用）

## 关键设计

- **Poll Account** 用 PDA：`seeds = [b"poll", authority, poll_id]`
  - 同一 authority + 同一 poll_id → 一个 poll
- **VoteRecord PDA**：`seeds = [b"vote", poll, voter]`
  - 一个 voter 对一个 poll 只能创建一个 VoteRecord
  - 二次投票时 init 失败，等同 EVM 的 `mapping(address => bool) voted`
- **events**：PollCreated / Voted / PollClosed，便于前端订阅
- **safety**：投票时检查 closed + end_time + option_index；close_poll 用 `has_one = authority`

## 测试

```bash
yarn install
anchor build
anchor test
```

通过：7 tests passing

## Program ID

```
8fFPXFbvCXgKPoPuXMG4aukWuGVEDQQKiD4drUUYg8ND
```

## 详细文档

参见 [docs.md](./docs.md)。
