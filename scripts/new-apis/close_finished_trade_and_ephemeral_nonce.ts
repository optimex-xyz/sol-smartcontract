import { clusterApiUrl, NONCE_ACCOUNT_LENGTH, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import { getKeypairFromFile } from '../utils/helper';
import { Connection } from '@solana/web3.js';
import path from 'path';
import { createCloseFinishedTradeInstructions } from "../../solana-js";

(async () => {
    const currentDir = __dirname;
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral_2.json'));
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    // Pass in the tradeID we want to close
    const tradeId = '0x690ffc4e1461565aae5641692dff45c0eac3937bbd98a7c8f9f0846009b2a05a';
    const closeFinishsedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId,
        connection,
        userPubkey: mpc.publicKey,
    })
    const lamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const instruction = await SystemProgram.nonceWithdraw({
        noncePubkey: userEphemeral.publicKey,
        authorizedPubkey: mpc.publicKey,
        toPubkey: user.publicKey,
        lamports,
    })
    const transaction = new Transaction().add(...closeFinishsedTradeIns, instruction);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = mpc.publicKey;
    // const simulateTransaction = await connection.simulateTransaction(transaction, [mpc]);
    // console.log(simulateTransaction);
    const signature =  await sendAndConfirmTransaction(connection, transaction, [mpc], { commitment: 'finalized' });
    console.log(`Close finished trade and ephemeral nonce closed at ${signature}`);
})();

