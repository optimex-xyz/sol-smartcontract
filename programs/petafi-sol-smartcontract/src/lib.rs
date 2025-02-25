//! This is solana program on the PetaFi protocol.
//! 
//! The participants on the PetaFi protocol take actions on Solana blockchain will interact with this program.
use anchor_lang::prelude::*;
pub mod error;
pub mod event;
mod instructions;
pub mod state;
pub mod utils;
pub mod constants;


pub use error::*;
pub use event::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("E2pt2s1vZjgf1eBzWhe69qDWawdFKD2u4FbLEFijSMJP");

/// This is the main module of the PetaFi protocol. Contains the instructions that are performed by the protocol.
#[cfg(feature = "default")]
#[program]
pub mod peta_fi_sol_smartcontract {
    use super::*;

    /// Initialize the program and some required accounts, setup [Config::admin] if needed
    /// 
    /// This instruction is called after the program is deployed, and is authorized by only the upgrade authority,
    /// # Arguments
    /// * `ctx` - A [Context] of [Init] required for initialization
    /// * `init_args` - An [InitArgs] required for initialization
    /// 
    /// # Errors
    /// * [PetaFiError::Unauthorized] when the caller is not the upgrade authority.
    pub fn init(ctx: Context<Init>, init_args: InitArgs) -> Result<()> {
        handler_init(ctx, init_args)
    }

    /// Add or remove an operator for the protocol.
    /// 
    /// This instruction is authorized by the [Config::admin].
    /// # Arguments
    /// * `ctx` - A [Context] of [AddOrRemoveOperator] required for adding or removing an operator.
    /// * `operator` - The operator to add or remove.
    /// * `is_bool` - Whether to add or remove the operator.
    /// # Errors
    /// * [PetaFiError::Unauthorized] when the caller is not authorized, not the [Config::admin].
    /// * [PetaFiError::OperatorAlreadyExists] when add a operator that is already exists.
    /// * [PetaFiError::OperatorLimitReached] when add a operator and reach the limit of [Config::OPERATORS_SIZE].
    /// * [PetaFiError::OperatorNotFound] when remove a operator that is not exists.
    pub fn add_or_remove_operator(ctx: Context<AddOrRemoveOperator>, operator: Pubkey, is_add: bool) -> Result<()> {
        handler_add_or_remove_operator(ctx, operator, is_add)
    }

    /// Add or update whitelist token setup.
    /// 
    /// This instruction is authorized by the [Config::operators].
    /// # Arguments
    /// * `ctx` - A [Context] of [AddOrUpdateWhitelist] required for adding or updating the whitelist.
    /// * `amount` - The minimum amount to set for the whitelisted token.
    /// # Errors
    /// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the operator.
    pub fn add_or_update_whitelist(ctx: Context<AddOrUpdateWhitelist>, amount: u64) -> Result<()> {
        handler_add_or_update_whitelist(ctx, amount)
    }

