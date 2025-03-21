use crate::CustomError;
use crate::DepositArgs;

use anchor_lang::prelude::*;
use ethabi::ethereum_types::{H160, U256};
use ethabi::{encode, Token};
use sha2::{Digest, Sha256};

/// The trade input when depositting. Contains required information for the trade.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TradeInput {
    /// The sessionId, unique identifier for the trade.
    pub session_id: [u8; 32],  
    /// The solver address, the address of the solver.
    pub solver: [u8; 20],      
    /// The trade information, contains the information about the origin and destination of the trade.
    pub trade_info: TradeInfo, 
}

/// The trade information, contains the information about the origin and destination of the trade.
#[derive(Debug, InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct TradeInfo {
    /// The amount in of the trade.
    pub amount_in: [u8; 32], // uint256
    /// Encode the origin chain information: The user_address, the network_id, the token_address.
    #[max_len(3)] 
    pub from_chain: [Vec<u8>; 3], 
    /// Encode the destination chain information: The user_address, the network_id, the token_address.
    #[max_len(3)] 
    pub to_chain: [Vec<u8>; 3], 
}

impl TradeInput {
    fn encode_trade_input(&self) -> Vec<u8> {
        // 1. Session ID: uint256 (left-padded)
        let session_id = U256::from_big_endian(&self.session_id);

        // 2. Solver address: address (left-padded to 32 bytes)
        let solver_address = H160::from_slice(&self.solver);

        // 3. Trade Info tuple
        // 3.1 amount_in: uint256
        let amount_in = U256::from_big_endian(&self.trade_info.amount_in);

        // 3.2 from_chain: bytes[3] (fixed array of dynamic bytes)
        let from_chain_tokens: Vec<Token> = self
            .trade_info
            .from_chain
            .iter()
            .map(|bytes| {
                // Each element needs to be encoded as dynamic bytes
                Token::Bytes(bytes.clone())
            })
            .collect();

        // 3.3 to_chain: bytes[3] (fixed array of dynamic bytes)
        let to_chain_tokens: Vec<Token> = self
            .trade_info
            .to_chain
            .iter()
            .map(|bytes| {
                // Each element needs to be encoded as dynamic bytes
                Token::Bytes(bytes.clone())
            })
            .collect();

        // Create the trade info tuple with correct types
        let trade_info_token = Token::Tuple(vec![
            Token::Uint(amount_in),               // uint256
            Token::FixedArray(from_chain_tokens), // bytes[3]
            Token::FixedArray(to_chain_tokens),   // bytes[3]
        ]);

        // Encode everything
        let encoded = encode(&[
            Token::Uint(session_id),        // uint256
            Token::Address(solver_address), // address
            trade_info_token,               // tuple(uint256,bytes[3],bytes[3])
        ]);

        encoded
    }

    pub fn calculate_trade_id(&self) -> [u8; 32] {
        let encoded = self.encode_trade_input();

        let mut hasher = Sha256::new();
        hasher.update(&encoded);
        let result = hasher.finalize();

        let mut trade_id = [0u8; 32];
        trade_id.copy_from_slice(&result);

        trade_id
    }
}

/// The trade detail PDA account that contains the trade detail information.
#[account]
#[derive(Debug, InitSpace, Default)]
pub struct TradeDetail {
    /// The trade id of the trade, unique identifier for the trade.
    pub trade_id: [u8; 32],
    /// The depositor of the trade, who is performed the trade.
    pub user_pubkey: Pubkey,
    /// The token of the trade. None if the trade is SOL.
    pub token: Option<Pubkey>,
    /// The amount of the trade, with decimals.
    pub amount: u64,
    /// The timeout of the trade. After this time, the trade cannot be settled, only claimed.
    pub timeout: i64,
    /// The mpc of the trade, who is authorized to settle the trade.
    pub mpc_pubkey: Pubkey,
    /// The ephemeral pubkey of the trade.
    pub user_ephemeral_pubkey: Pubkey,
    /// The refund pubkey of the trade. This address will receive the amount when the trade is claimed.
    pub refund_pubkey: Pubkey,
    /// The total fee of the trade, with decimals.
    pub total_fee: Option<u64>,
    /// The status of the trade. 
    pub status: TradeStatus,
    /// The pmm that settled the trade.
    pub settled_pmm: Pubkey,
    /// The reserve space, used to upgrade in the future.
    pub _reserve: [u128; 8],
}

