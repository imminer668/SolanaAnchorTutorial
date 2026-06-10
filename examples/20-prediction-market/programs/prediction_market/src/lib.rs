use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Dz6GHpezahf3zoHwdBqpaGNNuRwqx15K1hoyvSm2Zmfz");

#[program]
pub mod prediction_market {
    use super::*;

    /// 创建二元市场：authority 创建 Market + vault
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        question: String,
        end_time: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(end_time > now, ErrorCode::InvalidTime);
        require!(question.len() <= MAX_QUESTION_LEN, ErrorCode::QuestionTooLong);

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.market_id = market_id;
        market.quote_mint = ctx.accounts.quote_mint.key();
        market.vault = ctx.accounts.vault.key();
        market.question = question;
        market.end_time = end_time;
        market.total_a = 0;
        market.total_b = 0;
        market.resolved = false;
        market.winning_outcome = 0; // 0 = unresolved, 1 = OutcomeA, 2 = OutcomeB
        market.bump = ctx.bumps.market;

        emit!(MarketCreated {
            market: market.key(),
            authority: market.authority,
            end_time,
        });

        Ok(())
    }

    /// 用户下注到 OutcomeA 或 OutcomeB
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        outcome: u8, // 1 = OutcomeA, 2 = OutcomeB
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            outcome == Outcome::A as u8 || outcome == Outcome::B as u8,
            ErrorCode::InvalidOutcome
        );

        let market = &mut ctx.accounts.market;

        require!(!market.resolved, ErrorCode::AlreadyResolved);
        let now = Clock::get()?.unix_timestamp;
        require!(now < market.end_time, ErrorCode::Ended);

        // CPI: user_quote_ata -> vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_quote_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // 记录下注
        let position = &mut ctx.accounts.position;
        position.market = market.key();
        position.user = ctx.accounts.user.key();
        position.outcome = outcome;
        position.amount = amount;
        position.claimed = false;
        position.bump = ctx.bumps.position;

        if outcome == Outcome::A as u8 {
            market.total_a = market.total_a.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        } else {
            market.total_b = market.total_b.checked_add(amount).ok_or(ErrorCode::Overflow)?;
        }

        emit!(BetPlaced {
            market: market.key(),
            user: position.user,
            outcome,
            amount,
        });

        Ok(())
    }

    /// authority 在 end_time 之后 resolve 市场
    pub fn resolve(ctx: Context<Resolve>, winning_outcome: u8) -> Result<()> {
        require!(
            winning_outcome == Outcome::A as u8 || winning_outcome == Outcome::B as u8,
            ErrorCode::InvalidOutcome
        );

        let market = &mut ctx.accounts.market;
        let now = Clock::get()?.unix_timestamp;

        require!(!market.resolved, ErrorCode::AlreadyResolved);
        require!(now >= market.end_time, ErrorCode::NotEnded);

        market.resolved = true;
        market.winning_outcome = winning_outcome;

        emit!(MarketResolved {
            market: market.key(),
            winning_outcome,
        });

        Ok(())
    }

    /// 赢家领取：领取金额 = (user.amount / winning_total) * total_pool
    /// 输家调用 → 失败
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let position = &mut ctx.accounts.position;

        require!(market.resolved, ErrorCode::NotResolved);
        require!(!position.claimed, ErrorCode::AlreadyClaimed);
        require!(
            position.outcome == market.winning_outcome,
            ErrorCode::Lost
        );

        // 奖励分配：(user.amount / winning_total) * total_pool
        let winning_total = if market.winning_outcome == Outcome::A as u8 {
            market.total_a
        } else {
            market.total_b
        };
        require!(winning_total > 0, ErrorCode::NoWinningPool);

        let total_pool = market
            .total_a
            .checked_add(market.total_b)
            .ok_or(ErrorCode::Overflow)?;
        let reward = (position.amount as u128)
            .checked_mul(total_pool as u128)
            .ok_or(ErrorCode::Overflow)?
            .checked_div(winning_total as u128)
            .ok_or(ErrorCode::Overflow)? as u64;

        // CPI: vault -> user_quote_ata, PDA 签名
        let market_key = market.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            market_key.as_ref(),
            &[ctx.bumps.vault],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_quote_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, reward)?;

        position.claimed = true;

        emit!(Claimed {
            market: market.key(),
            user: position.user,
            amount: reward,
        });

        Ok(())
    }
}

