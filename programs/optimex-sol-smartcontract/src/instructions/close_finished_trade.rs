//! This module contains the logic for closing the finished (settled or claimed) trade.
use crate::{assert_keys_equal, error::CustomError, state::*};
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::{self, Token, TokenAccount},
};

/// Parameters rquired for the deposit function.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct CloseFinishedTradeArgs {
    /// The tradeId, unique identifier for the trade.
    pub trade_id: [u8; 32],
}

/// Handles the close of the finished trade.
///
/// # Arguments
/// * `ctx` - A [Context] of [CloseFinishedTradeAccounts] required for closing the trade.
/// * `_close_finished_trade_args` - An argument [CloseFinishedTradeArgs] required for closing the trade.
/// # Errors
/// * [CustomError::InvalidUserAccount] when the user account is not match to [TradeDetail::user_pubkey]. This account will receive the claimed rent fee.
/// * [CustomError::InvalidTradeStatus] when the trade status is [TradeStatus::Deposited].
/// * [CustomError::CloseNotAvailable] when the trade is not the available time to close.
pub fn handler_close_finished_trade<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, CloseFinishedTradeAccounts<'info>>,
    close_finished_trade_args: CloseFinishedTradeArgs,
) -> Result<()> {
    // Extract account information
    let config = &ctx.accounts.config;
    let vault = &ctx.accounts.vault;
    let user_account = &ctx.accounts.user_account;
    let user_trade_detail = &mut ctx.accounts.user_trade_detail;
    let vault_token_account = &ctx.accounts.vault_token_account;
    let user_token_account = &ctx.accounts.user_token_account;
    let is_mpc = ctx.accounts.signer.key() == user_trade_detail.mpc_pubkey;
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    user_trade_detail.assert_close_finished_trade(
        current_timestamp,
        config.close_trade_duration,
        is_mpc,
    )?;

    match user_trade_detail.token {
        // If trade is with token, close the token account
        Some(token) => {
            if vault_token_account.is_none() || user_token_account.is_none() {
                return Err(CustomError::InvalidTokenAccount.into());
            }
            let vault_token_account = vault_token_account.as_ref().unwrap();
            let user_token_account = user_token_account.as_ref().unwrap();
            let calculated_vault_ta = get_associated_token_address_with_program_id(
                &vault.key(),
                &token,
                &ctx.accounts.token_program.key,
            );
            assert_keys_equal(
                &vault_token_account.key(),
                &calculated_vault_ta,
                CustomError::InvalidTokenAccount,
            )?;
            let calculated_user_ta = get_associated_token_address_with_program_id(
                &user_account.key(),
                &token,
                &ctx.accounts.token_program.key,
            );
            assert_keys_equal(
                &user_token_account.key(),
                &calculated_user_ta,
                CustomError::InvalidTokenAccount,
            )?;
            let seeds: &[&[u8]] = &[
                b"vault",
                &close_finished_trade_args.trade_id,
                &[ctx.bumps.vault],
            ];
            let seeds_signer = &mut seeds.to_vec();

            let remaining_amount = vault_token_account.amount;
            if remaining_amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: vault_token_account.to_account_info(),
                            to: user_token_account.to_account_info(),
                            authority: vault.to_account_info(),
                        },
                        &[seeds_signer],
                    ),
                    remaining_amount,
                )?;
            }
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: vault_token_account.to_account_info(),
                    destination: user_account.to_account_info(),
                    authority: vault.to_account_info(),
                },
                &[seeds_signer],
            ))?;
        }
        // If trade is with SOL, do nothing
        None => {}
    }

    Ok(())
}

/// The context accounts required for the close finished trade instruction.
#[derive(Accounts)]
#[instruction(close_finished_trade: CloseFinishedTradeArgs)]
pub struct CloseFinishedTradeAccounts<'info> {
    /// The signer account that is authorized to perform the close finished trade instruction.
    /// Depends on the trade status and timeout, the signer can be the MPC or anyone.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK:
    /// The user_account that receive the rent fee of closed account.
    /// Must be the [TradeDetail::user_pubkey]
    #[account(
        mut,
        address = user_trade_detail.user_pubkey @ CustomError::InvalidUserAccount,
    )]
    pub user_account: UncheckedAccount<'info>,

    /// The trade detail PDA that contains the trade information.
    /// This PDA will be closed by the instruction.
    #[account(
        mut,
        seeds = [&close_finished_trade.trade_id,],
        bump,
        close = user_account,
    )]
    pub user_trade_detail: Account<'info, TradeDetail>,

    /// The trade vault PDA that corresponds to the trade.
    /// This PDA will be closed by the instruction.
    #[account(
        mut,
        seeds = [TradeVault::SEED, &close_finished_trade.trade_id],
        bump,
        close = user_account,
    )]
    pub vault: Account<'info, TradeVault>,

    /// The config PDA that contains the protocol configuration.
    #[account(
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The token account of the trade.
    /// This account will be closed by the instruction.
    #[account(mut)]
    pub vault_token_account: Option<Account<'info, TokenAccount>>,

    /// The user token account that is used to receive the amount if someone transfer the token after closed the trade.
    #[account(mut)]
    pub user_token_account: Option<Account<'info, TokenAccount>>,

    /// The token program.
    pub token_program: Program<'info, Token>,
}
