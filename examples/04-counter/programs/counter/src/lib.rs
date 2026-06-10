use anchor_lang::prelude::*;

declare_id!("4ZBoKY6WTDBTKbRZuqnWALwCBMr54Zitq3pVdTckziby");

/// Counter Account：保存调用方与计数值
///
/// 字段说明：
/// - discriminator (8 bytes) - Anchor 自动添加
/// - authority (32 bytes) - 拥有此 counter 的地址
/// - count (8 bytes) - 计数值
#[account]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
}

impl Counter {
    /// Account 总大小：8 (discriminator) + 32 (Pubkey) + 8 (u64) = 48 bytes
    pub const SIZE: usize = 8 + 32 + 8;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Counter is already initialized")]
    AlreadyInitialized,
    #[msg("Counter cannot be decremented below zero")]
    Underflow,
    #[msg("Only the authority can perform this action")]
    Unauthorized,
}

/// 初始化：创建 counter account 并把 authority 设为调用方
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = user,
        space = Counter::SIZE,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 增加计数
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

/// 减少计数
#[derive(Accounts)]
pub struct Decrement<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

/// 重置计数为 0
#[derive(Accounts)]
pub struct Reset<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.user.key();
        counter.count = 0;
        msg!("Counter initialized by {}", counter.authority);
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(error!(ErrorCode::Underflow))?;
        msg!("Counter incremented to {}", counter.count);
        Ok(())
    }

    pub fn decrement(ctx: Context<Decrement>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_sub(1)
            .ok_or(error!(ErrorCode::Underflow))?;
        msg!("Counter decremented to {}", counter.count);
        Ok(())
    }

    pub fn reset(ctx: Context<Reset>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        msg!("Counter reset to 0 by {}", counter.authority);
        Ok(())
    }
}
