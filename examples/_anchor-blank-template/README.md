# Anchor 空白基础项目模板

这个目录用于后续 Anchor 课程快速复制，不作为正式 Lesson 验收项目。

## 复制步骤

1. 复制目录到新的 Lesson 目录。
2. 替换 `blank_anchor`、`blankAnchor`、`BlankAnchor` 为新项目名称。
3. 生成新的 program keypair，并同步 `declare_id!` 与 `Anchor.toml`。
4. 在 `programs/<name>/src/lib.rs` 中实现课程业务。
5. 在 `tests/` 中补齐成功路径、失败路径和错误码断言。

## 常用命令

```bash
anchor build
anchor test
npm run lint
```
