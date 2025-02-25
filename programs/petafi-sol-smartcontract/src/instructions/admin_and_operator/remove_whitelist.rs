//! This module contains the logic for removing the whitelist token for the protocol.
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use crate::state::*;
use crate::PetaFiError;

/// The context accounts required for the remove whitelist instruction.
#[derive(Accounts)]
pub struct RemoveWhitelist<'info> {
    /// The operator that is authorized to perform the remove whitelist instruction.
    /// Must be the [Config::operators]
    #[account(
        mut,
        constraint = config.operators.contains(operator.key) @ PetaFiError::Unauthorized,
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
        mut,
        close = operator,
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,

    /// The mint token account that we want to remove whitelist.
    #[account()]
    pub token: Box<Account<'info, Mint>>,
    
    /// System program.
    pub system_program: Program<'info, System>,
}

/// Handles the removing the whitelist token for the protocol.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [RemoveWhitelist] required for removing the whitelist.
/// # Errors
/// * [PetaFiError::Unauthorized] when the caller is not authorized, or not the operator.
pub fn handler_remove_whitelist(_ctx: Context<RemoveWhitelist>) -> Result<()> {
    Ok(())
}