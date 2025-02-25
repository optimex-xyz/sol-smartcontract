//! This module contains the instructions that only performed by the admin or operator.
pub mod init;
pub mod add_or_remove_operator;
pub mod add_or_update_whitelist;
pub mod remove_whitelist;
pub mod set_close_wait_duration;
pub mod add_fee_receiver;
pub mod remove_fee_receiver;

pub use init::*;
pub use add_or_remove_operator::*;
pub use add_or_update_whitelist::*;
pub use remove_whitelist::*;
pub use set_close_wait_duration::*;
pub use add_fee_receiver::*;
pub use remove_fee_receiver::*;