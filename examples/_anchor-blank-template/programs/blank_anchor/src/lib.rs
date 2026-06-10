use anchor_lang::prelude::*;

declare_id!("AKoBQ44i2Y2WMypMYzqzFJPT59WADVcrTjWYHpFCkyUL");

#[program]
pub mod blank_anchor {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
