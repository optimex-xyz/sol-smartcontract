use anchor_lang::prelude::*;
use crate::error::PetaFiError;

/// The config PDA account that contains the protocol configuration.
#[account]
pub struct Config {
    /// The reserve field space, used to upgrade in the future.
    pub _reserve: [u128; 7],
    /// The admin account of the protocol. Set by the upgrade authority. Used to manage the operators.
    pub admin: Pubkey,
    /// The duration for closing a finished trade.
    pub close_trade_duration: u64,
    /// The duration for closing a payment receipt.
    pub close_payment_duration: u64,
    /// The operators of the protocol. Set by the admin. Used to manage close wait time and whitelist token.
    pub operators: Vec<Pubkey>,
}

impl Config {
    pub const OPERATORS_SIZE: usize = 3;
    pub const SPACE: usize = 8 + 16 * 7 + 32 + 8 + 8 + 4 + Config::OPERATORS_SIZE * 32;
    pub const SEED: &'static [u8] = b"config";

    pub fn add_operator(&mut self, operator: Pubkey) -> Result<()> {
        if self.operators.contains(&operator) {
            return Err(PetaFiError::OperatorAlreadyExists.into());
        }
        if self.operators.len() >= Config::OPERATORS_SIZE {
            return Err(PetaFiError::OperatorLimitReached.into());
        }
        self.operators.push(operator);
        Ok(())
    }

    pub fn remove_operator(&mut self, operator: Pubkey) -> Result<()> {
        if !self.operators.contains(&operator) {
            return Err(PetaFiError::OperatorNotFound.into());
        }
        self.operators.retain(|op| op != &operator);
        Ok(())
    }

    pub fn set_close_trade_duration(&mut self, duration: Option<u64>) -> Result<()> {
        if let Some(duration) = duration {
            self.close_trade_duration = duration;
        }
        Ok(())
    }

    pub fn set_close_payment_duration(&mut self, duration: Option<u64>) -> Result<()> {
        if let Some(duration) = duration {
            self.close_payment_duration = duration;
        }
        Ok(())
    }
}
