//! This module contains the events for the protocol.
use anchor_lang::prelude::*;

#[event]
/**
    - @dev Event emitted when a user successfully deposits tokens or SOL
    - Related function: deposit()
*/
pub struct Deposited {
    pub trade_id: [u8; 32],
    pub from_pubkey: Pubkey,
    pub token: Option<Pubkey>,
    pub amount: u64,
    pub vault: Pubkey,
}

/**
    - @dev Event emitted when MPC successfully settles the trade
    - Related function: settlement()
*/
#[event]
pub struct Settled {
    pub trade_id: [u8; 32],
    pub operator: Pubkey,
    pub to_pubkey: Pubkey,
    pub token: Option<Pubkey>,
    pub settlement_amount: u64, // amount after fee
    pub total_fee: u64,
    pub vault: Pubkey,
    pub protocol: Pubkey,
}

/**
    - @dev Event emitted when a user successfully claims the deposit after timeout
    - Related function: claim()
*/
#[event]
pub struct Claimed {
    pub trade_id: [u8; 32],
    pub token: Option<Pubkey>,
    pub to_pubkey: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
}

/**
    - @dev Event emitted when PMM successfully settle the payment
    - Related function: payment();
*/
#[event]
pub struct PaymentTransferred {
    pub trade_id: [u8; 32],
    pub from_pubkey: Pubkey,
    pub to_pubkey: Pubkey,
    pub token: Option<Pubkey>,
    pub payment_amount: u64,  // payment amount after fee
    pub total_fee: u64,
    pub protocol: Pubkey,
}
