
# Optimex Solana JS

A JavaScript/TypeScript library for interacting with the Optimex Solana smart contract.

trigger build
## Overview trigger

This library provides a set of utilities and functions to interact with the Optimex smart contract on the Solana blockchain. It handles operations such as:

- Trade deposits
- Trade settlements
- Claims
- Total fee (protocol fee + affiliate fee) management
- Nonce account management for settling the trade
- Decode list of accounts

## Installation
```bash
npm install optimex-solana-js
```


## Usage

### Deposit
When the user want to deposit SOL/Spl token to the Optimex program.
```typescript
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, DepositInstructionParam } from 'optimex-solana-js';

// Deposit params receive from the backend/solver
const depositParams: DepositInstructionParam = {}
// Build necessary instructions for depositing
const instructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams);
// Build the transaction with built instructions
const transaction = new Transaction().add(...instructions);
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.feePayer = user.publicKey;

// Send the transaction to the network
// Note: Transactions need to be signed by the user and user ephemeral account
const signature = await sendAndConfirmTransaction(connection, transaction, [user, userEphemeral], { commitment: 'confirmed' });
console.log(`Signature: ${signature}`);
```

### Settlement
When the pmm already paid the user, then the mpcs can settle the trade. Settlement needs two step
#### Step 1: User presign the settlement transaction using `userEphemeral` key, allow the mpcs can settle the trade with agreed informations from user
```typescript
import { createUserPresignSettlementTransactionAndSerializeToString } from "optimex-solana-js";
// Build the presign transaction, serialize it to string, then send to the solver
const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
    connection: connection,
    tradeId: tradeId,
    mpcPubkey: mpc.publicKey,
    pmmPubkey: pmm.publicKey,
    userEphemeral: userEphemeral,
});
console.log(`Settlement presign: ${settlementPresign}`);
```

#### Step 2: MPCs get the presign transaction, sign with mpc keys, then send to the Solana to settle the trade
```typescript
// recover transaction from the presign string
const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
// Sign the transaction with mpc keys
recoveredTransaction.partialSign(mpc);
// Send the transaction to the network
const latestBlockhash = await connection.getLatestBlockhash();
const sig = await connection.sendRawTransaction(recoveredTransaction.serialize(), {
    skipPreflight: false,
})
await connection.confirmTransaction({
    signature: sig,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
}, 'confirmed')

console.log(`Settlement success at ${sig}`);
```

### Claim
When the trade is timed out, the user can claim the deposit back.
```typescript
import { createClaimInstructions } from "optimex-solana-js";

// Create claim instructions
const instructions = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
    tradeId,
    connection,
    userPubkey: user.publicKey,
})

// Build the transaction with built instructions
const transaction = new Transaction().add(...instructions);
// Send the transaction to the network
const signature = await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
console.log(`Claim success at ${signature}`);
```

### Set total fee
When the user deposit the SOL/Spl token, the mpcs can set the total fee for the trade.
```typescript
import { createSetTotalFeeInstructions } from "optimex-solana-js";

const instructions = await createSetTotalFeeInstructions({
    tradeId,
    amount: '0.0001',
    connection,
    mpcPubkey: mpc.publicKey,
});

// Build the transaction with built instructions
const transaction = new Transaction().add(...instructions);
// Send the transaction to the network
const signature = await sendAndConfirmTransaction(connection, transaction, [mpc], { commitment: 'confirmed' });
console.log(`Set fee success at ${signature}`);
```

### Decode list of accounts,
When some parties want to decode list of accounts, maybe fetched from a transaction.
```typescript
import { decodeTradeDetailAccounts } from "optimex-solana-js";

// Some tx hash, maybe a deposit transaction
const txHash = `...`
const parsedTx = await connection.getParsedTransaction(txHash, 'confirmed');

const accounts = parsedTx?.transaction.message.accountKeys;
const accountPubkey = accounts.map((account) => account.pubkey);
const results = await decodePaymentReceiptAccounts(connection, accountPubkey);
console.log('Trade details', results.filter((result) => result.error !== null));
```
