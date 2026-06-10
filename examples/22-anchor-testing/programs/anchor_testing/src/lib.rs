use anchor_lang::prelude::*;

declare_id!("DMByVmZtaddfMBcQEJNyG3Yf1Ge46nUrjLMdA6kaCTME");

#[program]
pub mod anchor_testing {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = 0;
        counter.bump = ctx.bumps.counter;

        emit!(CounterInitialized {
            counter: counter.key(),
            authority: counter.authority,
        });
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_add(1).ok_or(ErrorCode::Overflow)?;
        emit!(CounterChanged { count: counter.count, kind: "increment".to_string() });
        Ok(())
    }

    pub fn decrement(ctx: Context<Decrement>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = counter.count.checked_sub(1).ok_or(ErrorCode::Underflow)?;
        emit!(CounterChanged { count: counter.count, kind: "decrement".to_string() });
        Ok(())
    }

    pub fn set_value(ctx: Context<SetValue>, value: u64) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count = value;
        emit!(CounterChanged { count: counter.count, kind: "set".to_string() });
        Ok(())
    }

    pub fn close_counter(ctx: Context<CloseCounter>) -> Result<()> {
        emit!(CounterClosed { counter: ctx.accounts.counter.key() });
        Ok(())
    }
}

#[account]
pub struct Counter {
    pub authority: Pubkey, // 32
    pub count: u64,        // 8
    pub bump: u8,          // 1
}

impl Counter {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = Counter::SIZE,
        seeds = [b"counter", authority.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(
        mut,
        seeds = [b"counter", counter.authority.as_ref()],
        bump = counter.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Decrement<'info> {
    #[account(
        mut,
        seeds = [b"counter", counter.authority.as_ref()],
        bump = counter.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetValue<'info> {
    #[account(
        mut,
        seeds = [b"counter", counter.authority.as_ref()],
        bump = counter.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub counter: Account<'info, Counter>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseCounter<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"counter", counter.authority.as_ref()],
        bump = counter.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[event]
pub struct CounterInitialized {
    pub counter: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct CounterChanged {
    pub count: u64,
    pub kind: String,
}

#[event]
pub struct CounterClosed {
    pub counter: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Caller is not counter authority")]
    NotAuthority,
    #[msg("Counter underflow (count is already 0)")]
    Underflow,
    #[msg("Counter overflow (count is u64::MAX)")]
    Overflow,
}