/// The trade status of the trade.
#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, InitSpace, PartialEq, Eq, Default)]
pub enum TradeStatus {
    /// When the trade is deposited. Then nothing happens.
    #[default]
    Deposited,
    /// When the trade is settled by mpc.
    Settled,
    /// When the trade is claimed by the user.
    Claimed,
}

impl TradeDetail {
    pub fn assign_value(
        &mut self,
        deposit_args: &DepositArgs,
        amount: u64,
        token: Option<Pubkey>,
        user_pubkey: Pubkey,
        user_ephemeral_pubkey: Pubkey,
    ) -> Result<()> {
        self.trade_id = deposit_args.trade_id;
        self.amount = amount;
        self.token = token;
        self.timeout = deposit_args.data.timeout;
        self.mpc_pubkey = deposit_args.data.mpc_pubkey;
        self.user_ephemeral_pubkey = user_ephemeral_pubkey;
        self.refund_pubkey = deposit_args.data.refund_pubkey;
        self.user_pubkey = user_pubkey;
        self.total_fee = None;
        self.status = TradeStatus::Deposited;

        Ok(())
    }

    pub fn assert_claim(&self) -> Result<()> {
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        if current_timestamp <= self.timeout {
            return Err(CustomError::ClaimNotAvailable.into());
        }
        if self.status != TradeStatus::Deposited {
            return Err(CustomError::InvalidTradeStatus.into());
        }

        Ok(())
    }

    pub fn assert_settlement(&self) -> Result<()> {
        let clock = Clock::get()?;
        let current_timestamp = clock.unix_timestamp;
        if current_timestamp > self.timeout {
            return Err(CustomError::TimeOut.into());
        }
        if self.status != TradeStatus::Deposited {
            return Err(CustomError::InvalidTradeStatus.into());
        }

        Ok(())
    }

    pub fn assert_close_finished_trade(
        &self,
        current_timestamp: u64,
        close_wait_duration: u64,
        is_mpc: bool,
    ) -> Result<()> {
        match self.status {
            // When the trade is deposited, this action is not allowed
            TradeStatus::Deposited => {
                return Err(CustomError::InvalidTradeStatus.into());
            }
            // When the trade is claimed, this action is allowed for anyone
            TradeStatus::Claimed => {
                return Ok(());
            }
            // When the trade is settled:
            // - This action is allowed for mpc
            // - This action is allowed for anyone when `timestamp > timeout + close_wait_duration`
            TradeStatus::Settled => {
                if is_mpc {
                    return Ok(());
                } else {
                    if current_timestamp <= (self.timeout as u64) + close_wait_duration {
                        return Err(CustomError::CloseNotAvailable.into());
                    }
                }
            }
        }

        Ok(())
    }
}

#[account()]
#[derive(Debug, InitSpace)]
pub struct TradeVault {}

impl TradeVault {
    pub const SEED: &'static [u8] = b"vault";
}

#[test]
pub fn test_assert_close_depsited_trade() {
    let mut trade_detail = TradeDetail::default();
    trade_detail.status = TradeStatus::Deposited;
    let result = trade_detail.assert_close_finished_trade(0, 0, true);
    assert_eq!(result.unwrap_err(), CustomError::InvalidTradeStatus.into());

    let result = trade_detail.assert_close_finished_trade(0, 0, false);
    assert_eq!(result.unwrap_err(), CustomError::InvalidTradeStatus.into());
}

#[test]
pub fn test_assert_close_settled_trade() {
    let mut trade_detail = TradeDetail::default();
    trade_detail.status = TradeStatus::Settled;
    trade_detail.timeout = 5;
    let result = trade_detail.assert_close_finished_trade(0, 0, true);
    assert!(result.is_ok());

    let result = trade_detail.assert_close_finished_trade(10, 0, true);
    assert!(result.is_ok());

    let result = trade_detail.assert_close_finished_trade(0, 0, false);
    assert_eq!(result.unwrap_err(), CustomError::CloseNotAvailable.into());

    let result = trade_detail.assert_close_finished_trade(5, 3, false);
    assert_eq!(result.unwrap_err(), CustomError::CloseNotAvailable.into());
}

pub fn test_assert_close_claimed_trade() {
    let mut trade_detail = TradeDetail::default();
    trade_detail.status = TradeStatus::Claimed;
    let result = trade_detail.assert_close_finished_trade(0, 0, true);
    assert!(result.is_ok());

    let result = trade_detail.assert_close_finished_trade(3, 100, false);
    assert!(result.is_ok());
}
