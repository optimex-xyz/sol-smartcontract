//! This module contains the logic for depositing the trade.
use crate::{constants::*, error::CustomError, state::*, utils::*, ID};
use anchor_lang::prelude::*;

/// Parameters rquired for the deposit function
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct DepositArgs {
    /// Input trade information.
    pub input: TradeInput,
    /// Detailed trade data.
    pub data: TradeDetailInput,
    /// The tradeId, unique identifier for the trade.
    pub trade_id: [u8; 32],
}

#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TradeDetailInput {
    pub timeout: i64,
    pub mpc_pubkey: Pubkey,
    pub refund_pubkey: Pubkey,
}

/// Handles the deposit of either tokens or SOL into the vault
/// # Arguments
/// * `ctx` - A [Context] of [DepositAccounts] required for the deposit.
/// * `deposit_args` - An argument [DepositArgs] required for the deposit.
/// # Errors 
/// * [CustomError::NotWhitelistedToken] when the token is not whitelisted.
/// * [CustomError::NonceAccountBeingUsed] when the nonce account is being used by another trade, or not yet closed.
/// * [CustomError::Unauthorized] when the signer is not match with the pubkey in the [DepositArgs]
/// * [CustomError::InvalidTimeout] when the current timestamp is greater than the deposit timeout.
/// * [CustomError::DepositZeroAmount] when the deposit amount is zero.
/// * [CustomError::InvalidAmount] when the deposit amount is less than the whitelisted amount.
/// * [CustomError::InvalidTradeId] when the calculated trade ID is not match with the trade ID in the [DepositArgs].
/// * [CustomError::InvalidMintKey] when the mint key is not match with the mint of the trade.
/// * [CustomError::InvalidSourceAta] when the source to transfer from is not the associated token account of the signer and mint.
/// * [CustomError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the vault and mint.
pub fn handler_deposit<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, DepositAccounts<'info>>,
    deposit_args: DepositArgs,
) -> Result<()> {
    // Extract account information
    let signer = &ctx.accounts.signer.to_account_info();
    let vault = &ctx.accounts.vault.to_account_info();
    let user_trade_detail = &mut ctx.accounts.user_trade_detail;
    let ephemeral_account = &ctx.accounts.ephemeral_account.to_account_info();
    let whitelist_token = &ctx.accounts.whitelist_token;

    // Check ephemeral account exists to prevent multiple trade uses the same nonce account
    // Deposit using existed and available nonce account will likely be rejected when settle
    if !ephemeral_account.data_is_empty() {
        return Err(CustomError::NonceAccountBeingUsed.into());
    }

    // Validate the signer's public key
    let from_user_pubkey_bytes: &Vec<u8> = &deposit_args.input.trade_info.from_chain[0];
    let user_key_input = vec_u8_to_publickey(from_user_pubkey_bytes)?;

    assert_keys_equal(&user_key_input, signer.key, CustomError::Unauthorized)?;

    let from_token_pubkey_bytes: &Vec<u8> = &deposit_args.input.trade_info.from_chain[2];
    let from_token_pubkey = vec_u8_to_address(from_token_pubkey_bytes)?;

    // Check if the deposit is within the allowed time frame
    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp;
    if current_timestamp > deposit_args.data.timeout {
        return err!(CustomError::InvalidTimeout);
    }

    // Validate the deposit amount
    let number_from_bytes = bytes_to_u64_number(&deposit_args.input.trade_info.amount_in)?;
    if number_from_bytes <= 0 {
        return err!(CustomError::DepositZeroAmount);
    }

    if whitelist_token.amount > number_from_bytes {
        return err!(CustomError::InvalidAmount);
    }

    // Calculate and validate the trade ID
    let trade_id = deposit_args.input.calculate_trade_id();
    if trade_id != deposit_args.trade_id {
        return err!(CustomError::InvalidTradeId);
    }

    // Handle token or SOL deposit
    // Transfer asset from the signer to the vault
    match from_token_pubkey {
        Some(token_pubkey) => {
            assert_keys_equal(
                &token_pubkey,
                &whitelist_token.token,
                CustomError::NotWhitelistedToken,
            )?;
            transfer_spl_token(
                &mut ctx.remaining_accounts.iter(),
                &token_pubkey,
                &signer.key,
                &vault.key,
                signer,
                number_from_bytes,
                &[],
                None,
            )?;
        }
        None => {
            // In case of native SOL deposit, we use whitelist token WSOL
            assert_keys_equal(
                &WSOL_MINT,
                &whitelist_token.token,
                CustomError::NotWhitelistedToken,
            )?;
            // SOL deposit
            transfer_sol(signer, vault, number_from_bytes)?;
        }
    }

    // Assign value for user's trade detail
    user_trade_detail.assign_value(
        &deposit_args,
        number_from_bytes,
        from_token_pubkey,
        signer.key(),
        ephemeral_account.key(),
    )?;

    Ok(())
}

/// The context accounts required for the deposit instruction.
#[derive(Accounts)]
#[instruction(deposit_args: DepositArgs)]
pub struct DepositAccounts<'info> {
    /// The signer account that is authorized to perform the deposit instruction.
    /// This is the account that perform the deposit.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// The trade detail PDA that contains the trade information.
    /// This PDA will be initialized by the instruction.
    #[account(
        init,
        payer = signer,
        space = 8 + TradeDetail::INIT_SPACE,
        seeds = [&deposit_args.trade_id,],
        bump
    )]
    pub user_trade_detail: Account<'info, TradeDetail>,

    /// CHECK: User ephemeral account, used as nonce account too.
    #[account(mut)]
    pub ephemeral_account: Signer<'info>,

    /// CHECK: The nonce check account, used to check the nonce account is being used by another trade, or not yet closed.
    /// This PDA will be initialized by the instruction.
    #[account(
        init,
        payer = signer,
        space = 8,
        seeds = [NonceCheckAccount::SEED, ephemeral_account.key.as_ref()],
        bump,
    )]
    pub nonce_check_account: Account<'info, NonceCheckAccount>,

    /// The trade vault PDA that corresponds to the trade.
    /// This PDA will be initialized by the instruction.
    #[account(
        init,
        space = 8 + TradeVault::INIT_SPACE,
        payer = signer,
        seeds = [TradeVault::SEED, &deposit_args.trade_id],
        bump,
    )]
    pub vault: Account<'info, TradeVault>,

    /// CHECK
    /// The whitelist token PDA, only token has been whitelisted can be deposited
    #[account(
        owner = ID @ CustomError::NotWhitelistedToken,  // This PDA must come from our smart-contract
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,
    pub system_program: Program<'info, System>,
}
