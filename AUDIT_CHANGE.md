# Audit Changes
This branch contains the changes made to the codebase to pass the audit, in [link](https://www.notion.so/offsidelabs/PetaFi-Audit-Draft-65eba3d6a3ae4a1a9cff01a34b238b6b). Here I describe the details:

## User-Manipulated Timeout Enables Unauthorized Claim of Deposited Funds
The team have already acknowledged this situation, and the time-out is manipulated is checked by MPC parties and cannot harm the protocol.
## Deliberate Payment Failures May Lead to PMM Slashing
In the design, PMM is responsible for checking the existence of the token account. If it's not exists, PMM will create the token account. The protocol is not responsible for checking users's token account.
## Missing Check Before Closing TokenAccount May Cause IX Failure
Fixed. Add user token account to when `close_finished_trade`, that can receive the remain amount of token funds.
## Rent of WhitelistToken Can Be Stolen by Malicious Operators Upon Account Closure
We both agree that all operators are trusted. So don't worry for now.
## Missing Validation for Pubkeys Can Lead to Permanent Token Lockup
We both agree that this check is not reponsble of the smart contract. User need carefully when passing address.
## Missing Validation on total_fee in set_total_fee IX
Fixed. Add errors `InvalidTotalFee` when set total fee too high.
## Possible Incorrect Error Type Used in withdraw_total_fee IX
Fixed. Add errors 'InvalidFeeReceiver` when withdraw total fee with wrong fee receiver.
## No Event Emitted in Payment and Deposit
We acknowedled this, and decided no need to emit event for now.
## Missing Validation on trade_id and Other Parameters in payment IX
The on-chain program lacks the necessary information to validate the trade_id during PMM payments. Therefore, validation is not performed. It is the responsibility of PMM to ensure that valid information is provided when making payments; failure to do so may result in the loss of their funds.
