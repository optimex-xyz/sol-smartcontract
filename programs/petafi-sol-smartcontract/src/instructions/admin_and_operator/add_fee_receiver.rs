//! This module contains the logic for adding the fee receiver for the protocol.
use anchor_lang::prelude::*;
use crate::state::*;
use crate::PetaFiError;

/// The context accounts required for the add fee receiver instruction.
#[derive(Accounts)]
#[instruction(receiver_pubkey: Pubkey)]
pub struct AddFeeReceiverAccounts<'info> {
    /// The admin that is authorized to perform the add fee receiver instruction.
    /// Must be the [Config::admin]
    #[account(
        mut,
        address = config.admin @ PetaFiError::Unauthorized,
    )]
    pub signer: Signer<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The fee receiver PDA account that contains the fee receiver information.
    /// Will be initialized by the signer.
    #[account(
        init,
        payer = signer,
        space = 8 + FeeReceiver::INIT_SPACE,
        seeds = [FeeReceiver::SEED, receiver_pubkey.as_ref()],
        bump,
    )]
    pub fee_receiver: Account<'info, FeeReceiver>,

    /// System program.
    pub system_program: Program<'info, System>,
}


/// Handles the adding of protocol fee receiver.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [AddFeeReceiver] required for adding the fee receiver.
/// * `receiver_pubkey` - The pubkey of the fee receiver.
/// # Errors
/// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the admin.
pub fn handler_add_fee_receiver(ctx: Context<AddFeeReceiverAccounts>, receiver_pubkey: Pubkey) -> Result<()> {
    let fee_receiver = &mut ctx.accounts.fee_receiver;
    fee_receiver.receiver = receiver_pubkey;
    Ok(())
}