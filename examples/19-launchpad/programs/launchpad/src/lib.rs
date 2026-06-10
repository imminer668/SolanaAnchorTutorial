use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5TSpDPCpCCoykzWMTLqq3Go6QVEQvBiCr5RgjAeVRnVM");

#[program]
pub mod launchpad {
    use super::*;

    /// 创建 LaunchpadPool + 两个 vault (sale_vault, quote_vault)
    /// authority 之后再调用 deposit_sale_token 注入销售代币
    pub fn create_pool(
        ctx: Context<CreatePool>,
        price: u64,
        soft_cap: u64,
        hard_cap: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        require!(soft_cap > 0, ErrorCode::InvalidCap);
        require!(hard_cap >= soft_cap, ErrorCode::InvalidCap);
        require!(price > 0, ErrorCode::InvalidPrice);
        require!(end_time > start_time, ErrorCode::InvalidTime);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.sale_mint = ctx.accounts.sale_mint.key();
        pool.quote_mint = ctx.accounts.quote_mint.key();
        pool.sale_vault = ctx.accounts.sale_vault.key();
        pool.quote_vault = ctx.accounts.quote_vault.key();
        pool.price = price;
        pool.soft_cap = soft_cap;
        pool.hard_cap = hard_cap;
        pool.start_time = start_time;
        pool.end_time = end_time;
        pool.total_quote_raised = 0;
        pool.status = PoolStatus::Active as u8;
        pool.bump = ctx.bumps.pool;

        emit!(PoolCreated {
            pool: pool.key(),
            authority: pool.authority,
            sale_mint: pool.sale_mint,
            quote_mint: pool.quote_mint,
            soft_cap,
            hard_cap,
            end_time,
        });

        Ok(())
    }

    /// authority 把 sale token 转入 sale_vault，作为可售卖总量
    pub fn deposit_sale_token(ctx: Context<DepositSaleToken>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let pool = &ctx.accounts.pool;
        // CPI: authority_sale_ata -> sale_vault（authority 签名）
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.authority_sale_ata.to_account_info(),
                to: ctx.accounts.sale_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(SaleTokenDeposited {
            pool: pool.key(),
            amount,
        });

        Ok(())
    }

    /// 用户用 quote token 出资；同时 init UserContribution PDA
    pub fn contribute(ctx: Context<Contribute>, quote_amount: u64) -> Result<()> {
        require!(quote_amount > 0, ErrorCode::InvalidAmount);

        let pool = &mut ctx.accounts.pool;
        let now = Clock::get()?.unix_timestamp;

        require!(now >= pool.start_time, ErrorCode::NotStarted);
        require!(now < pool.end_time, ErrorCode::Ended);
        require!(pool.status == PoolStatus::Active as u8, ErrorCode::NotActive);

        // 软顶/硬顶校验
        let new_total = pool
            .total_quote_raised
            .checked_add(quote_amount)
            .ok_or(ErrorCode::Overflow)?;
        require!(new_total <= pool.hard_cap, ErrorCode::OverHardCap);

        // sale_vault 必须已经存款
        require!(
            ctx.accounts.sale_vault.amount > 0,
            ErrorCode::NoSaleToken
        );

        // CPI: user_quote_ata -> quote_vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_quote_ata.to_account_info(),
                to: ctx.accounts.quote_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, quote_amount)?;

        // 记录贡献
        let contribution = &mut ctx.accounts.contribution;
        contribution.pool = pool.key();
        contribution.user = ctx.accounts.user.key();
        contribution.quote_amount = quote_amount;
        contribution.sale_amount = quote_amount
            .checked_mul(pool.price)
            .ok_or(ErrorCode::Overflow)?;
        contribution.claimed = false;
        contribution.refunded = false;
        contribution.bump = ctx.bumps.contribution;

        pool.total_quote_raised = new_total;

        emit!(Contributed {
            pool: pool.key(),
            user: contribution.user,
            quote_amount,
            sale_amount: contribution.sale_amount,
        });

