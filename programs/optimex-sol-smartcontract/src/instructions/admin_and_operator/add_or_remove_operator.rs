//! This module contains the logic for adding or removing an operator for the protocol.
use anchor_lang::prelude::*;
use crate::state::Config;
use crate::error::CustomError;


/// Contains the logic for adding or removing an operator for the protocol.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [AddOrRemoveOperator] required for adding or removing an operator.
/// * `operator` - The operator to add or remove.
/// * `is_bool` - Whether to add or remove the operator.
/// # Errors
/// * [CustomError::Unauthorized] when the caller is not authorized, not the [Config::admin].
/// * [CustomError::OperatorAlreadyExists] when add a operator that is already exists.
/// * [CustomError::OperatorLimitReached] when add a operator and reach the limit of [Config::OPERATORS_SIZE].
/// * [CustomError::OperatorNotFound] when remove a operator that is not exists.
pub fn handler_add_or_remove_operator(ctx: Context<AddOrRemoveOperator>, operator: Pubkey, is_add: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if is_add {
        config.add_operator(operator)?;
    } else {
        config.remove_operator(operator)?;
    }
    Ok(())
}

/// The context accounts required for the add or remove operator instruction.
#[derive(Accounts)]
pub struct AddOrRemoveOperator<'info> {
    /// The signer account that is authorized to perform the add or remove operator instruction.
    /// Must be the [Config::admin]
    #[account(
        mut,
        address = config.admin @ CustomError::Unauthorized,
    )]
    pub signer: Signer<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        mut,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,
}
