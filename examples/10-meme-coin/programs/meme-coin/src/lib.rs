use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, mint_to, Mint, MintTo, Token, TokenAccount},
};

declare_id!("HNNgNsMhapY7eVQp9voK98KFK7mmnokDoEowCwbVczxh");

/// Meme Coin 配置
///
/// ```text
/// 8  bytes  - Anchor discriminator
/// 32 bytes  - authority: Pubkey (创建者)
/// 32 bytes  - mint: Pubkey
/// 8  bytes  - total_supply: u64
/// 8  bytes  - team_amount: u64
/// 8  bytes  - community_amount: u64
/// 1  byte   - locked: bool
/// 1  byte   - bump: u8
/// ```
#[account]
pub struct MemeCoinConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub team_amount: u64,
    pub community_amount: u64,
    pub locked: bool,
    pub bump: u8,
}

impl MemeCoinConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1;  // = 98 bytes
}

#[error_code]
pub enum ErrorCode {
    #[msg("Team + community must equal total supply")]
    AmountMismatch,
    #[msg("Mint is already locked")]
    AlreadyLocked,
    #[msg("Only the original authority can perform this action")]
    Unauthorized,
    #[msg("Team wallet and community wallet must be different")]
    WalletsDuplicated,
}

/// 1. 初始化：创建 mint，一次性 mint 全部 supply 给 team + community
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = MemeCoinConfig::SIZE,
        seeds = [b"meme", mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, MemeCoinConfig>,

    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = config,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = team_wallet,
    )]
    pub team_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = community_wallet,
    )]
    pub community_ata: Account<'info, TokenAccount>,

    /// CHECK: 团队钱包地址（用于派生 ATA）
    pub team_wallet: AccountInfo<'info>,

    /// CHECK: 社区钱包地址（用于派生 ATA）
    pub community_wallet: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

/// 2. 锁仓：放弃 mint authority，让 supply 永远固定
#[derive(Accounts)]
pub struct LockMint<'info> {
    #[account(
        mut,
        seeds = [b"meme", mint.key().as_ref()],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized,
        has_one = mint,
    )]
    pub config: Account<'info, MemeCoinConfig>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[program]
pub mod meme_coin {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        total_supply: u64,
        team_amount: u64,
        community_amount: u64,
    ) -> Result<()> {
        require!(
            team_amount.checked_add(community_amount) == Some(total_supply),
            ErrorCode::AmountMismatch
        );
        require!(
            ctx.accounts.team_wallet.key() != ctx.accounts.community_wallet.key(),
            ErrorCode::WalletsDuplicated
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.mint = ctx.accounts.mint.key();
        config.total_supply = total_supply;
        config.team_amount = team_amount;
        config.community_amount = community_amount;
        config.locked = false;
        config.bump = ctx.bumps.config;

        // 用 config PDA 作为 mint_authority 一次性 mint
        let mint_key = ctx.accounts.mint.key();
        let config_seeds: &[&[u8]] = &[
            b"meme",
            mint_key.as_ref(),
            &[config.bump],
        ];
        let signer_seeds = &[config_seeds];

        // mint to team
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.team_ata.to_account_info(),
            authority: config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        mint_to(cpi_ctx, team_amount)?;

        // mint to community
        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.community_ata.to_account_info(),
            authority: config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        mint_to(cpi_ctx, community_amount)?;

        msg!(
            "Meme coin minted: total={}, team={}, community={}",
            total_supply,
            team_amount,
            community_amount,
        );
        Ok(())
    }

    pub fn lock_mint(ctx: Context<LockMint>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.locked, ErrorCode::AlreadyLocked);

        // 用 config PDA 调用 SPL Token 的 set_authority
        let mint_key = ctx.accounts.mint.key();
        let config_seeds: &[&[u8]] = &[
            b"meme",
            mint_key.as_ref(),
            &[config.bump],
        ];
        let signer_seeds = &[config_seeds];

        let cpi_accounts = token::SetAuthority {
            account_or_mint: ctx.accounts.mint.to_account_info(),
            current_authority: config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        // 第二个参数 AuthorityType::MintToken, None 表示放弃
        token::set_authority(cpi_ctx, token::spl_token::instruction::AuthorityType::MintTokens, None)?;

        config.locked = true;
        msg!("Meme coin mint authority revoked");
        Ok(())
    }
}