    /// Withdraw the total fee of the protocol to fee receiver.
    /// 
    /// This instruction is authorized by anyone.
    /// However, only account decaled as [FeeReceiver] can receive the fee.
    /// # Arguments
    /// * `ctx` - A [Context] of [WithdrawTotalFeeAccounts] required for withdrawing the total fee.
    /// * `withdraw_total_fee_args` - An argument [WithdrawTotalFeeArgs] required for withdrawing the total fee.
    /// # Errors
    /// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the admin.
    pub fn withdraw_total_fee<'c: 'info, 'info>(ctx: Context<'_, '_, 'c, 'info, WithdrawTotalFeeAccounts<'info>>, withdraw_total_fee_args: WithdrawTotalFeeArgs) -> Result<()> {
        handler_withdraw_total_fee(ctx, withdraw_total_fee_args)
    }

    /// Remove whitelist token setup.
    /// 
    /// This instruction is authorized by the operator.
    /// # Arguments
    /// * `ctx` - A [Context] of [RemoveWhitelist] required for removing the whitelist.
    /// # Errors
    /// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the operator.
    pub fn remove_whitelist(ctx: Context<RemoveWhitelist>) -> Result<()> {
        handler_remove_whitelist(ctx)
    }

    /// Handles the deposit of either tokens or SOL into the vault.
    /// 
    /// Only token that is set whitelisted can be deposited.
    /// 
    /// The [TradeDetail], [TradeVault], [NonceCheckAccount], [anchor_spl::token::TokenAccount] of vault and token mint, are created in this instruction.
    /// # Arguments
    /// * `ctx` - A [Context] of [DepositAccounts] required for the deposit.
    /// * `deposit_args` - An argument [DepositArgs] required for the deposit.
    /// # Errors 
    /// * [PetaFiError::NotWhitelistedToken] when the token is not whitelisted.
    /// * [PetaFiError::NonceAccountBeingUsed] when the nonce account is being used by another trade, or not yet closed.
    /// * [PetaFiError::Unauthorized] when the signer is not match with the pubkey in the [DepositArgs]
    /// * [PetaFiError::InvalidTimeout] when the current timestamp is greater than the deposit timeout.
    /// * [PetaFiError::DepositZeroAmount] when the deposit amount is zero.
    /// * [PetaFiError::InvalidAmount] when the deposit amount is less than the whitelisted amount.
    /// * [PetaFiError::InvalidTradeId] when the calculated trade ID is not match with the trade ID in the [DepositArgs].
    /// * [PetaFiError::InvalidMintKey] when the mint key is not match with the mint of the trade.
    /// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the signer and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the vault and mint.
    /// 
    pub fn deposit<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, DepositAccounts<'info>>,
        deposit_args: DepositArgs,
    ) -> Result<()> {
        handler_deposit(ctx, deposit_args)
    }

    /// The pmm perform the payment process to a specific trade.
    /// 
    /// Only token that is set whitelisted can be deposited. The [PaymentReceipt] is created in this instruction.
    /// 
    /// # Arguments
    /// * `ctx` - A [Context] of [PaymentAccounts] required for the payment.
    /// * `payment_args` - An argument [PaymentArgs] required for the payment.
    /// # Errors
    /// * [PetaFiError::NotWhitelistedToken] when the token is not whitelisted.
    /// * [PetaFiError::DeadlineExceeded] when the current timestamp is greater than the [PaymentArgs::deadline].
    /// * [PetaFiError::InvalidAmount] when the amount [PaymentArgs::amount] is less than the [PaymentArgs::total_fee].
    /// * [PetaFiError::InvalidMintKey] when the mint key is not match with the [PaymentReceipt::token].
    /// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the signer and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the [PaymentReceipt::to_pubkey] and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the protocol PDA and mint.
    pub fn payment<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, PaymentAccounts<'info>>,
        payment_args: PaymentArgs,
    ) -> Result<()> {
        handler_payment(ctx, payment_args)
    }

    /// Set the total fee for a specific trade.
    /// 
    /// This instruction is authorized by [TradeDetail::mpc_pubkey]. This fee is deducted from the [TradeDetail::amount] when settling.
    /// # Arguments
    /// * `ctx` - A [Context] of [SetTotalFee] required for setting the total fee.
    /// * `set_total_fee_args` - An argument [SetTotalFeeArgs] required for setting the total fee.
    /// # Errors
    /// * [PetaFiError::Unauthorized] when the caller is not authorized, or not the mpc of the trade.
    /// * [PetaFiError::TimeOut] when the trade timeout is expired, so we cannot set the total fee anymore.
    pub fn set_total_fee(
        ctx: Context<SetTotalFee>,
        set_total_fee_args: SetTotalFeeArgs,
    ) -> Result<()> {
        handler_set_total_fee(ctx, set_total_fee_args)
    }

    /// MPC settles the trade, tranfer the settlement amount to the pmm and the total fee to the protocol, after the pmm paid to users.
    /// 
    /// This instruction is authorized by both the [TradeDetail::mpc_pubkey] and the [TradeDetail::user_ephemeral_pubkey].
    /// This instruction is called after the pmm paid to users, and before the [TradeDetail::timeout].
    /// This instruction close the [NonceCheckAccount], transfer rent fee to [TradeDetail::user_pubkey], and allow the nonce can be used by other trade.
    /// # Arguments
    /// * `ctx` - A [Context] of [SettlementAccounts] required for settling the trade.
    /// * `payment_args` - An argument [SettlementArgs] required for settling the trade.
    /// # Errors
    /// * [PetaFiError::Unauthorized] when the caller is not authorized by both [TradeDetail::mpc_pubkey] and [TradeDetail::user_ephemeral_pubkey].
    /// * [PetaFiError::InvalidUserAccount] when the user account is not match with [TradeDetail::user_pubkey].
    /// * [PetaFiError::InvalidRefundPubkey] when the refund pubkey is not match with [TradeDetail::refund_pubkey].
    /// * [PetaFiError::TimeOut] when the trade timeout is expired, so we cannot settle the trade anymore.
    /// * [PetaFiError::InvalidTradeStatus] when the trade status is not [TradeStatus::Deposited]. We only can settle the trade has deposited status.
    /// * [PetaFiError::InvalidMintKey] when the mint key is not match with the mint of the trade.
    /// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the vault and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer settlement amount is not the associated token account of the pmm and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer total fee is not the associated token account of the protocol and mint.
    pub fn settlement<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, SettlementAccounts<'info>>,
        payment_args: SettlementArgs,
    ) -> Result<()> {
        handler_settlement(ctx, payment_args)
    }

    /// Claim the deposited amount after the timeout. This instruction is authorized by anyone.
    /// 
    /// The deposited amount is transferred to the [TradeDetail::refund_pubkey].
    /// This instruction close the [NonceCheckAccount], transfer rent fee to [TradeDetail::user_pubkey], and allow the nonce can be used by other trade.
    /// # Arguments
    /// * `ctx` - A [Context] of [Claim] required for claiming the deposited amount.
    /// * `claim_args` - An argument [ClaimArgs] required for claiming the deposited amount.
    /// # Errors
    /// * [PetaFiError::InvalidUserAccount] when the user account not match with [TradeDetail::user_pubkey].
    /// * [PetaFiError::InvalidRefundPubkey] when the refund pubkey address is not match with the [TradeDetail::refund_pubkey].
    /// * [PetaFiError::CLaimNotAvailable] when the [TradeDetail::timeout] is not expired, so we cannot claim the deposited amount.
    /// * [PetaFiError::InvalidTradeStatus] when the [TradeDetail::status] is not [TradeStatus::Deposited], we only claim the Deposited trade and timed out.
    /// * [PetaFiError::InvalidMintKey] when the mint key is not match with the [TradeDetail::token]
    /// * [PetaFiError::InvalidSourceAta] when the source to transfer from is not the associated token account of the vault and mint.
    /// * [PetaFiError::InvalidDestinationAta] when the destination to transfer to is not the associated token account of the refund pubkey.
    pub fn claim<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, Claim<'info>>,
        claim_args: ClaimArgs,
    ) -> Result<()> {
        handler_claim(ctx, claim_args)
    }

    /// Close the finished trade ([TradeStatus::Settled] or [TradeStatus::Claimed]) to reclaim the rent fee.
    /// 
    /// Transfer the rent fee of [TradeDetail], [TradeVault] and [anchor_spl::token::TokenAccount] to the [TradeDetail::user_pubkey].
    /// 
    /// Depend on the trade status, the close action is different:
    /// * When the trade is [TradeStatus::Deposited], this action is not allowed.
    /// * When the trade is [TradeStatus::Claimed], this action is allowed for anyone.
    /// * When the trade is [TradeStatus::Settled], MPC can close the trade right away. Otherwise, anyone can close the trade after the [TradeDetail::timeout] + [Config::close_trade_duration].
    /// # Arguments
    /// * `ctx` - A [Context] of [CloseFinishedTradeAccounts] required for closing the trade.
    /// * `_close_finished_trade_args` - An argument [CloseFinishedTradeArgs] required for closing the trade.
    /// # Errors
    /// * [PetaFiError::InvalidUserAccount] when the user account is not match to [TradeDetail::user_pubkey]. This account will receive the claimed rent fee.
    /// * [PetaFiError::InvalidTradeStatus] when the trade status is [TradeStatus::Deposited].
    /// * [PetaFiError::CloseNotAvailable] when the trade is not the available time to close.
    pub fn close_finished_trade<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, CloseFinishedTradeAccounts<'info>>,
        _close_finished_trade_args: CloseFinishedTradeArgs,
    ) -> Result<()> {
        handler_close_finished_trade(ctx, _close_finished_trade_args)
    }

    /// Close a [PaymentReceipt] account, reclaim the rent fee.
    ///  
    /// The [PaymentReceiptrent fee is transferred to the [PaymentReceipt::from_pubkey] account.
    /// This instruction is authorized by the [PaymentReceipt::from_pubkey] account.
    /// Can close after [PaymentReceipt::payment_time] + [Config::close_payment_duration].
    /// # Arguments
    /// * `ctx` - A [Context] of [ClosePaymentReceiptAccounts] required for closing the payment receipt.
    /// # Errors
    /// * [PetaFiError::InvalidUserAccount] - When the signer is not match to [PaymentReceipt::from_pubkey].
    /// * [PetaFiError::CloseNotAvailable] - Not the available time to close the payment receipt.
    pub fn close_payment_receipt<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, ClosePaymentReceiptAccounts<'info>>,
    ) -> Result<()> {
        handler_close_payment_receipt(ctx)
    }

    /// Set the waiting duration for closing a finished trade or close a payment receipt.
    /// 
    /// This instruction is authorized by the [Config::operators].
    /// # Arguments
    /// * `ctx` - A [Context] of [SetCloseWaitDuration] required for setting the waiting duration.
    /// * `set_close_wait_duration_args` - An argument [SetCloseWaitDurationArgs] required for setting the waiting duration.
    /// # Errors
    /// * [PetaFiError::Unauthorized] when the caller is not authorized.
    pub fn set_close_wait_duration(ctx: Context<SetCloseWaitDuration>, set_close_wait_duration_args: SetCloseWaitDurationArgs) -> Result<()> {
        handler_set_close_wait_duration(ctx, set_close_wait_duration_args)
    }

    /// Add fee receiver.
    /// 
    /// This instruction is authorized by the [Config::admin].
    /// # Arguments
    /// * `ctx` - A [Context] of [AddFeeReceiver] required for adding the fee receiver.
    /// * `receiver_pubkey` - The pubkey of the fee receiver.
    /// # Errors
    /// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the admin.
    pub fn add_fee_receiver(ctx: Context<AddFeeReceiverAccounts>, receiver_pubkey: Pubkey) -> Result<()> {
        handler_add_fee_receiver(ctx, receiver_pubkey)
    }

    /// Remove fee receiver.
    /// 
    /// This instruction is authorized by the [Config::admin].
    /// This instruction close the [FeeReceiver] account, and transfer rent fee to the signer.
    /// # Arguments
    /// * `ctx` - A [Context] of [RemoveFeeReceiver] required for removing the fee receiver.
    /// * `receiver_pubkey` - The pubkey of the fee receiver.
    /// # Errors
    /// * [PetaFiError::Unauthorized] - The caller is not authorized, or not the admin.
    pub fn remove_fee_receiver(ctx: Context<RemoveFeeReceiverAccounts>, receiver_pubkey: Pubkey) -> Result<()> {
        handler_remove_fee_receiver(ctx, receiver_pubkey)
    }
}
