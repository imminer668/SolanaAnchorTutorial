# Lesson 23: 错误码与事件

本课展示 Anchor 中最常用的两类可观测输出：

- `#[error_code]`：定义业务错误码，让客户端可以按 code 断言失败原因。
- `#[event]` + `emit!`：把关键状态变化写入交易日志，便于测试、索引器或后端服务读取。

## 项目结构

```text
examples/23-errors-events/
  Anchor.toml
  programs/errors_events/src/lib.rs
  tests/errors-events.ts
  README.md
  docs.md
```

## 指令

- `initialize`：初始化一个 `Board` PDA。
- `record_value`：写入 1 到 100 的数值，成功时发出 `ValueRecorded` 事件。

## 测试覆盖

- 成功写入并读取账户。
- 解码 `emit!` 写入的 Anchor event 日志。
- 断言 `InvalidValue`、`ValueTooLarge`、`Unauthorized` 三类自定义错误。

## 验证命令

```bash
anchor build
anchor test
npm run lint
```