#[repr(u8)]
pub enum Outcome {
    Unresolved = 0,
    A = 1,
    B = 2,
}

pub const MAX_QUESTION_LEN: usize = 200;

#[account]
pub struct Market {
    pub authority: Pubkey,        // 32
    pub market_id: u64,           // 8
    pub quote_mint: Pubkey,       // 32
    pub vault: Pubkey,            // 32
    pub question: String,         // 4 + N
    pub end_time: i64,            // 8
    pub total_a: u64,             // 8
    pub total_b: u64,             // 8
    pub resolved: bool,           // 1
    pub winning_outcome: u8,      // 1
    pub bump: u8,                 // 1
}

impl Market {
    // 8 (disc) + 32*3 + market_id + 4 + MAX_QUESTION_LEN + 8*3 + 1 + 1 + 1
    pub const SIZE: usize = 8 + 32 * 3 + 8 + 4 + MAX_QUESTION_LEN + 8 * 3 + 1 + 1 + 1;
}

#[account]
pub struct Position {
    pub market: Pubkey,    // 32
    pub user: Pubkey,      // 32
    pub outcome: u8,       // 1
    pub amount: u64,       // 8
    pub claimed: bool,     // 1
    pub bump: u8,          // 1
}

impl Position {
    pub const SIZE: usize = 8 + 32 * 2 + 1 + 8 + 1 + 1;
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::SIZE,
        seeds = [b"market", authority.key().as_ref(), quote_mint.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    pub quote_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = quote_mint,
        token::authority = vault,
        seeds = [b"vault", market.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.quote_mint.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.mint == market.quote_mint @ ErrorCode::MintMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = Position::SIZE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = user_quote_ata.mint == market.quote_mint @ ErrorCode::MintMismatch,
        constraint = user_quote_ata.owner == user.key() @ ErrorCode::OwnerMismatch,
    )]
    pub user_quote_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.quote_mint.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.quote_mint.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump,
        constraint = vault.mint == market.quote_mint @ ErrorCode::MintMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = position.bump,
        constraint = !position.claimed @ ErrorCode::AlreadyClaimed,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = user_quote_ata.mint == market.quote_mint @ ErrorCode::MintMismatch,
        constraint = user_quote_ata.owner == user.key() @ ErrorCode::OwnerMismatch,
    )]
    pub user_quote_ata: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub end_time: i64,
}

#[event]
pub struct BetPlaced {
    pub market: Pubkey,
    pub user: Pubkey,
    pub outcome: u8,
    pub amount: u64,
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub winning_outcome: u8,
}

#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid time")]
    InvalidTime,
    #[msg("Question too long")]
    QuestionTooLong,
    #[msg("Amount must be > 0")]
    InvalidAmount,
    #[msg("Outcome must be 1 (A) or 2 (B)")]
    InvalidOutcome,
    #[msg("Market already resolved")]
    AlreadyResolved,
    #[msg("Market not resolved yet")]
    NotResolved,
    #[msg("Market already ended")]
    Ended,
    #[msg("Market not ended yet")]
    NotEnded,
    #[msg("User already claimed")]
    AlreadyClaimed,
    #[msg("Caller is not market authority")]
    NotAuthority,
    #[msg("You are on the losing side")]
    Lost,
    #[msg("No winning pool")]
    NoWinningPool,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Owner mismatch")]
    OwnerMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
}
