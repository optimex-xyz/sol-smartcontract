//! This module contains the logic for the payment instruction.
use anchor_lang::prelude::*;

use crate::{constants::WSOL_MINT, error::PetaFiError, state::*, utils::*, ID};

/// Parameters rquired for the payment instruction.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct PaymentArgs {
    /// Unique identifier for the trade.
    pub trade_id: [u8; 32],
    /// Token public key for SPL token payments, none if SOL payment.
    pub token: Option<Pubkey>,
    /// Amount to be transferred.
    pub amount: u64,
    /// Total fee to be deducted from the amount, and transferred to the protocol.
    pub total_fee: u64,
    /// Deadline for the payment transaction.
    pub deadline: i64,
}

/// Handles the payment instruction.
///
/// # Arguments
/// * `ctx` - A [Context] of [PaymentAccounts] required for the payment.
/// * `payment_args` - An argument [PaymentArgs] required for the payment.
/// # Errors
/// * [PetaFiError::NotWhitelistedToken] when the token is not whitelisted.
/// * [PetaFiError::DeadlineExceeded] when the current timestamp is greater than the [PaymentArgs::deadline].
/// * [PetaFiError::InvalidAmount] when the amount [PaymentArgs::amount] is less than the [PaymentArgs::total_fee].
/// * [PetaFiError::InvalidMintKey] when the mint key is not match with the [PaymentReceipt::token].
/// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the signer and mint.
/// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the [PaymentReceipt::to_pubkey] and mint.
/// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the protocol PDA and mint.
pub fn handler_payment<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, PaymentAccounts<'info>>,
    payment_args: PaymentArgs,
) -> Result<()> {
    let to_user = &ctx.accounts.to_user.to_account_info();
    let signer = &ctx.accounts.signer.to_account_info();
    let protocol = &ctx.accounts.protocol.to_account_info();
    let whitelist_token = &ctx.accounts.whitelist_token;
    let payment_receipt = &mut ctx.accounts.payment_receipt;

    // Validate the deadline
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;
    if current_timestamp > payment_args.deadline {
        return Err(PetaFiError::DeadlineExceeded.into());
    }

    // Validate the amount
    if payment_args.amount <= payment_args.total_fee {
        return Err(PetaFiError::InvalidAmount.into());
    }

    let payment_amount = payment_args.amount - payment_args.total_fee;

    // Handle the SOL or SPL token payment
    // Transfer asset from the signer to the toUser, and transfer fee to the protocol.
    match payment_args.token {
        Some(token_pubkey) => {
            // transfer SPL token from signer to toUser
            assert_keys_equal(
                &token_pubkey,
                &whitelist_token.token,
                PetaFiError::NotWhitelistedToken,
            )?;
            transfer_spl_token(
                &mut ctx.remaining_accounts.iter(),
                &token_pubkey,
                &signer.key,
                &to_user.key,
                signer,
                payment_amount,
                &[],
                Some(payment_args.total_fee),
            )?;
        }
        None => {
            assert_keys_equal(
                &WSOL_MINT,
                &whitelist_token.token,
                PetaFiError::NotWhitelistedToken,
            )?;
            // transfer SOL from signer to toUser
            transfer_sol(&signer.clone(), &to_user.clone(), payment_amount)?;

            if payment_args.total_fee != 0 {
                // transfer fee to protocol account
                transfer_sol(
                    &signer.clone(),
                    &protocol.clone(),
                    payment_args.total_fee,
                )?;
            }
        }
    }

    payment_receipt.assign_value(
        payment_args.trade_id,
        signer.key(),
        to_user.key(),
        payment_args.token,
        payment_args.amount,
        payment_args.total_fee,
    )?;

    Ok(())
}

/// Accounts required for the payment instruction.
#[derive(Accounts)]
#[instruction(payment_args: PaymentArgs)]
pub struct PaymentAccounts<'info> {
    /// The signer account who perform the payment.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK:
    /// The account to which the payment sent to.
    #[account(mut)]
    pub to_user: UncheckedAccount<'info>,

    /// CHECK:
    /// The protocol PDA account to which the total fee will be sent.
    #[account(
        mut,
        seeds = [b"protocol"],
        bump,
        owner = ID, // This PDA must come from our smart-contract
    )]
    pub protocol: UncheckedAccount<'info>,

    /// The whitelist token PDA, only token has been whitelisted can be payment.
    #[account(
        owner = ID @ PetaFiError::NotWhitelistedToken,  
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,

    /// The payment receipt PDA that contains the payment information.
    /// This PDA will be initialized by the instruction.
    #[account(
        init,
        payer = signer,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [
            PaymentReceipt::SEED,
            &payment_args.trade_id,
            signer.key.as_ref(),
            to_user.key.as_ref(),
            &payment_args.amount.to_le_bytes(),
            &payment_args.total_fee.to_le_bytes(),
            &payment_args.token.unwrap_or_default().as_ref(),
        ],
        bump,
    )]
    pub payment_receipt: Account<'info, PaymentReceipt>,

    /// System program.
    pub system_program: Program<'info, System>,
}
