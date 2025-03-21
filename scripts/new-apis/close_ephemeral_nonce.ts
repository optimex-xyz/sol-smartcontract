import { clusterApiUrl, NONCE_ACCOUNT_LENGTH, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import { getKeypairFromFile } from '../utils/helper';
import { Connection } from '@solana/web3.js';
import path from 'path';

(async () => {
    const currentDir = __dirname;
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral.json'));
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const lamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const instruction = await SystemProgram.nonceWithdraw({
        noncePubkey: userEphemeral.publicKey,
        authorizedPubkey: mpc.publicKey,
        toPubkey: user.publicKey,
        lamports,
    })
    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = mpc.publicKey;
    // const simulateTransaction = await connection.simulateTransaction(transaction, [mpc]);
    // console.log(simulateTransaction);
    const signature =  await sendAndConfirmTransaction(connection, transaction, [mpc], { commitment: 'finalized' });
    console.log(`Close finished trade and ephemeral nonce closed at ${signature}`);
})();

