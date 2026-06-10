# Anchor 空白项目模板说明

该模板只保留 Anchor 项目的最小公共结构：

- `Anchor.toml`：localnet、wallet、test script、program id 配置。
- `Cargo.toml`：workspace 与 release 配置。
- `programs/blank_anchor/src/lib.rs`：最小 `#[program]` 模块。
- `tests/blank-anchor.ts`：最小 TS 冒烟测试。
- `package.json`、`tsconfig.json`：与课程示例保持一致的测试与格式化配置。

后续 Lesson 复制该目录后，应先替换名称和 program id，再增加课程需要的账户、指令、错误码、事件与测试。
