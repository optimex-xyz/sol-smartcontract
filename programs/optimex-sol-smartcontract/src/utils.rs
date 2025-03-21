//! This module contains the some utilities that are used in the protocol.
use std::slice::Iter;
use std::str::FromStr;

use crate::{CustomError, ID};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::program_memory::sol_memcmp;
use anchor_lang::solana_program::pubkey::PUBKEY_BYTES;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::spl_token::instruction::transfer_checked;
use anchor_spl::token::Mint;

/// Compares two public keys for equality.
pub fn cmp_pubkeys(a: &Pubkey, b: &Pubkey) -> bool {
    sol_memcmp(a.as_ref(), b.as_ref(), PUBKEY_BYTES) == 0
}

/// Asserts that two public keys are equal, returning an error if they are not.
pub fn assert_keys_equal(key1: &Pubkey, key2: &Pubkey, error_type: CustomError) -> Result<()> {
    if !cmp_pubkeys(key1, key2) {
        return Err(error_type.into());
    } else {
        Ok(())
    }
}

/// Converts a byte array to a u64 number.
pub fn bytes_to_u64_number(amount_in_bytes: &[u8]) -> u64 {
    // Find first non-zero byte from left (big-endian)
    let mut start_idx = 0;
    while start_idx < amount_in_bytes.len() && amount_in_bytes[start_idx] == 0 {
        start_idx += 1;
    }

    // Take last 8 bytes that contain the value
    let value_bytes = if amount_in_bytes.len() - start_idx >= 8 {
        let end_idx = amount_in_bytes.len();
        let start_idx = end_idx - 8;
        &amount_in_bytes[start_idx..end_idx]
    } else {
        &amount_in_bytes[start_idx..]
    };

    // Convert to u64 (big-endian)
    let mut amount_bytes = [0u8; 8];
    amount_bytes[8 - value_bytes.len()..].copy_from_slice(value_bytes);

    u64::from_be_bytes(amount_bytes)
}

/// Transfers SPL tokens from one account to another, optionally including a protocol fee.
pub fn transfer_spl_token<'c: 'info, 'info>(
    list_remaining_accounts: &mut Iter<'info, AccountInfo<'info>>,
    token_pubkey: &Pubkey,
    from_pubkey: &Pubkey,
    to_pubkey: &Pubkey,
    authority: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
    fee_amount: Option<u64>,
) -> Result<()> {
    let token_program = next_account_info(list_remaining_accounts)?;
    let mint = next_account_info(list_remaining_accounts)?;
    let source = next_account_info(list_remaining_accounts)?;
    let destination = next_account_info(list_remaining_accounts)?;

    assert_keys_equal(&mint.key(), &token_pubkey, CustomError::InvalidMintKey)?;
    let mint_data: Account<Mint> = Account::try_from(mint)?;

    // Validate source key (vault ata)
    let source_key =
        get_associated_token_address_with_program_id(&from_pubkey, &mint.key, &token_program.key);
    assert_keys_equal(&source.key(), &source_key, CustomError::InvalidSourceAta)?;

    // Validate destination key (pmm ata)
    let destination_key =
        get_associated_token_address_with_program_id(to_pubkey, mint.key, token_program.key);
    assert_keys_equal(
        &destination.key(),
        &destination_key,
        CustomError::InvalidDestinationAta,
    )?;

    transfer_spl_token_internal(
        token_program,
        mint,
        source,
        destination,
        authority,
        amount,
        mint_data.decimals,
        seeds,
    )?;

    match fee_amount {
        Some(fee) => {
            let (protocol_pubkey, _) = Pubkey::find_program_address(&[b"protocol"], &ID);

            // Transfer protocol fee to protocol account
            let protocol_ata_key = get_associated_token_address_with_program_id(
                &protocol_pubkey,
                mint.key,
                &token_program.key,
            );

            let protocol_ata = next_account_info(list_remaining_accounts)?;

            // Validate destination key (protocol ata)
            assert_keys_equal(
                &protocol_ata.key(),
                &protocol_ata_key,
                CustomError::InvalidDestinationAta,
            )?;

            transfer_spl_token_internal(
                token_program,
                mint,
                source,
                protocol_ata,
                authority,
                fee,
                mint_data.decimals,
                seeds,
            )?;
        }
        None => {}
    }

    Ok(())
}

/// Internal function to transfer SPL tokens.
pub fn transfer_spl_token_internal<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let transfer_instruction = transfer_checked(
        &token_program.key,
        &source.key,
        &mint.key,
        &destination.key,
        &authority.key,
        &[],
        amount,
        decimals,
    );

    invoke_signed(
        &transfer_instruction.unwrap(),
        &[
            token_program.clone(),
            source.clone(),
            mint.clone(),
            destination.clone(),
            authority.clone(),
        ],
        seeds,
    )?;

    Ok(())
}

/// Transfers SOL from one account to another.
pub fn transfer_sol<'info>(
    source: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    invoke(
        &system_instruction::transfer(&source.key(), &destination.key(), amount),
        &[source.clone(), destination.clone()],
    )?;
    Ok(())
}

pub fn vec_u8_to_publickey(v: &Vec<u8>) -> Result<Pubkey> {
    let key_str = String::from_utf8(v.to_vec()).map_err(|_| CustomError::InvalidPublicKey)?;
    let result = Pubkey::from_str(&key_str).map_err(|_| CustomError::InvalidPublicKey)?;
    Ok(result)
}
/// Convert vec u8 unicode to address
/// Null if the address is native
/// Otherwise, return the pubkey
/// Return InvalidPublicKey if the address is not valid
pub fn vec_u8_to_address(v: &Vec<u8>) -> Result<Option<Pubkey>> {
    let key_str = String::from_utf8(v.to_vec()).map_err(|_| CustomError::InvalidPublicKey)?;
    match key_str.as_str() {
        "native" => Ok(None),
        _ => Ok(Some(Pubkey::from_str(&key_str).map_err(|_| CustomError::InvalidPublicKey)?)),
    }
}

#[test]
fn test_vec_u8_to_publickey() {
    let original_pubkey = Pubkey::from_str("3DYbLvuRV6tZN7iEBxAgHbpgv3AvWmAJGtWmrkp24Vew").unwrap();
    let v: Vec<u8> = vec![
        51,  68,  89, 98,  76, 118, 117,  82,  86,
        54, 116,  90, 78,  55, 105,  69,  66, 120,
        65, 103,  72, 98, 112, 103, 118,  51,  65,
       118,  87, 109, 65,  74,  71, 116,  87, 109,
       114, 107, 112, 50,  52,  86, 101, 119
     ];
    let x = vec_u8_to_publickey(&v).unwrap();
    assert!(cmp_pubkeys(&x,  &original_pubkey));
}
