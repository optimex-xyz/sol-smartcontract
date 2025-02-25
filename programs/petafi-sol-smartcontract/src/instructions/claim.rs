//! This module contains the logic for claiming the deposited amount after the timeout.
use crate::{error::*, event::*, state::*, utils::*, ID};
use anchor_lang::prelude::*;

/// Parameters required for the claim function.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct ClaimArgs {
    /// The tradeId, unique identifier for the trade.
    pub trade_id: [u8; 32],
}

/// Handles the logic for claiming the deposited amount after the timeout.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [Claim] required for claiming the deposited amount.
/// * `claim_args` - An argument [ClaimArgs] required for claiming the deposited amount.
/// # Errors
/// * [PetaFiError::InvalidUserAccount] when the user account not match with [TradeDetail::user_pubkey].
/// * [PetaFiError::InvalidRefundPubkey] when the refund pubkey address is not match with the [TradeDetail::refund_pubkey].
/// * [PetaFiError::ClaimNotAvailable] when the [TradeDetail::timeout] is not expired, so we cannot claim the deposited amount.
/// * [PetaFiError::InvalidTradeStatus] when the [TradeDetail::status] is not [TradeStatus::Deposited], we only claim the Deposited trade and timed out.
/// * [PetaFiError::InvalidMintKey] when the mint key is not match with the [TradeDetail::token]
/// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the vault and mint.
/// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the refund pubkey.
pub fn handler_claim<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, Claim<'info>>,
    claim_args: ClaimArgs,
) -> Result<()> {
    let vault = &ctx.accounts.vault.to_account_info();
    let refund_account = &ctx.accounts.refund_account.to_account_info();
    let user_trade_detail = &mut ctx.accounts.user_trade_detail;

    // Check if the trade is able to claimed
    user_trade_detail.assert_claim()?;
    // Handle token or SOL claim
    // Transfer asset from the vault to the refund account
    match user_trade_detail.token {
        Some(token_pubkey) => {
            let seeds: &[&[u8]] = &[b"vault", &claim_args.trade_id];
            let (_, bump) = Pubkey::find_program_address(&seeds, &ID);
            let seeds_signer = &mut seeds.to_vec();
            let binding = [bump];
            seeds_signer.push(&binding);

            // Transfer tokens from vault to user
            transfer_spl_token(
                &mut ctx.remaining_accounts.iter(),
                &token_pubkey,
                &vault.key,
                &user_trade_detail.refund_pubkey,
                vault,
                user_trade_detail.amount,
                &[seeds_signer],
                None,
            )?;
        }
        None => {
            // Transfer SOL from vault to user
            **vault.to_account_info().try_borrow_mut_lamports()? -= user_trade_detail.amount;
            **refund_account.try_borrow_mut_lamports()? += user_trade_detail.amount;
        }
    }
    user_trade_detail.status = TradeStatus::Claimed;

    // Emit claim event
    emit!(Claimed {
        trade_id: claim_args.trade_id,
        token: user_trade_detail.token,
        to_pubkey: user_trade_detail.refund_pubkey,
        operator: *ctx.accounts.signer.key,
        amount: user_trade_detail.amount,
    });

    Ok(())
}

/// The context accounts required for the claim instruction.
#[derive(Accounts)]
#[instruction(claim_args: ClaimArgs)]
pub struct Claim<'info> {
    /// The signer account that is authorized to perform the claim instruction.
    /// Can be anyone.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK:
    /// 
    /// The user account that is the depositor of the trade.
    /// Must be the [TradeDetail::user_pubkey]
    #[account(
        mut,
        address = user_trade_detail.user_pubkey @ PetaFiError::InvalidUserAccount,
    )]
    pub user_account: UncheckedAccount<'info>,

    /// The nonce check account PDA that flag whether the nonce is currently active or not.
    /// Will be closed and transferred rent to the user_account.
    #[account(
        mut,
        seeds = [NonceCheckAccount::SEED, user_trade_detail.user_ephemeral_pubkey.as_ref()],
        bump,
        close = user_account,
    )]
    pub nonce_check_account: Account<'info, NonceCheckAccount>,

    /// The trade detail PDA that contains the trade information.
    #[account(
        mut,
        seeds = [&claim_args.trade_id],
        bump,
        owner = ID,
        // close = user_account,
    )]
    pub user_trade_detail: Account<'info, TradeDetail>,

    /// The trade vault PDA that corresponds to the trade.
    #[account(
        mut,
        seeds = [TradeVault::SEED, &claim_args.trade_id],
        bump,
        owner = ID, // This PDA must come from our smart-contract
    )]
    pub vault: Account<'info, TradeVault>,

    /// CHECK:
    /// 
    /// The refund account of the trade.
    /// Must be the [TradeDetail::refund_pubkey]
    #[account(
        mut,
        address = user_trade_detail.refund_pubkey @ PetaFiError::InvalidRefundPubkey, // Check refund_pubkey
    )]
    pub refund_account: UncheckedAccount<'info>,

    /// System program.
    pub system_program: Program<'info, System>,
}
