//! This module contains the error codes for the protocol.
use anchor_lang::error_code;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum CustomError {
    InvalidTradeId,
    InvalidTimeout,
    Unauthorized,
    InvalidPublicKey,
    DepositZeroAmount,
    InvalidAmount,
    InvalidMintKey,
    InvalidSourceAta,
    InvalidDestinationAta,
    TimeOut,
    InvalidRefundPubkey,
    ClaimNotAvailable,
    DeadlineExceeded,
    InvalidUserAccount,
    NonceAccountBeingUsed,
    OperatorAlreadyExists,
    OperatorNotFound,
    OperatorLimitReached,
    NotWhitelistedToken,
    InvalidTradeStatus,
    CloseNotAvailable,
    InvalidTokenAccount,
    InvalidTotalFee,
    InvalidFeeReceiver,
}
