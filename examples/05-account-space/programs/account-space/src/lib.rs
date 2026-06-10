use anchor_lang::prelude::*;

declare_id!("2Sc7psRKbd5iNCQ7a5g6rjN8a8QyKXvPSXEP6KjVURoZ");

/// 字符串最大长度
pub const MAX_LABEL_LEN: usize = 50;

/// 反例：用于演示 "如果预留空间不足" 时的扩容成本
/// Vec<u32> 容量 = 16 个 u32 = 64 bytes，再加上 4 bytes 长度前缀
pub const MAX_SCORES: usize = 16;

/// Counter 账户：演示 Account Space 手动计算
///
/// ```text
/// 8  bytes  - Anchor discriminator
/// 32 bytes  - authority: Pubkey
/// 8  bytes  - count: u64
/// 4 + N     - label: String   (4 字节长度前缀 + N 字节 UTF-8)
/// 4 + 64    - scores: Vec<u32> (4 字节长度前缀 + MAX_SCORES * 4 字节)
/// 1  byte   - bump: u8
/// ```
#[account]
pub struct Counter {
    pub authority: Pubkey,
    pub count: u64,
    pub label: String,
    pub scores: Vec<u32>,
    pub bump: u8,
}

impl Counter {
    /// 账户总空间 = discriminator + 各字段
    pub const SIZE: usize = 8 + 32 + 8 + (4 + MAX_LABEL_LEN) + (4 + MAX_SCORES * 4) + 1;
    // = 8 + 32 + 8 + 54 + 68 + 1 = 171 bytes
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the authority can perform this action")]
    Unauthorized,
    #[msg("Label exceeds MAX_LABEL_LEN")]
    LabelTooLong,
    #[msg("Count would underflow")]
    Underflow,
    #[msg("Scores vector is full")]
    ScoresFull,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = user,
        space = Counter::SIZE,
        seeds = [b"counter", user.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ModifyCounter<'info> {
    #[account(
        mut,
        seeds = [b"counter", counter.authority.as_ref()],
        bump = counter.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[program]
pub mod account_space {
    use super::*;

    /// 初始化 counter 并设置 label
    pub fn initialize(ctx: Context<Initialize>, label: String) -> Result<()> {
        // 运行时再校验一次长度，规避有人修改 IDL 绕过类型检查
        require!(label.len() <= MAX_LABEL_LEN, ErrorCode::LabelTooLong);

        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.user.key();
        counter.count = 0;
        counter.label = label;
        counter.scores = Vec::new();
        counter.bump = ctx.bumps.counter;
        msg!("Counter initialized with label");
        Ok(())
    }

    pub fn increment(ctx: Context<ModifyCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).unwrap();
        Ok(())
    }

    pub fn decrement(ctx: Context<ModifyCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_sub(1)
            .ok_or(error!(ErrorCode::Underflow))?;
        Ok(())
    }

    pub fn reset(ctx: Context<ModifyCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        counter.scores.clear();
        Ok(())
    }

    pub fn update_label(ctx: Context<ModifyCounter>, label: String) -> Result<()> {
        require!(label.len() <= MAX_LABEL_LEN, ErrorCode::LabelTooLong);
        ctx.accounts.counter.label = label;
        Ok(())
    }

    pub fn push_score(ctx: Context<ModifyCounter>, score: u32) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        require!(
            counter.scores.len() < MAX_SCORES,
            ErrorCode::ScoresFull
        );
        counter.scores.push(score);
        Ok(())
    }
}
