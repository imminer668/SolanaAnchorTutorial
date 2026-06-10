use anchor_lang::prelude::*;

declare_id!("3Lob7nKquhHHY5HS2imZqkgzUH9fnxWj4aFXDfehVtCJ");

#[program]
pub mod errors_events {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let board = &mut ctx.accounts.board;
        board.authority = ctx.accounts.authority.key();
        board.value = 0;
        board.bump = ctx.bumps.board;

        emit!(BoardInitialized {
            board: board.key(),
            authority: board.authority,
        });

        Ok(())
    }

    pub fn record_value(ctx: Context<RecordValue>, value: u64) -> Result<()> {
        require!(value > 0, ErrorCode::InvalidValue);
        require!(value <= 100, ErrorCode::ValueTooLarge);

        let board = &mut ctx.accounts.board;
        let previous_value = board.value;
        board.value = value;

        emit!(ValueRecorded {
            board: board.key(),
            authority: board.authority,
            previous_value,
            value,
        });

        Ok(())
    }
}

#[account]
pub struct Board {
    pub authority: Pubkey,
    pub value: u64,
    pub bump: u8,
}

impl Board {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = Board::SIZE,
        seeds = [b"board", authority.key().as_ref()],
        bump,
    )]
    pub board: Account<'info, Board>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordValue<'info> {
    #[account(
        mut,
        seeds = [b"board", board.authority.as_ref()],
        bump = board.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub board: Account<'info, Board>,

    pub authority: Signer<'info>,
}

#[event]
pub struct BoardInitialized {
    pub board: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct ValueRecorded {
    pub board: Pubkey,
    pub authority: Pubkey,
    pub previous_value: u64,
    pub value: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Value must be greater than zero")]
    InvalidValue,
    #[msg("Value must be less than or equal to 100")]
    ValueTooLarge,
    #[msg("Only the board authority can record a value")]
    Unauthorized,
}
