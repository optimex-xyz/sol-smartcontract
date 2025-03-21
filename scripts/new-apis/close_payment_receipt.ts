import { clusterApiUrl, NONCE_ACCOUNT_LENGTH, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction } from '@solana/web3.js';
import { getKeypairFromFile } from '../utils/helper';
import { Connection } from '@solana/web3.js';
import path from 'path';
import { createCloseFinishedTradeInstructions, createClosePaymentReceiptInstructions, getPaymentReceiptAddresses } from "optimex-solana-js";

(async () => {
    const currentDir = __dirname;
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const tradeId = '0xc309b91a63a87a51c371f4117234b9151334351eb9b43856e030cb7c0c9439d7';
    // Pass in the tradeID we want to close
    const paymentReceipt = (await getPaymentReceiptAddresses(connection, {
        tradeId,
        fromUser: user.publicKey,
    }))[0]
    const closePaymentReceiptIns = await createClosePaymentReceiptInstructions({
        paymentReceipt: paymentReceipt.publicKey,
        connection: connection,
    })
    const transaction = new Transaction().add(...closePaymentReceiptIns);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    // const simulateTransaction = await connection.simulateTransaction(transaction, [mpc]);
    // console.log(simulateTransaction);
    const signature =  await sendAndConfirmTransaction(connection, transaction, [user], { commitment: 'finalized' });
    console.log(`Close payment receipt closed at ${signature}`);
})();

