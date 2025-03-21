//! This module contains the logic for removing the fee receiver for the protocol.
use anchor_lang::prelude::*;
use crate::state::*;
use crate::CustomError;

/// The context accounts required for the add fee receiver instruction.
#[derive(Accounts)]
#[instruction(_receiver_pubkey: Pubkey)]
pub struct RemoveFeeReceiverAccounts<'info> {
    /// The admin that is authorized to perform the remove fee receiver instruction.
    /// Must be the [Config::admin]
    #[account(
        mut,
        address = config.admin @ CustomError::Unauthorized,
    )]
    pub signer: Signer<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The fee receiver PDA account that contains the fee receiver information.
    /// Will be closed and transferred rent fee to the signer.
    #[account(
        mut,
        seeds = [FeeReceiver::SEED, _receiver_pubkey.as_ref()],
        bump,
        close = signer,
    )]
    pub fee_receiver_account: Box<Account<'info, FeeReceiver>>,

    /// System program.
    pub system_program: Program<'info, System>,
}


/// Handles the removing of protocol fee receiver.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [RemoveFeeReceiver] required for removing the fee receiver.
/// # Errors
/// * [CustomError::Unauthorized] - The caller is not authorized, or not the admin.
pub fn handler_remove_fee_receiver(_ctx: Context<RemoveFeeReceiverAccounts>, _receiver_pubkey: Pubkey) -> Result<()> {
    Ok(())
}
