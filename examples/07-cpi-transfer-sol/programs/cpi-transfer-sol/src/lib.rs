use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("B2dbDCQi2EfJF2Wk8j9d7XWmofFd34XrV7KQNQ8vzc2");

/// VaultState Account：保存 vault 关联的 authority 与 bump
#[account]
pub struct VaultState {
    pub authority: Pubkey,  // 32 bytes
    pub bump: u8,           // 1 byte
}

impl VaultState {
    pub const SIZE: usize = 8 + 32 + 1;  // 41 bytes
}

#[error_code]
pub enum ErrorCode {
    #[msg("Only the authority can withdraw")]
    Unauthorized,
    #[msg("Insufficient vault balance")]
    InsufficientFunds,
    #[msg("Invalid vault account")]
    InvalidVault,
}

/// 初始化 Vault
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// CHECK: 由 program 拥有，data 长度 0
    #[account(
        init,
        payer = user,
        space = 0,
        seeds = [b"vault", user.key().as_ref()],
        bump,
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        init,
        payer = user,
        space = VaultState::SIZE,
        seeds = [b"vault_state", user.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 存款：把 SOL 从 user 转入 vault
#[derive(Accounts)]
pub struct Deposit<'info> {
    /// CHECK: 由 program 拥有
    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        seeds = [b"vault_state", authority.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 取款：把 SOL 从 vault 转回给 authority
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// CHECK: 由 program 拥有
    #[account(
        mut,
        seeds = [b"vault", authority.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        seeds = [b"vault_state", authority.key().as_ref()],
        bump = vault_state.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[program]
pub mod cpi_transfer_sol {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.authority = ctx.accounts.user.key();
        vault_state.bump = ctx.bumps.vault_state;

        // 校验 vault 的 owner 必须是 program 自己
        require!(
            ctx.accounts.vault.owner == &crate::id(),
            ErrorCode::InvalidVault
        );

        msg!("Vault initialized for {}", vault_state.authority);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        );
        transfer(cpi_ctx, amount)?;
        msg!("Deposited {} lamports", amount);
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        // 余额检查
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        require!(
            vault_lamports >= amount,
            ErrorCode::InsufficientFunds
        );

        // 直接 lamport 操作（vault 是 program-owned）
        let vault_info = ctx.accounts.vault.to_account_info();
        let authority_info = ctx.accounts.authority.to_account_info();
        **vault_info.try_borrow_mut_lamports()? -= amount;
        **authority_info.try_borrow_mut_lamports()? += amount;

        msg!("Withdrew {} lamports", amount);
        Ok(())
    }
}
