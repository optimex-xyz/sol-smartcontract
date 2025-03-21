use anchor_lang::prelude::*;

/// The whitelist token PDA account that contains the whitelist token information.
#[account()]
#[derive(InitSpace)]
pub struct WhitelistToken {
    /// The token of the whitelist token.
    /// Whitelist for SOL use WSOL Pubkey.
    pub token: Pubkey,
    /// The minimum amount of the whitelist token.
    pub amount: u64,
    /// The reserve field space, used to upgrade in the future.
    pub _reserve: [u128; 4],
}

impl WhitelistToken {
    pub const SEED: &'static [u8] = b"whitelist";

    pub fn initialize(&mut self, token: Pubkey, amount: u64) -> Result<()> {
        self.token = token;
        self.amount = amount;

        Ok(())
    }
}