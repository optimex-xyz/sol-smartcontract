import { clusterApiUrl, Connection, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createSetCloseWaitDurationInstruction } from "../../solana-js";
import path from 'path';
import { getKeypairFromFile } from "../utils/helper";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const currentDir = __dirname;
    const deployer = await getKeypairFromFile(path.join(currentDir, '../../.wallets/deployer.json'));
    const setCloseWaitDuration = await createSetCloseWaitDurationInstruction({
        operator: deployer.publicKey,
        connection,
        closeTradeDuration: 1,
        closePaymentDuration: 1,
    })
    try {
        const transaction = new Transaction().add(...setCloseWaitDuration);
        const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        console.log(`Set close wait duration success at ${signature}`);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()