use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Et5PcfcE4j6qcrKxGp7FvaHeMNdJLg47UxjupXxyqsHx");

#[program]
pub mod airdrop {
    use super::*;

    /// 创建 airdrop：authority 把代币转入 vault 由 PDA 托管
    pub fn create_airdrop(
        ctx: Context<CreateAirdrop>,
        claim_amount: u64,
        total_deposit: u64,
    ) -> Result<()> {
        require!(claim_amount > 0, ErrorCode::InvalidAmount);
        require!(total_deposit >= claim_amount, ErrorCode::InvalidDeposit);

        let airdrop = &mut ctx.accounts.airdrop;
        airdrop.authority = ctx.accounts.authority.key();
        airdrop.mint = ctx.accounts.mint.key();
        airdrop.vault = ctx.accounts.vault.key();
        airdrop.claim_amount = claim_amount;
        airdrop.claimed_count = 0;
        airdrop.bump = ctx.bumps.airdrop;

        // 把代币从 authority 转入 vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.authority_ata.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, total_deposit)?;

        emit!(AirdropCreated {
            airdrop: airdrop.key(),
            mint: airdrop.mint,
            claim_amount,
            total_deposit,
        });

        Ok(())
    }

    /// 用户 claim 一份 airdrop；ClaimRecord PDA 防重复
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let airdrop = &mut ctx.accounts.airdrop;

        // vault 余额不足直接拒绝
        require!(
            ctx.accounts.vault.amount >= airdrop.claim_amount,
            ErrorCode::InsufficientVault
        );

        // CPI: vault → claimer ATA，需要 PDA 签名
        let airdrop_key = airdrop.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            airdrop_key.as_ref(),
            &[ctx.bumps.vault],
        ]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.claimer_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, airdrop.claim_amount)?;

        // 记录 claim
        let record = &mut ctx.accounts.claim_record;
        record.airdrop = airdrop.key();
        record.claimer = ctx.accounts.claimer.key();
        record.amount = airdrop.claim_amount;
        record.timestamp = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.claim_record;

        airdrop.claimed_count = airdrop
            .claimed_count
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;

        emit!(Claimed {
            airdrop: airdrop.key(),
            claimer: record.claimer,
            amount: airdrop.claim_amount,
        });

        Ok(())
    }
}

#[account]
pub struct Airdrop {
    pub authority: Pubkey,      // 32
    pub mint: Pubkey,           // 32
    pub vault: Pubkey,          // 32
    pub claim_amount: u64,      // 8
    pub claimed_count: u64,     // 8
    pub bump: u8,               // 1
}

impl Airdrop {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct ClaimRecord {
    pub airdrop: Pubkey,    // 32
    pub claimer: Pubkey,    // 32
    pub amount: u64,        // 8
    pub timestamp: i64,     // 8
    pub bump: u8,           // 1
}

impl ClaimRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

#[derive(Accounts)]
pub struct CreateAirdrop<'info> {
    #[account(
        init,
        payer = authority,
        space = Airdrop::SIZE,
        seeds = [b"airdrop", authority.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub airdrop: Account<'info, Airdrop>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = vault,
        seeds = [b"vault", airdrop.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = authority_ata.mint == mint.key() @ ErrorCode::MintMismatch,
        constraint = authority_ata.owner == authority.key() @ ErrorCode::OwnerMismatch,
    )]
    pub authority_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"airdrop", airdrop.authority.as_ref(), airdrop.mint.as_ref()],
        bump = airdrop.bump,
    )]
    pub airdrop: Account<'info, Airdrop>,

    #[account(
        mut,
        seeds = [b"vault", airdrop.key().as_ref()],
        bump,
        constraint = vault.mint == airdrop.mint @ ErrorCode::MintMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = claimer,
        space = ClaimRecord::SIZE,
        seeds = [b"claim", airdrop.key().as_ref(), claimer.key().as_ref()],
        bump,
    )]
    pub claim_record: Account<'info, ClaimRecord>,

    #[account(
        mut,
        constraint = claimer_ata.mint == airdrop.mint @ ErrorCode::MintMismatch,
        constraint = claimer_ata.owner == claimer.key() @ ErrorCode::OwnerMismatch,
    )]
    pub claimer_ata: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AirdropCreated {
    pub airdrop: Pubkey,
    pub mint: Pubkey,
    pub claim_amount: u64,
    pub total_deposit: u64,
}

#[event]
pub struct Claimed {
    pub airdrop: Pubkey,
    pub claimer: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("claim_amount must be greater than zero")]
    InvalidAmount,
    #[msg("total_deposit must be >= claim_amount")]
    InvalidDeposit,
    #[msg("Vault does not have enough tokens")]
    InsufficientVault,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Owner mismatch")]
    OwnerMismatch,
    #[msg("Claimed count overflow")]
    Overflow,
}
