import { getKeypairFromFile } from "../utils/helper";
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createAddOrUpdateWhitelistInstruction } from "../../solana-js";
import path from 'path';
import { WSOL_MINT } from "../../solana-js/constants";
(async () => {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const currentDir = __dirname;
    const deployer = await getKeypairFromFile(path.join(currentDir, '../../.wallets/deployer.json'));
    const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: deployer.publicKey,
        token: WSOL_MINT,
        amount: 0.00001 * LAMPORTS_PER_SOL,
        connection,
    });
    try {
        const transaction = new Transaction().add(...addWhitelistIns);
        const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        console.log(`Add whitelist success at ${signature}`);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()