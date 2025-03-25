import { clusterApiUrl, Connection, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createInitializeProgramInstructions, getConfigPda } from "../../solana-js";
import path from 'path';
import { getKeypairFromFile } from "../utils/helper";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const currentDir = __dirname;
    const deployer = await getKeypairFromFile(path.join(currentDir, '../../.wallets/deployer.json'));
    const initializeIns = await createInitializeProgramInstructions({
        signer: deployer.publicKey,
        admin: deployer.publicKey,
        connection: connection,
    });

    const config = await getConfigPda();
    console.log(`Config PDA: ${config.toBase58()}`);

    try {
        const transaction = new Transaction().add(...initializeIns);
        const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        console.log(`Initialize success at ${signature}`);
        // const simulateTransaction = await connection.simulateTransaction(transaction, [user]);
        // console.log(simulateTransaction);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()