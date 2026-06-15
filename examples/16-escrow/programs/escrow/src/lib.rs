use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("4JQsYPbpzcgiMmQaZMnLtu7h9pAWv51ARZg8H2vUps7s");

/// Escrow 状态
#[account]
pub struct Escrow {
    pub maker: Pubkey,           // 32 bytes - 创建者
    pub mint_a: Pubkey,          // 32 bytes - maker 提供的 token
    pub mint_b: Pubkey,          // 32 bytes - taker 提供的 token
    pub amount_a: u64,           // 8 bytes - maker 想要换出的数量
    pub amount_b: u64,           // 8 bytes - maker 想要换入的数量
    pub bump: u8,                // 1 byte - escrow PDA bump
    pub vault_bump: u8,          // 1 byte - vault PDA bump
    pub escrow_id: u64,          // 8 bytes - escrow 编号
}

impl Escrow {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 8;  // = 130 bytes
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the maker can perform this action")]
    Unauthorized,
    #[msg("Taker has insufficient token B balance")]
    InsufficientTakerFunds,
    #[msg("Deposit amount mismatch")]
    AmountMismatch,
    #[msg("Token account mint does not match expected mint")]
    WrongMint,
    #[msg("Token account owner does not match expected owner")]
    WrongOwner,
}

/// 1. 创建 Escrow（同时初始化 vault Token Account，authority = escrow PDA）
#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = maker,
        space = Escrow::SIZE,
        seeds = [b"escrow", maker.key().as_ref(), &escrow_id.to_le_bytes()],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = maker,
        seeds = [b"vault", escrow.key().as_ref()],
        bump,
        token::mint = mint_a,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// 2. Maker 存 token_a 到 vault
#[derive(Accounts)]
pub struct DepositToken<'info> {
    #[account(
        mut,
        seeds = [b"escrow", maker.key().as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = maker @ ErrorCode::Unauthorized,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub maker_token_a: Account<'info, TokenAccount>,

    pub maker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// 3. Taker 用 token_b 换 token_a
#[derive(Accounts)]
pub struct Exchange<'info> {
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", escrow.maker.as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = taker_token_b.owner == taker.key() @ ErrorCode::WrongOwner,
        constraint = taker_token_b.mint == escrow.mint_b @ ErrorCode::WrongMint,
        constraint = taker_token_b.amount >= escrow.amount_b @ ErrorCode::InsufficientTakerFunds,
    )]
    pub taker_token_b: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = taker_token_a.owner == taker.key() @ ErrorCode::WrongOwner,
        constraint = taker_token_a.mint == escrow.mint_a @ ErrorCode::WrongMint,
    )]
    pub taker_token_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = maker_token_b.owner == escrow.maker @ ErrorCode::WrongOwner,
        constraint = maker_token_b.mint == escrow.mint_b @ ErrorCode::WrongMint,
    )]
    pub maker_token_b: Account<'info, TokenAccount>,

    /// CHECK: 接收 escrow 关闭后的 lamports，必须等于 escrow.maker
    #[account(mut, constraint = maker.key() == escrow.maker @ ErrorCode::Unauthorized)]
    pub maker: AccountInfo<'info>,

    pub taker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// 4. Maker 取消 Escrow
#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        close = maker,
        seeds = [b"escrow", maker.key().as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump,
        has_one = maker @ ErrorCode::Unauthorized,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub maker_token_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[program]
pub mod escrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.maker = ctx.accounts.maker.key();
        escrow.mint_a = ctx.accounts.mint_a.key();
        escrow.mint_b = ctx.accounts.mint_b.key();
        escrow.amount_a = amount_a;
        escrow.amount_b = amount_b;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;
        escrow.escrow_id = escrow_id;

        msg!("Escrow {} created", escrow_id);
        Ok(())
    }

    pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(amount == escrow.amount_a, ErrorCode::AmountMismatch);

        let cpi_accounts = Transfer {
            from: ctx.accounts.maker_token_a.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, amount)?;
        msg!("Deposited {} token_a", amount);
        Ok(())
    }

    pub fn exchange(ctx: Context<Exchange>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;

        // 1. Taker 转入 token_b 给 maker（taker 普通签名）
        let cpi_accounts = Transfer {
            from: ctx.accounts.taker_token_b.to_account_info(),
            to: ctx.accounts.maker_token_b.to_account_info(),
            authority: ctx.accounts.taker.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, escrow.amount_b)?;

        // 2. Vault 把 token_a 转给 taker（escrow PDA 签名）
        let escrow_seeds: &[&[u8]] = &[
            b"escrow",
            escrow.maker.as_ref(),
            &escrow.escrow_id.to_le_bytes(),
            &[escrow.bump],
        ];
        let signer_seeds = &[escrow_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.taker_token_a.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.amount_a)?;

        // 3. 关闭 vault（escrow PDA 签名，rent 退给 maker）
        let cpi_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::close_account(cpi_ctx)?;

        msg!("Exchange completed");
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;

        let escrow_seeds: &[&[u8]] = &[
            b"escrow",
            escrow.maker.as_ref(),
            &escrow.escrow_id.to_le_bytes(),
            &[escrow.bump],
        ];
        let signer_seeds = &[escrow_seeds];

        // 1. 退 token_a 给 maker（escrow PDA 签名）
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.maker_token_a.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.amount_a)?;

        // 2. 关闭 vault（escrow PDA 签名）
        let cpi_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::close_account(cpi_ctx)?;

        msg!("Escrow cancelled");
        Ok(())
    }
}
