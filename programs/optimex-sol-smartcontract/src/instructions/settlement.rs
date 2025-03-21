//! This module contains the logic for the settlement instruction.
use anchor_lang::prelude::*;

use crate::{error::CustomError, event::*, state::*, utils::*, ID};

/// Parameters rquired for the settlement function
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SettlementArgs {
    /// The tradeId, unique identifier for the trade
    pub trade_id: [u8; 32], // uint256
}

/// Handles the settlement of the trade. 
/// # Arguments
/// * `ctx` - A [Context] of [SettlementAccounts] required for settling the trade.
/// * `payment_args` - An argument [SettlementArgs] required for settling the trade.
/// # Errors
/// * [CustomError::Unauthorized] when the caller is not authorized by both [TradeDetail::mpc_pubkey] and [TradeDetail::user_ephemeral_pubkey].
/// * [CustomError::InvalidUserAccount] when the user account is not match with [TradeDetail::user_pubkey].
/// * [CustomError::InvalidRefundPubkey] when the refund pubkey is not match with [TradeDetail::refund_pubkey].
/// * [CustomError::TimeOut] when the trade timeout is expired, so we cannot settle the trade anymore.
/// * [CustomError::InvalidTradeStatus] when the trade status is not [TradeStatus::Deposited]. We only can settle the trade has deposited status.
/// * [CustomError::InvalidMintKey] when the mint key is not match with the mint of the trade.
/// * [CustomError::InvalidSourceAta] when the source to transfer from is not the associated token account of the vault and mint.
/// * [CustomError::InvalidDestinationAta] when the destination to transfer settlement amount is not the associated token account of the pmm and mint.
/// * [CustomError::InvalidDestinationAta] when the destination to transfer total fee is not the associated token account of the protocol and mint.
pub fn handler_settlement<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, SettlementAccounts<'info>>,
    settlement_args: SettlementArgs,
) -> Result<()> {
    let vault = &ctx.accounts.vault.to_account_info();
    let signer = &ctx.accounts.signer;
    let pmm = &ctx.accounts.pmm.to_account_info();
    let user_trade_detail = &mut ctx.accounts.user_trade_detail;

    // Check if the trade is able to settled
    user_trade_detail.assert_settlement()?;

    // Calculate the settlement amount after deducting the protocol fee
    let total_fee = match user_trade_detail.total_fee {
        Some(fee) => fee,
        None => 0,
    };
    let settlement_amount = user_trade_detail.amount - total_fee;

    // Handle token or SOL settlement
    // Transfer asset from the vault to the pmm and protocol
    match user_trade_detail.token {
        Some(token_pubkey) => {
            let seeds: &[&[u8]] = &[b"vault", &settlement_args.trade_id];
            let (_, bump) = Pubkey::find_program_address(&seeds, &ID);
            let seeds_signer = &mut seeds.to_vec();
            let binding = [bump];
            seeds_signer.push(&binding);

            transfer_spl_token(
                &mut ctx.remaining_accounts.iter(),
                &token_pubkey,
                &vault.key,
                &pmm.key(),
                &vault.clone(),
                settlement_amount,
                &[seeds_signer],
                user_trade_detail.total_fee,
            )?;
        }
        None => {
            // transfer SOL from vault to pmm and protocol
            **vault.to_account_info().try_borrow_mut_lamports()? -= user_trade_detail.amount;
            **pmm.try_borrow_mut_lamports()? += settlement_amount;

            if total_fee != 0 {
                **ctx.accounts.protocol.try_borrow_mut_lamports()? += total_fee;
            }
        }
    }
    user_trade_detail.status = TradeStatus::Settled;
    user_trade_detail.settled_pmm = pmm.key();

    // Emit settlement event
    emit!(Settled {
        trade_id: settlement_args.trade_id,
        token: user_trade_detail.token,
        to_pubkey: pmm.key(),
        operator: signer.key(),
        settlement_amount: settlement_amount,
        total_fee: total_fee,
        vault: vault.key(),
        protocol: ctx.accounts.protocol.key(),
    });

    Ok(())
}

/// Context accounts for the settlement instruction.
#[derive(Accounts)]
#[instruction(settlement_args: SettlementArgs)]
pub struct SettlementAccounts<'info> {
    /// The signer who is authorized to settle the trade.
    /// Must be the [TradeDetail::mpc_pubkey]
    #[account(
        mut,
        address = user_trade_detail.mpc_pubkey @ CustomError::Unauthorized // Check authorization
    )]
    pub signer: Signer<'info>,

    /// CHECK:
    /// The user account that is the depositor of the trade. This account will receive the rent fee of the nonce check account PDA.
    /// Must be the [TradeDetail::user_pubkey].
    #[account(
        mut,
        address =  user_trade_detail.user_pubkey @ CustomError::InvalidUserAccount, // check user account
    )]
    pub user_account: UncheckedAccount<'info>,

    /// The user ephemeral account of the trade, need to sign this transaction too.
    /// Must be the [TradeDetail::user_ephemeral_pubkey].
    #[account(
        address = user_trade_detail.user_ephemeral_pubkey @ CustomError::Unauthorized, // Check user ephemeral pubkey
    )]
    pub user_ephemeral_account: Signer<'info>,

    /// The user trade detail PDA that contains the trade information.
    #[account(
        mut,
        seeds = [&settlement_args.trade_id],
        bump,
        owner = ID,
        // close = user_account, // Sending the lamports to the user account when closing user_trade_detail
    )]
    pub user_trade_detail: Account<'info, TradeDetail>,

    /// The nonce check account PDA, used to check the nonce account is being used by another trade, or not yet closed.
    /// This PDA will be closed by the instruction.
    #[account(
        mut,
        seeds = [NonceCheckAccount::SEED, user_ephemeral_account.key().as_ref()],
        bump,
        close = user_account,
    )]
    pub nonce_check_account: Account<'info, NonceCheckAccount>,

    /// The trade vault PDA that corresponds to the trade.
    #[account(
        mut,
        seeds = [TradeVault::SEED, &settlement_args.trade_id],
        bump,
        owner = ID, // This PDA must come from our smart-contract
    )]
    pub vault: Account<'info, TradeVault>,

    /// CHECK:
    /// The refund account of the trade.
    /// Must be the [TradeDetail::refund_pubkey].
    #[account(
        mut,
        address = user_trade_detail.refund_pubkey @ CustomError::InvalidRefundPubkey // Check refund_pubkey
    )]
    pub refund_account: UncheckedAccount<'info>,

    /// CHECK:
    /// The protocol PDA account.
    #[account(
        mut,
        seeds = [b"protocol"],
        bump,
        owner = ID, // This PDA must come from our smart-contract
    )]
    pub protocol: UncheckedAccount<'info>,

    /// CHECK:
    /// The pmm account.
    #[account(mut)]
    pub pmm: UncheckedAccount<'info>,

    /// System program.
    pub system_program: Program<'info, System>,
}
