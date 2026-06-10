use anchor_lang::prelude::*;

declare_id!("B9LbcgwyuVSM2dMvhN4Mu1d6zLoUncwHpVLzwVNDCMsy");

/// Profile 字符串长度上限
pub const MAX_NAME_LEN: usize = 50;
pub const MAX_BIO_LEN: usize = 200;

/// UserProfile Account
///
/// 对应 EVM：
/// ```solidity
/// mapping(address => Profile) profiles;
/// struct Profile { string name; string bio; }
/// ```
#[account]
pub struct UserProfile {
    pub user: Pubkey,           // 32 bytes - PDA 拥有者
    pub name: String,           // 4 + MAX_NAME_LEN bytes
    pub bio: String,            // 4 + MAX_BIO_LEN bytes
    pub bump: u8,               // 1 byte - PDA bump
}

impl UserProfile {
    /// Account 总大小：
    /// 8 (discriminator) + 32 (Pubkey) + (4 + 50) (String) + (4 + 200) (String) + 1 (u8)
    pub const SIZE: usize = 8 + 32 + (4 + MAX_NAME_LEN) + (4 + MAX_BIO_LEN) + 1;
}

#[error_code]
pub enum ErrorCode {
    #[msg("Name exceeds maximum length")]
    NameTooLong,
    #[msg("Bio exceeds maximum length")]
    BioTooLong,
    #[msg("Only the profile owner can perform this action")]
    Unauthorized,
}

/// 创建用户 Profile（首次）
#[derive(Accounts)]
pub struct CreateProfile<'info> {
    #[account(
        init,
        payer = user,
        space = UserProfile::SIZE,
        seeds = [b"profile", user.key().as_ref()],
        bump,
    )]
    pub profile: Account<'info, UserProfile>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// 更新 Profile
#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"profile", user.key().as_ref()],
        bump = profile.bump,
        has_one = user @ ErrorCode::Unauthorized,
    )]
    pub profile: Account<'info, UserProfile>,

    pub user: Signer<'info>,
}

/// 关闭 Profile 并退还 rent
#[derive(Accounts)]
pub struct CloseProfile<'info> {
    #[account(
        mut,
        seeds = [b"profile", user.key().as_ref()],
        bump = profile.bump,
        has_one = user @ ErrorCode::Unauthorized,
        close = user,
    )]
    pub profile: Account<'info, UserProfile>,

    pub user: Signer<'info>,
}

#[program]
pub mod pda_user_profile {
    use super::*;

    pub fn create_profile(ctx: Context<CreateProfile>, name: String, bio: String) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);
        require!(bio.len() <= MAX_BIO_LEN, ErrorCode::BioTooLong);

        let profile = &mut ctx.accounts.profile;
        profile.user = ctx.accounts.user.key();
        profile.name = name;
        profile.bio = bio;
        profile.bump = ctx.bumps.profile;

        msg!("Profile created for {}", profile.user);
        Ok(())
    }

    pub fn update_profile(ctx: Context<UpdateProfile>, name: String, bio: String) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, ErrorCode::NameTooLong);
        require!(bio.len() <= MAX_BIO_LEN, ErrorCode::BioTooLong);

        let profile = &mut ctx.accounts.profile;
        profile.name = name;
        profile.bio = bio;

        msg!("Profile updated for {}", profile.user);
        Ok(())
    }

    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        let profile = &ctx.accounts.profile;
        msg!("Profile closed for {}", profile.user);
        Ok(())
    }
}
