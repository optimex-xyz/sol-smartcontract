# PetaFi Protocol Smart Contracts

## Deployed Contracts (Devnet)

- **Contract Address**: `E2pt2s1vZjgf1eBzWhe69qDWawdFKD2u4FbLEFijSMJP`

## Prerequisites

- **Node.js** (runtime environment)
- **Yarn** (package manager)
- **Anchor Framework** (Rust-based smart contract framework, version 0.30.1)
- **Solana Tool Suite** (Solana CLI tools, version 2.1.11)

## Setup

### Install Dependencies

Run the following command to install all necessary dependencies:

```bash
yarn
```

## Setup program flow

Allowing parties to interact with the program, we need to perform some actions to initialize the program.
### Build and Deploy
Who deploy the program is the deployer.
### Init the program
Deployer perform init instruction to initialize some required PDA acounts: `Config`, `Vault`, `Protocol`

Example script is in: `scripts/new-apis/initialize.ts`
### Add operator
Deployer perform add operator instruction to add operator to the program. Operator is the one who can perform some actions on behalf of the program.

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
#test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/petafi_success.test.ts"
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
We have some scripts to illustrate how to use SDK to interact with the PetaFi program, in `scripts/new-apis`.

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
