//! This module contains the logic for adding or updating the whitelist token for the protocol.
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::state::*;
use crate::CustomError;

/// The context accounts required for the add or update whitelist instruction.
#[derive(Accounts)]
pub struct AddOrUpdateWhitelist<'info> {
    /// The operator that is authorized to perform the add or update whitelist instruction.
    /// Must be the [Config::operators]
    #[account(
        mut,
        constraint = config.operators.contains(operator.key) @ CustomError::Unauthorized,
    )]
    pub operator: Signer<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// The whitelist token PDA account that contains the whitelist token information.
    /// If SOL native, used WSOL PDA account.
    #[account(
        init_if_needed,
        payer = operator,
        space = 8 + WhitelistToken::INIT_SPACE,
        seeds = [WhitelistToken::SEED, token.key().as_ref()],
        bump,
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,

    /// The mint token account that we want to set whitelist.
    #[account()]
    pub token: Box<Account<'info, Mint>>,
    
    /// System program.
    pub system_program: Program<'info, System>,
}


/// Handles the adding or updating the whitelist token for the protocol.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [AddOrUpdateWhitelist] required for adding or updating the whitelist.
/// * `amount` - The minimum amount to set for the whitelisted token.
/// # Errors
/// * [CustomError::Unauthorized] - The caller is not authorized, or not the operator.
pub fn handler_add_or_update_whitelist(ctx: Context<AddOrUpdateWhitelist>, amount: u64) -> Result<()> {
    let token = &ctx.accounts.token;
    let whitelist_token = &mut ctx.accounts.whitelist_token;
    whitelist_token.initialize(token.key(), amount)
}