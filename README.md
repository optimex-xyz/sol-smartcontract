# Optimex Protocol Smart Contracts

## Deployed Contracts (Mainnet)

- **Contract Address**: `E2pt2s1vZjgf1eBzWhe69qDWawdFKD2u4FbLEFijSMJP`

## Prerequisites

- **Node.js** (runtime environment, version v20.12.2)
- **Yarn** (package manager)
- **Anchor Framework** (Rust-based smart contract framework, version 0.30.1)
- **Solana Tool Suite** (Solana CLI tools, version 2.1.11)
- **Rustc** (Rust compiler, version 1.79.0)

## Setup

### Install dependencies:

```bash
yarn
```

### Install anchor framework:
```bash
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli
```

### Install [solana tool](https://solana.com/ru/docs/intro/installation) suite:
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.11/install)"
```


## Optimex Authorized parties
Optimex is a decentralized protocol. While it requires authorized parties to perform certain management operations to ensure proper functionality, these operations cannot access user assets, maintaining complete user control over their funds at all times.

There are three authorized parties in the Optimex Protocol:

- `Upgradable authority`: The authority with permission to upgrade or delete the protocol. As the highest level authority in the protocol, it requires careful protection, potentially through a multisig wallet solution like [Squads](https://v3.squads.so/connect-squad). This authority is automatically granted to the protocol deployer.

- `Admin`: The authority responsible for managing protocol operators. There is a single Admin, appointed by the Upgradable authority during protocol initialization via the `Init` instruction.

- `Operator`: Authorities that manage the protocol's whitelisted tokens. Only whitelisted tokens can be used for trading and payments within Optimex. Up to 3 Operators can exist, managed by the Admin through the `AdminAddOrRemoveOperator` instruction.

## Build and Deploy
### Build
After [Setup](#setup) required tools and dependencies, you can build the program by running the following command:
```bash
anchor build
```
### Deploy
Run the following command to deploy the program.

```bash
anchor deploy --program_name optimex_sol_smartcontract --provider.cluster RPC_URL --provider.wallet WALLET_PATH -- --max-sign-attempts 60 --max-len 800000 --with-compute-unit-price 1000
```

Replace RPC_URL and WALLET_PATH with the correct values.
- WALLET_PATH is the path to the wallet that will deploy the program.

    Example: "~/.config/solana/id.json"
- RPC_URL is the URL of the Solana RPC node. We can use the paid RPCS instead.

    Example:

        - Devnet: "https://api.devnet.solana.com"
        - Mainnet: "https://api.mainnet-beta.solana.com"
- max-sign-attempts: The maximum number of attempts to sign or resign the transaction when submitting deployment transactions.
- max-len: The program size for deloyment. Our program currently has size of 600,000 bytes, we buffer more 200,000 bytes for future update. 800,000 costs about 5.6 SOL for rent.
- with-compute-unit-price: The priority fee price per compute unit for enhancing the likelihood for landing deployment transactions. 1000 costs about 0.20 SOL for additional fee.
**Note**: Resuming deployment after failed.

Due to the nature of Solana program deployment, the process may occasionally fail due to network issues. In such cases, you might encounter an error message like this:
```bash
To resume a deploy, pass the recovered keypair as the
[BUFFER_SIGNER] to `solana program deploy` or `solana program write-buffer'.
Or to recover the account's lamports, pass it as the
[BUFFER_ACCOUNT_ADDRESS] argument to `solana program close`.
```
To resume the deployment, follow this steps:
- Recover buffer keypair:

    Run this following command, then paste the seed phrase promted:
    ```bash
    solana-keygen recover -o buffer.json
    ```
- Resume deployment:

    Run the following command, replacing `RPC_URL` and `WALLET_PATH` with the correct values:
    ```bash
    solana program deploy target/deploy/optimex_sol_smartcontract.so -u RPC_URL --upgrade-authority WALLET_PATH --keypair WALLET_PATH  --buffer buffer.json
    ```


## Setup program flow
After deploying the program, authorized parites need to perform some operations to make sure the program is ready to use.
### Init the program
Deployer perform init instruction to initialize some required PDA acounts:
- `Config`: The PDA that contains the protocol configuration.
- `Vault`: The PDA that own the deposited assets of the protocol.
⚠️ **Deprecated, remains for backward compatibility.**
- `Protocol`: The PDA that own the protocol fee.

Deployer also set the `Admin` role for furthur operations.

Example script is in: `scripts/new-apis/initialize.ts`

### Add operator

Admin perform adding operator instruction to add operator to the program. Operator is the one who can perform some actions on behalf of the program.

Example script is in: `scripts/new-apis/add_operator.ts`

### Add whitelist

To support for a token, operator perform add whitelist instruction to add the token to the whitelist.
The SOL native and WSOL token use the same whitelist account.

Example script is in: `scripts/new-apis/add_whitelist.ts`

