//! This module contains the logic for setting the close wait duration for the protocol.
use anchor_lang::prelude::*;
use crate::state::*;
use crate::CustomError;


/// Parameters required for setting the close wait duration.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetCloseWaitDurationArgs {
    /// The waiting duration for closing a finished trade [Config::close_trade_duration].
    /// If it is none, the close_trade_duratin will not changed.
    pub close_trade_duration: Option<u64>,
    /// The waiting duration for closing a payment receipt [Config::close_payment_duration].
    /// If it is none, the close_payment_duration will not changed.
    pub close_payment_duration: Option<u64>,
}

/// The context accounts required for the set close wait duration instruction.
#[derive(Accounts)]
pub struct SetCloseWaitDuration<'info> {
    /// The operator that is authorized to perform the set close wait duration instruction.
    /// Must be [Config::operators]
    #[account(
        mut,
        constraint = config.operators.contains(operator.key) @ CustomError::Unauthorized,
    )]
    pub operator: Signer<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        mut,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
}

/// Handles the setting the close wait duration for the protocol.
/// # Arguments
/// * `ctx` - A [Context] of [SetCloseWaitDuration] required for setting the waiting duration.
/// * `set_close_wait_duration_args` - An argument [SetCloseWaitDurationArgs] required for setting the waiting duration.
/// # Errors
/// * [CustomError::Unauthorized] when the caller is not authorized.
pub fn handler_set_close_wait_duration(ctx: Context<SetCloseWaitDuration>, set_close_wait_duration_args: SetCloseWaitDurationArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.set_close_trade_duration(set_close_wait_duration_args.close_trade_duration)?;
    config.set_close_payment_duration(set_close_wait_duration_args.close_payment_duration)?;
    Ok(())
}
