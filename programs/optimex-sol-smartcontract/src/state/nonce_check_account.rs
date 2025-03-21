use anchor_lang::prelude::*;

/// The nonce check PDA account that contains the nonce check information.
#[account]
pub struct NonceCheckAccount {
}

impl NonceCheckAccount {
    pub const SEED: &'static [u8] = b"nonce";
}