        Ok(())
    }

    /// 用户领取 sale token（soft cap 达成后即可领取，不强制等待 end_time）
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        // 状态判定：现在达到 soft_cap 即视为 Succeeded
        require!(
            pool.total_quote_raised >= pool.soft_cap,
            ErrorCode::NotSucceeded
        );

        // sale_vault 必须够支付
        require!(
            ctx.accounts.sale_vault.amount >= ctx.accounts.contribution.sale_amount,
            ErrorCode::InsufficientSaleVault
        );

        // CPI: sale_vault -> user_sale_ata, PDA 签名
        let pool_key = pool.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"sale_vault",
            pool_key.as_ref(),
            &[ctx.bumps.sale_vault],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sale_vault.to_account_info(),
                to: ctx.accounts.user_sale_ata.to_account_info(),
                authority: ctx.accounts.sale_vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, ctx.accounts.contribution.sale_amount)?;

        let contribution = &mut ctx.accounts.contribution;
        contribution.claimed = true;

        // 升级状态为 Succeeded（保留 First-claim 触发语义）
        if pool.status == PoolStatus::Active as u8 {
            pool.status = PoolStatus::Succeeded as u8;
        }

        emit!(ClaimedSale {
            pool: pool.key(),
            user: contribution.user,
            sale_amount: contribution.sale_amount,
        });

        Ok(())
    }

    /// 用户退款（仅在 pool 已结束且未达 soft cap 时可用）
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let now = Clock::get()?.unix_timestamp;

        require!(now >= pool.end_time, ErrorCode::NotEnded);
        // 必须未达 soft cap
        require!(
            pool.total_quote_raised < pool.soft_cap,
            ErrorCode::AlreadySucceeded
        );

        // CPI: quote_vault -> user_quote_ata, PDA 签名
        let pool_key = pool.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"quote_vault",
            pool_key.as_ref(),
            &[ctx.bumps.quote_vault],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.quote_vault.to_account_info(),
                to: ctx.accounts.user_quote_ata.to_account_info(),
                authority: ctx.accounts.quote_vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, ctx.accounts.contribution.quote_amount)?;

        let contribution = &mut ctx.accounts.contribution;
        contribution.refunded = true;

        // 升级状态为 Failed
        if pool.status == PoolStatus::Active as u8 {
            pool.status = PoolStatus::Failed as u8;
        }

        emit!(Refunded {
            pool: pool.key(),
            user: contribution.user,
            quote_amount: contribution.quote_amount,
        });

        Ok(())
    }

    /// authority 提取：
    /// - Succeeded：取走 quote_vault 里的所有 quote token
    /// - Failed：取走 sale_vault 里剩余的 sale token
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let now = Clock::get()?.unix_timestamp;

        let status = pool.status;
        require!(
            status == PoolStatus::Succeeded as u8 || status == PoolStatus::Failed as u8,
            ErrorCode::NotFinalized
        );

        if status == PoolStatus::Succeeded as u8 {
            // Succeeded 必须达到 soft_cap
            require!(
                pool.total_quote_raised >= pool.soft_cap,
                ErrorCode::NotSucceeded
            );

            // quote_vault -> authority_quote_ata
            let amount = ctx.accounts.quote_vault.amount;
            let pool_key = pool.key();
            let signer_seeds: &[&[&[u8]]] = &[&[
                b"quote_vault",
                pool_key.as_ref(),
                &[ctx.bumps.quote_vault],
            ]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.quote_vault.to_account_info(),
                    to: ctx.accounts.authority_quote_ata.to_account_info(),
                    authority: ctx.accounts.quote_vault.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, amount)?;

            emit!(Withdrawn {
                pool: pool.key(),
                kind: "quote".to_string(),
                amount,
            });
        } else {
            // Failed：要求已过 end_time
            require!(now >= pool.end_time, ErrorCode::NotEnded);
            require!(
                pool.total_quote_raised < pool.soft_cap,
                ErrorCode::AlreadySucceeded
            );

            // sale_vault -> authority_sale_ata
            let amount = ctx.accounts.sale_vault.amount;
            let pool_key = pool.key();
            let signer_seeds: &[&[&[u8]]] = &[&[
                b"sale_vault",
                pool_key.as_ref(),
                &[ctx.bumps.sale_vault],
            ]];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sale_vault.to_account_info(),
                    to: ctx.accounts.authority_sale_ata.to_account_info(),
                    authority: ctx.accounts.sale_vault.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, amount)?;

            emit!(Withdrawn {
                pool: pool.key(),
                kind: "sale".to_string(),
                amount,
            });
        }

        // 标记为 Finalized（不可再次 withdraw）
        pool.status = PoolStatus::Finalized as u8;

        Ok(())
    }
}

