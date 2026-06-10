use anchor_lang::prelude::*;

declare_id!("5uuUBcU6BRQ5Z2BhM1giJd7uzJD8ecD6KKmfo2sdPB54");

/// Token2022 演示项目
///
/// 核心逻辑（创建 mint、设置 transfer fee、burn）通过 TypeScript + spl-token-2022 完成。
/// 这里的 program 只提供一个 `record_burn` 指令，演示一个 program 如何"记录" permanent
/// delegate 行为。
#[program]
pub mod token2022_demo {
    use super::*;

    /// 由 permanent delegate 调用，记录一次 burn 事件。
    /// 实际场景中可以把 burn 数量、原因等上链留痕。
    pub fn record_burn(ctx: Context<RecordBurn>, amount: u64) -> Result<()> {
        msg!(
            "Burn recorded: amount={}, by={}",
            amount,
            ctx.accounts.delegate.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RecordBurn<'info> {
    /// CHECK: 这是 mint 账户，本指令只读
    pub mint: AccountInfo<'info>,

    /// 任何 signer 都可以调用；真实项目里要做权限校验
    pub delegate: Signer<'info>,
}
