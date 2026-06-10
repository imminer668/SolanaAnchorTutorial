use anchor_lang::prelude::*;

declare_id!("8fFPXFbvCXgKPoPuXMG4aukWuGVEDQQKiD4drUUYg8ND");

pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_OPTION_LEN: usize = 32;
pub const MAX_OPTIONS: usize = 6;

#[program]
pub mod voting {
    use super::*;

    pub fn create_poll(
        ctx: Context<CreatePoll>,
        poll_id: u64,
        title: String,
        options: Vec<String>,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, ErrorCode::TitleTooLong);
        require!(options.len() >= 2, ErrorCode::NotEnoughOptions);
        require!(options.len() <= MAX_OPTIONS, ErrorCode::TooManyOptions);
        require!(duration_seconds > 0, ErrorCode::InvalidDuration);
        for opt in options.iter() {
            require!(opt.len() <= MAX_OPTION_LEN, ErrorCode::OptionTooLong);
        }

        let clock = Clock::get()?;
        let poll = &mut ctx.accounts.poll;
        poll.authority = ctx.accounts.authority.key();
        poll.poll_id = poll_id;
        poll.title = title;
        poll.options = options.clone();
        poll.vote_counts = vec![0u64; options.len()];
        poll.start_time = clock.unix_timestamp;
        poll.end_time = clock.unix_timestamp + duration_seconds;
        poll.closed = false;
        poll.bump = ctx.bumps.poll;

        emit!(PollCreated {
            poll: poll.key(),
            authority: poll.authority,
            end_time: poll.end_time,
        });

        Ok(())
    }

    pub fn vote(ctx: Context<Vote>, option_index: u8) -> Result<()> {
        let poll = &mut ctx.accounts.poll;
        let clock = Clock::get()?;

        require!(!poll.closed, ErrorCode::PollClosed);
        require!(clock.unix_timestamp < poll.end_time, ErrorCode::PollExpired);
        require!(
            (option_index as usize) < poll.options.len(),
            ErrorCode::InvalidOption
        );

        poll.vote_counts[option_index as usize] = poll.vote_counts[option_index as usize]
            .checked_add(1)
            .ok_or(ErrorCode::Overflow)?;

        let record = &mut ctx.accounts.vote_record;
        record.poll = poll.key();
        record.voter = ctx.accounts.voter.key();
        record.option_index = option_index;
        record.timestamp = clock.unix_timestamp;
        record.bump = ctx.bumps.vote_record;

        emit!(Voted {
            poll: poll.key(),
            voter: record.voter,
            option_index,
        });

        Ok(())
    }

    pub fn close_poll(ctx: Context<ClosePoll>) -> Result<()> {
        let poll = &mut ctx.accounts.poll;
        require!(!poll.closed, ErrorCode::PollClosed);
        poll.closed = true;

        emit!(PollClosed {
            poll: poll.key(),
        });

        Ok(())
    }
}

#[account]
pub struct Poll {
    pub authority: Pubkey,           // 32
    pub poll_id: u64,                // 8
    pub title: String,               // 4 + MAX_TITLE_LEN
    pub options: Vec<String>,        // 4 + MAX_OPTIONS * (4 + MAX_OPTION_LEN)
    pub vote_counts: Vec<u64>,       // 4 + MAX_OPTIONS * 8
    pub start_time: i64,             // 8
    pub end_time: i64,               // 8
    pub closed: bool,                // 1
    pub bump: u8,                    // 1
}

impl Poll {
    pub const MAX_SIZE: usize = 8
        + 32
        + 8
        + 4 + MAX_TITLE_LEN
        + 4 + MAX_OPTIONS * (4 + MAX_OPTION_LEN)
        + 4 + MAX_OPTIONS * 8
        + 8
        + 8
        + 1
        + 1;
}

#[account]
pub struct VoteRecord {
    pub poll: Pubkey,        // 32
    pub voter: Pubkey,       // 32
    pub option_index: u8,    // 1
    pub timestamp: i64,      // 8
    pub bump: u8,            // 1
}

impl VoteRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct CreatePoll<'info> {
    #[account(
        init,
        payer = authority,
        space = Poll::MAX_SIZE,
        seeds = [b"poll", authority.key().as_ref(), &poll_id.to_le_bytes()],
        bump,
    )]
    pub poll: Account<'info, Poll>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(
        mut,
        seeds = [b"poll", poll.authority.as_ref(), &poll.poll_id.to_le_bytes()],
        bump = poll.bump,
    )]
    pub poll: Account<'info, Poll>,

    #[account(
        init,
        payer = voter,
        space = VoteRecord::SIZE,
        seeds = [b"vote", poll.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote_record: Account<'info, VoteRecord>,

    #[account(mut)]
    pub voter: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePoll<'info> {
    #[account(
        mut,
        seeds = [b"poll", authority.key().as_ref(), &poll.poll_id.to_le_bytes()],
        bump = poll.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub poll: Account<'info, Poll>,

    pub authority: Signer<'info>,
}

#[event]
pub struct PollCreated {
    pub poll: Pubkey,
    pub authority: Pubkey,
    pub end_time: i64,
}

#[event]
pub struct Voted {
    pub poll: Pubkey,
    pub voter: Pubkey,
    pub option_index: u8,
}

#[event]
pub struct PollClosed {
    pub poll: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Title exceeds maximum length")]
    TitleTooLong,
    #[msg("Need at least 2 options")]
    NotEnoughOptions,
    #[msg("Too many options")]
    TooManyOptions,
    #[msg("Option text exceeds maximum length")]
    OptionTooLong,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Poll has been closed")]
    PollClosed,
    #[msg("Poll has expired")]
    PollExpired,
    #[msg("Invalid option index")]
    InvalidOption,
    #[msg("Vote count overflow")]
    Overflow,
    #[msg("Only the poll authority can perform this action")]
    Unauthorized,
}