#[repr(u8)]
pub enum PoolStatus {
    Active = 0,
    Succeeded = 1,
    Failed = 2,
    Finalized = 3,
}

#[account]
pub struct LaunchpadPool {
    pub authority: Pubkey,         // 32
    pub sale_mint: Pubkey,         // 32
    pub quote_mint: Pubkey,        // 32
    pub sale_vault: Pubkey,        // 32
    pub quote_vault: Pubkey,       // 32
    pub price: u64,                // 8  - 1 quote unit = price 个 sale unit
    pub soft_cap: u64,             // 8
    pub hard_cap: u64,             // 8
    pub start_time: i64,           // 8
    pub end_time: i64,             // 8
    pub total_quote_raised: u64,   // 8
    pub status: u8,                // 1
    pub bump: u8,                  // 1
}

impl LaunchpadPool {
    pub const SIZE: usize = 8 + 32 * 5 + 8 * 7 + 1 + 1;
}

#[account]
pub struct UserContribution {
    pub pool: Pubkey,         // 32
    pub user: Pubkey,         // 32
    pub quote_amount: u64,    // 8
    pub sale_amount: u64,     // 8
    pub claimed: bool,        // 1
    pub refunded: bool,       // 1
    pub bump: u8,             // 1
}

impl UserContribution {
    pub const SIZE: usize = 8 + 32 * 2 + 8 * 2 + 1 + 1 + 1;
}

