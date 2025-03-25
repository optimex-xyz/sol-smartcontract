import { clusterApiUrl, Connection, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { createAddOperatorInstruction } from "../../solana-js";
import path from 'path';
import { getKeypairFromFile } from "../utils/helper";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const currentDir = __dirname;
    const deployer = await getKeypairFromFile(path.join(currentDir, '../../.wallets/deployer.json'));
    const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: new PublicKey('6MsXYrd6iLhfuwP3DnLkq56UsCzS89bSL1VmepWKznRg'),
        connection,
    });
    try {
        const transaction = new Transaction().add(...addOperatorIns);
        const signature = await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        console.log(`Add operator success at ${signature}`);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()