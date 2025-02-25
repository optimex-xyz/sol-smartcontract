//! This module contains the logic for the withdraw total fee instruction.
use anchor_lang::prelude::*;

use crate::{error::PetaFiError, state::*, utils::*, ID};

/// Parameters required for the withdraw total fee instruction.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawTotalFeeArgs {
    /// Token public key for SPL token payments, none if SOL payment.
    pub token: Option<Pubkey>,
    /// Amount to be transferred.
    pub amount: u64,
}

/// Handles the withdraw total fee instruction.
///
/// # Arguments
/// * `ctx` - A [Context] of [WithdrawTotalFeeAccounts] required for the withdraw total fee.
/// * `withdraw_total_fee_args` - An argument [WithdrawTotalFeeArgs] required for the withdraw total fee.
/// # Errors
/// * [PetaFiError::InvalidAmount] when the amount [WithdrawTotalFeeArgs::amount] + rent fee is greater than the protocol's SOL balance.
/// * [PetaFiError::InvalidMintKey] when the mint key is not match with the [WithdrawTotalFeeArgs::token].
/// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the protocol PDA and mint.
/// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token of the to_user and mint.
pub fn handler_withdraw_total_fee<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, WithdrawTotalFeeAccounts<'info>>,
    withdraw_total_fee_args: WithdrawTotalFeeArgs,
) -> Result<()> {
    let to_user = &mut ctx.accounts.to_user.to_account_info();
    let protocol = &mut ctx.accounts.protocol.to_account_info();

    let total_fee_amount = withdraw_total_fee_args.amount;

    // Handle the SOL or SPL token withdraw total fee
    // Transfer asset from the protocol to the fee receiver
    match withdraw_total_fee_args.token {
        Some(token_pubkey) => {
            let protocol_seeds: &[&[u8]] = &[b"protocol", &[ctx.bumps.protocol]];
            // transfer SPL token from signer to toUser
            transfer_spl_token(
                &mut ctx.remaining_accounts.iter(),
                &token_pubkey,
                &protocol.key,
                &to_user.key,
                &protocol.to_account_info(),
                total_fee_amount,
                &[protocol_seeds],
                None,
            )?;
        }
        None => {
            let minimum_rent = Rent::get()?.minimum_balance(0);
            // There need to be enough SOL to cover the rent
            if protocol.lamports() - total_fee_amount < minimum_rent {
                return Err(PetaFiError::InvalidAmount.into());
            }
            **protocol.to_account_info().try_borrow_mut_lamports()? -= total_fee_amount;
            **to_user.to_account_info().try_borrow_mut_lamports()? += total_fee_amount;
        }
    }

    Ok(())
}

/// Accounts required for the payment instruction.
#[derive(Accounts)]
pub struct WithdrawTotalFeeAccounts<'info> {
    /// The signer account who perform the withdraw total fee.
    /// Can be anyone
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK:
    /// The account to which the total fee will be sent. Must be decaled as a [FeeReceiver].
    #[account(
        mut,
        address = fee_receiver.receiver @ PetaFiError::InvalidRefundPubkey,
    )]
    pub to_user: UncheckedAccount<'info>,

    /// The fee receiver PDA account that contains the fee receiver information.
    #[account(
        seeds = [FeeReceiver::SEED, to_user.key().as_ref()],
        bump,
    )]
    pub fee_receiver: Account<'info, FeeReceiver>,

    /// CHECK:
    /// The protocol PDA account which own the protocol fee.
    #[account(
        mut,
        seeds = [b"protocol"],
        bump,
        owner = ID, // This PDA must come from our smart-contract
    )]
    pub protocol: UncheckedAccount<'info>,
}
