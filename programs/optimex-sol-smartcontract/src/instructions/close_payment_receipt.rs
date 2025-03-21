//! This module contains the logic for closing the payment receipt.
use anchor_lang::prelude::*;

use crate::{error::CustomError, state::*};

/// Handles the close of the payment receipt.
/// # Arguments
/// * `ctx` - A [Context] of [ClosePaymentReceiptAccounts] required for closing the payment receipt.
/// # Errors
/// * [CustomError::InvalidUserAccount] - When the signer is not match to [PaymentReceipt::from_pubkey].
/// * [CustomError::CloseNotAvailable] - Not the available time to close the payment receipt.
pub fn handler_close_payment_receipt<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, ClosePaymentReceiptAccounts<'info>>,
) -> Result<()> {
    let payment_receipt = &ctx.accounts.payment_receipt;
    let config = &ctx.accounts.config;
    payment_receipt.assert_close(config.close_payment_duration)?;
    Ok(())
}

/// Accounts required for the payment instruction.
#[derive(Accounts)]
pub struct ClosePaymentReceiptAccounts<'info> {
    /// The signer account, which is authorized to perform the close payment receipt instruction.
    /// Must be the same as the [PaymentReceipt::from_pubkey].
    #[account(
        mut,
        address = payment_receipt.from_pubkey @ CustomError::InvalidUserAccount,
    )]
    pub signer: Signer<'info>,

    /// The payment receipt PDA that contains the payment information.
    /// This PDA will be closed by the instruction.
    #[account(
        mut,
        seeds = [
            PaymentReceipt::SEED,
            &payment_receipt.trade_id,
            payment_receipt.from_pubkey.key().as_ref(),
            payment_receipt.to_pubkey.key().as_ref(),
            &payment_receipt.payment_amount.to_le_bytes(),
            &payment_receipt.total_fee.to_le_bytes(),
            &payment_receipt.token.unwrap_or_default().as_ref(),
        ],
        bump,
        close = signer,
    )]
    pub payment_receipt: Account<'info, PaymentReceipt>,

    /// The config PDA that contains the protocol configuration.
    #[account(
        seeds = [
            Config::SEED,
        ],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// System program.
    pub system_program: Program<'info, System>,
}
