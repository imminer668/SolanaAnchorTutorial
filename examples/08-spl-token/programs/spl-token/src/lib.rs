use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("BV1uAK93scCC1DYH4ikNxtRTmpsaaZe38b8tCxkydEgP");

/// SPL Token 教学 Program
///
/// 演示：
/// 1. 创建 Mint 账户
/// 2. 创建 ATA（Associated Token Account）
/// 3. mint_to 给某个 ATA
/// 4. transfer 在两个 ATA 之间
///
/// 教学重点：
/// - SPL Token 的"逻辑"在 Token Program
/// - "状态"在 Mint 和 Token Account
/// - 不需要自己实现 ERC20 等价物

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient token balance")]
    InsufficientBalance,
}

/// 1. 创建 Mint（带 9 位 decimals）
#[derive(Accounts)]
pub struct CreateMint<'info> {
    #[account(
        init,
        payer = payer,
        mint::decimals = 9,
        mint::authority = mint_authority.key(),
    )]
    pub mint: Account<'info, Mint>,

    /// CHECK: Mint authority，可以是任何 pubkey
    pub mint_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

/// 2. Mint Token 给某人的 ATA
#[derive(Accounts)]
pub struct MintToken<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub mint_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

/// 3. Transfer Token（从 source ATA 转到 destination ATA）
#[derive(Accounts)]
pub struct TransferToken<'info> {
    #[account(mut)]
    pub source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub source_authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[program]
pub mod spl_token {
    use super::*;

    pub fn create_mint(ctx: Context<CreateMint>) -> Result<()> {
        msg!("Mint created: {}", ctx.accounts.mint.key());
        Ok(())
    }

    pub fn mint_token(ctx: Context<MintToken>, amount: u64) -> Result<()> {
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::mint_to(cpi_ctx, amount)?;
        msg!("Minted {} tokens to {}", amount, ctx.accounts.destination.key());
        Ok(())
    }

    pub fn transfer_token(ctx: Context<TransferToken>, amount: u64) -> Result<()> {
        // 余额检查
        require!(
            ctx.accounts.source.amount >= amount,
            ErrorCode::InsufficientBalance
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.source.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.source_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, amount)?;
        msg!("Transferred {} tokens", amount);
        Ok(())
    }
}