## Local Testing

The tests are in `tests/` folder. We have multiple tests for different scenarios. 

To run a test, we follow the following steps:

### Prepare test key
Create a fake deployer key in `tests/fake_deployer.json` so that this key will be used as genegis account when testing.
```bash
solana-keygen new -o tests/fake_deployer.json
```

### Choose a test to run
We need to run a test separately to avoid conflict with other tests. To run a specific test, you need to specify it in `Anchor.toml` file, by commenting out other tests.

For example, to run `deposit.test.ts`, we comment out other tests in `Anchor.toml` file, except `deposit.tests.ts`
```toml
#test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/optimex_success.test.ts"
#test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/payment.test.ts"
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/deposit.test.ts"
#test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/claim.test.ts"
```

### Run the test
Just run the following command:
```bash
anchor test
```

## Execute scripts
We have some scripts to illustrate how to use SDK to interact with the Optimex program, in `scripts/new-apis`.

For example, script `scripts/new-apis/deposit_setfee_settlement.ts` illustrates how to deposit SOL, set protocol fee, and settle the trade.

### Prerequisites
To run the scripts, we need to setup example keys for participants. You can run this script to generate keys and airdrop SOL for this purpose:
```bash
bash scripts/init_key.sh
```

### Running the scripts
To run the script, you can use the following command:
```bash
npx ts-node scripts/new-apis/deposit_setfee_settlement.ts
```

## Transactions Fee
### Deploy and upgrade
#### Deploy
Depend on the program's size and priority fee config, we have to pay differrent fee for deployment. 

For deployment config in [line 91](#L91), we need about 6 SOL for deployment.

#### Upgrade
Upgrading the program incurs minimal fees. We need to reserve approximately 6 SOL for the update process. This amount will be utilized during deployment and will be refunded upon successful completion of the deployment.

### Instructions
Transaction fee on Solana is divided into 3 categories:
- `Base fee`: 5000 lamports per signature.
- `Rent fee`: A temporary fee that ensures the account remains active. This fee varies based on the account's size. Participants can close their accounts later to reclaim the rent fee. The table below outlines all rent fees paid by participants that can be claimed afterward.
- `Prioritization fee` (Optional): This fee is paid to the validator to enhance the likelihood of a transaction being included in a block. It is calculated as `compute unit price` multiplied by `compute unit limit`. **Note**: The `compute unit price` is determined by the fee payer, and we provide an approximate `compute unit limit` for your reference to help estimate the fee. For user actions such as `Deposit` and `Claim`, the prioritization fee is automatically calculated and included by wallet extensions like Phantom Wallet, so users do not need to worry about it.

We show the fee inn SOL needed for each instruction in the Optimex below. Beside that, we also show the claimed rent fee when closing the account for each transaction if existed.

| Instruction   | Base fee   | Rent fee         | Compute unit limit | Fee payer         | Total fee Paid   | Blank |Rent fee claimed | Fee receiver | Total fee claimed |
|:------------  |:-----------|:-----------------|:------------------ |:----------------- |:------------|:----------------|:----------------|:----------------|:----------------|
| `Init`        | 0.000005   | `Vault`: 0.00089088 <br> `Protocol`: 0.00089088 <br> `Config`: 0.00275616 | 30,000                  | Upgrade authority  | 0.00455284 | | | |
| `Deposit `    | 0.000005   | `TradeDetail`: 0.0035844 <br> `NonceCheck`: 0.00089088 <br> `TradeVault`: 0.0009465 <br> `Vault TA`: 0.002039 SOL| 190,000           | User  | 0.00746578 | | | |
| `Create Nonce`| 0.000005   | `EphemeralNonce`: 0.00144768 | 10,000                  | User  | 0.00145268 | | | |
| `Claim`   | 0.000005   |  | 60,000                  | Anyone  | 0.000005  |  | `NonceCheck`: 0.00089088 | Depositor | 0.00089088 |
| `Settlement`   | 0.00001   |  | 60,000                  | MPC  | 0.00001 | | `NonceCheck`: 0.00089088 | Depositor | 0.00089088 | 
| `Payment` | 0.000005 | `PaymentReceipt`: 0.00290232 | 110,000| PMM |0.00290732 | | | 
| `CloseFinishedTrade` | 0.000005 | | 25,000 | Anyone | 0.000005 | |`TradeDetail`: 0.0035844 <br> `TradeVault`: 0.0009465 <br> `Vault TA`: 0.002039 SOL | Depositor | 0.0065699 |
| `ClosePaymentReceipt` | 0.000005 | | 11,000 | PMM | 0.000005 | |`PaymentReceipt`: 0.00290232 | PMM | 0.00290232 |
| `CloseNonce` | 0.000005 | | 10,000 | MPC | 0.000005 | |`EphemeralNonce`: 0.00144768 | Depositor | 0.00144768 |
