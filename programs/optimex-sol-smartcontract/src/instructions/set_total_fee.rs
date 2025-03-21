//! This module contains the logic for setting the total fee for the trade.
use anchor_lang::prelude::*;

use crate::{CustomError, TradeDetail, ID};

/// Parameters rquired for setting the total fee
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetTotalFeeArgs {
    /// Unique identifier for the trade
    pub trade_id: [u8; 32], // uint256
    /// Amount of the protocol fee
    pub amount: u64,
}

/// Handles the setting of the protocol fee for a specific trade.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [SetTotalFee] required for setting the total fee.
/// * `set_total_fee_args` - An argument [SetTotalFeeArgs] required for setting the total fee.
/// # Errors
/// * [CustomError::Unauthorized] when the caller is not authorized, or not the [TradeDetail::mpc_pubkey].
/// * [CustomError::TimeOut] when the trade timeout is expired, so we cannot set the total fee anymore.
pub fn handler_set_total_fee(
    ctx: Context<SetTotalFee>,
    set_total_fee_args: SetTotalFeeArgs,
) -> Result<()> {
    let user_trade_detail = &mut ctx.accounts.user_trade_detail;

    // Check timeout
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;
    if current_timestamp > user_trade_detail.timeout {
        return err!(CustomError::TimeOut);
    }

    // Set too much the protocol fee amount
    if user_trade_detail.amount < set_total_fee_args.amount {
        return err!(CustomError::InvalidTotalFee);
    }
    user_trade_detail.total_fee = Some(set_total_fee_args.amount);

    Ok(())
}

/// Accounts required for setting the protocol fee
#[derive(Accounts)]
#[instruction(set_total_fee_args: SetTotalFeeArgs)]
pub struct SetTotalFee<'info> {
    /// The signer account who is authorized to set the total fee.
    /// Must be the [TradeDetail::mpc_pubkey].
    #[account(
        mut,
        address = user_trade_detail.mpc_pubkey @ CustomError::Unauthorized // Check authorization
    )]
    pub signer: Signer<'info>,

    /// The user trade detail account that contains the trade information.
    #[account(
        mut,
        seeds = [&set_total_fee_args.trade_id],
        bump,
        owner = ID
    )]
    pub user_trade_detail: Account<'info, TradeDetail>,
}
