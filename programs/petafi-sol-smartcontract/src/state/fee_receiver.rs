use anchor_lang::prelude::*;

/// The fee receiver PDA account that contains the fee receiver information.
#[account]
#[derive(InitSpace)]
pub struct FeeReceiver {
    /// The pubkey of the fee receiver.
    pub receiver: Pubkey,
    /// The reserve of the fee receiver, used for future use.
    pub _reserve: [u128; 4],
}

impl FeeReceiver {
    pub const SEED: &'static [u8] = b"fee_receiver";
}
