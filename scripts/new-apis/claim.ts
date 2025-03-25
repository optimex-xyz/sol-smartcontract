import { getKeypairFromFile } from "../utils/helper";
import { createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions } from "../../solana-js";
import { clusterApiUrl, Connection, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import path from 'path';

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'));
    const currentDir = __dirname;
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const tradeId = '0xedd025e7c4d950c40dfca527785445694c411cc554448d98927f42f1c2a35e79'

    const instructions = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
        tradeId,
        connection,
        userPubkey: user.publicKey,
    })

    try {
        const transaction = new Transaction().add(...instructions);
        const signature = await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'confirmed' });
        console.log(`Claim success at ${signature}`);
        // const simulateTransaction = await connection.simulateTransaction(transaction, [user]);
        // console.log(simulateTransaction);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()