#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(
        init,
        payer = authority,
        space = LaunchpadPool::SIZE,
        seeds = [b"pool", authority.key().as_ref(), sale_mint.key().as_ref(), quote_mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    pub sale_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = sale_mint,
        token::authority = sale_vault,
        seeds = [b"sale_vault", pool.key().as_ref()],
        bump,
    )]
    pub sale_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = quote_mint,
        token::authority = quote_vault,
        seeds = [b"quote_vault", pool.key().as_ref()],
        bump,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositSaleToken<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref(), pool.sale_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    #[account(
        mut,
        seeds = [b"sale_vault", pool.key().as_ref()],
        bump,
        constraint = sale_vault.mint == pool.sale_mint @ ErrorCode::MintMismatch,
    )]
    pub sale_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_sale_ata.mint == pool.sale_mint @ ErrorCode::MintMismatch,
        constraint = authority_sale_ata.owner == authority.key() @ ErrorCode::OwnerMismatch,
    )]
    pub authority_sale_ata: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref(), pool.sale_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    #[account(
        mut,
        seeds = [b"sale_vault", pool.key().as_ref()],
        bump,
        constraint = sale_vault.mint == pool.sale_mint @ ErrorCode::MintMismatch,
    )]
    pub sale_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"quote_vault", pool.key().as_ref()],
        bump,
        constraint = quote_vault.mint == pool.quote_mint @ ErrorCode::MintMismatch,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = UserContribution::SIZE,
        seeds = [b"contribution", pool.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub contribution: Account<'info, UserContribution>,

    #[account(
        mut,
        constraint = user_quote_ata.mint == pool.quote_mint @ ErrorCode::MintMismatch,
        constraint = user_quote_ata.owner == user.key() @ ErrorCode::OwnerMismatch,
    )]
    pub user_quote_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref(), pool.sale_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    #[account(
        mut,
        seeds = [b"sale_vault", pool.key().as_ref()],
        bump,
        constraint = sale_vault.mint == pool.sale_mint @ ErrorCode::MintMismatch,
    )]
    pub sale_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"contribution", pool.key().as_ref(), user.key().as_ref()],
        bump = contribution.bump,
        constraint = !contribution.claimed @ ErrorCode::AlreadyClaimed,
    )]
    pub contribution: Account<'info, UserContribution>,

    #[account(
        mut,
        constraint = user_sale_ata.mint == pool.sale_mint @ ErrorCode::MintMismatch,
        constraint = user_sale_ata.owner == user.key() @ ErrorCode::OwnerMismatch,
    )]
    pub user_sale_ata: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref(), pool.sale_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    #[account(
        mut,
        seeds = [b"quote_vault", pool.key().as_ref()],
        bump,
        constraint = quote_vault.mint == pool.quote_mint @ ErrorCode::MintMismatch,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"contribution", pool.key().as_ref(), user.key().as_ref()],
        bump = contribution.bump,
        constraint = !contribution.refunded @ ErrorCode::AlreadyRefunded,
    )]
    pub contribution: Account<'info, UserContribution>,

    #[account(
        mut,
        constraint = user_quote_ata.mint == pool.quote_mint @ ErrorCode::MintMismatch,
        constraint = user_quote_ata.owner == user.key() @ ErrorCode::OwnerMismatch,
    )]
    pub user_quote_ata: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref(), pool.sale_mint.as_ref(), pool.quote_mint.as_ref()],
        bump = pool.bump,
        has_one = authority @ ErrorCode::NotAuthority,
    )]
    pub pool: Account<'info, LaunchpadPool>,

    #[account(
        mut,
        seeds = [b"quote_vault", pool.key().as_ref()],
        bump,
        constraint = quote_vault.mint == pool.quote_mint @ ErrorCode::MintMismatch,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"sale_vault", pool.key().as_ref()],
        bump,
        constraint = sale_vault.mint == pool.sale_mint @ ErrorCode::MintMismatch,
    )]
    pub sale_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_quote_ata.mint == pool.quote_mint @ ErrorCode::MintMismatch,
        constraint = authority_quote_ata.owner == authority.key() @ ErrorCode::OwnerMismatch,
    )]
    pub authority_quote_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_sale_ata.mint == pool.sale_mint @ ErrorCode::MintMismatch,
        constraint = authority_sale_ata.owner == authority.key() @ ErrorCode::OwnerMismatch,
    )]
    pub authority_sale_ata: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct PoolCreated {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub sale_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub end_time: i64,
}

#[event]
pub struct SaleTokenDeposited {
    pub pool: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Contributed {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub quote_amount: u64,
    pub sale_amount: u64,
}

#[event]
pub struct ClaimedSale {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub sale_amount: u64,
}

#[event]
pub struct Refunded {
    pub pool: Pubkey,
    pub user: Pubkey,
    pub quote_amount: u64,
}

#[event]
pub struct Withdrawn {
    pub pool: Pubkey,
    pub kind: String,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("soft_cap must be > 0 and hard_cap >= soft_cap")]
    InvalidCap,
    #[msg("price must be > 0")]
    InvalidPrice,
    #[msg("end_time must be > start_time")]
    InvalidTime,
    #[msg("amount must be > 0")]
    InvalidAmount,
    #[msg("Sale token vault is empty, deposit first")]
    NoSaleToken,
    #[msg("Contribution would exceed hard cap")]
    OverHardCap,
    #[msg("Sale not started yet")]
    NotStarted,
    #[msg("Sale already ended")]
    Ended,
    #[msg("Pool is not active")]
    NotActive,
    #[msg("Caller is not pool authority")]
    NotAuthority,
    #[msg("Soft cap not reached, can't claim")]
    NotSucceeded,
    #[msg("Soft cap reached, can't refund")]
    AlreadySucceeded,
    #[msg("Sale not ended yet")]
    NotEnded,
    #[msg("User already claimed")]
    AlreadyClaimed,
    #[msg("User already refunded")]
    AlreadyRefunded,
    #[msg("Insufficient sale token in vault")]
    InsufficientSaleVault,
    #[msg("Pool not finalized (active)")]
    NotFinalized,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Owner mismatch")]
    OwnerMismatch,
    #[msg("Arithmetic overflow")]
    Overflow,
}
