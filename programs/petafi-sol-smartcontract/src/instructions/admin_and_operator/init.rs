//! This module contains the logic for initializing the protocol.
use anchor_lang::prelude::*;
use crate::state::Config;

use crate::program::PetaFiSolSmartcontract;

/// Parameters required for the init function.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitArgs {
    /// The admin of the protocol. If this is not none, the instruction will set the admin.
    pub admin: Option<Pubkey>,
}

/// Handles the initialization of the protocol.
/// 
/// # Arguments
/// * `ctx` - A [Context] of [Init] required for initialization
/// * `init_args` - An [InitArgs] required for initialization
pub fn handler_init(ctx: Context<Init>, init_args: InitArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(admin) = init_args.admin {
        config.admin = admin;
    }
    Ok(())
}

/// The context accounts required for the init instruction.
#[derive(Accounts)]
pub struct Init<'info> {
    /// The signer account that is authorized to perform the init instruction.
    /// Must be the upgrade authority.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The vault PDA account. 
    #[account(
        init_if_needed,
        payer = signer,
        space = 0,
        seeds = [b"vault"],
        bump,
    )]
    /// CHECK:
    pub vault: UncheckedAccount<'info>,

    /// The protocol PDA account.
    #[account(
        init_if_needed,
        payer = signer,
        space = 0,
        seeds = [b"protocol"],
        bump,
    )]
    /// CHECK:
    pub protocol: UncheckedAccount<'info>,

    /// The config PDA account that contains the protocol configuration.
    #[account(
        init_if_needed,
        payer = signer,
        space = Config::SPACE,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// System program.
    pub system_program: Program<'info, System>,

    /// The program account that contains the protocol program data.
    /// Must be the program account.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, PetaFiSolSmartcontract>,

    /// The program data account that contains metadata about the program.
    /// Must be the program data account.
    #[account(constraint = program_data.upgrade_authority_address == Some(signer.key()))]
    pub program_data: Account<'info, ProgramData>,
}
