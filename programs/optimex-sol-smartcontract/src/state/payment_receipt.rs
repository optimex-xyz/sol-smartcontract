use anchor_lang::prelude::*;

use crate::CustomError;

/// The payment receipt PDA account that contains the payment receipt information.
#[account]
#[derive(Debug, InitSpace)]
pub struct PaymentReceipt {
    /// The trade id of the payment receipt.
    pub trade_id: [u8; 32],
    /// The from pubkey of the payment receipt. Who paid the payment.
    pub from_pubkey: Pubkey,
    /// The to pubkey of the payment receipt. Who received the payment.
    pub to_pubkey: Pubkey,
    /// The token of the payment receipt. None if the payment is SOL.
    pub token: Option<Pubkey>,
    /// The payment amount of the payment receipt, included fee, with decimals.
    pub payment_amount: u64,
    /// The total fee of the payment receipt, with decimals.
    pub total_fee: u64,
    /// The time that the payment is made.
    pub payment_time: u64,
    /// The reserve field space, used to upgrade in the future.
    pub _reserve: [u128; 8],
}

impl PaymentReceipt {
    pub const SEED: &'static [u8] = b"payment_receipt";
    pub fn assign_value(
        &mut self,
        trade_id: [u8; 32],
        from_pubkey: Pubkey,
        to_pubkey: Pubkey,
        token: Option<Pubkey>,
        payment_amount: u64,
        total_fee: u64,
    ) -> Result<()> {
        self.trade_id = trade_id;
        self.from_pubkey = from_pubkey;
        self.to_pubkey = to_pubkey;
        self.token = token;
        self.payment_amount = payment_amount;
        self.total_fee = total_fee;
        self.payment_time = Clock::get()?.unix_timestamp as u64;
        Ok(())
    }

    pub fn assert_close(&self, close_wait_duration: u64) -> Result<()> {
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp as u64;
        if current_timestamp  <= self.payment_time + close_wait_duration  {
            return Err(CustomError::CloseNotAvailable.into());
        }
        Ok(())
    }
}
