import { getKeypairFromFile } from "../utils/helper";
import { clusterApiUrl, Connection, Transaction } from "@solana/web3.js"
import { createUserPresignSettlementTransactionAndSerializeToString } from "../../solana-js";
import path from 'path';

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'));
    const currentDir = __dirname;
    const pmm = await getKeypairFromFile(path.join(currentDir, '../../.wallets/pmm.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    // Pass the tradeID we want to settle here
    const tradeId = '0xedd025e7c4d950c40dfca527785445694c411cc554448d98927f42f1c2a35e79';
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral.json'));

    const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        connection: connection,
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmm.publicKey,
        userEphemeral: userEphemeral,
    });

    const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
    console.log('Recovered transaction', recoveredTransaction.instructions.length);
    recoveredTransaction.partialSign(mpc);

    // const createAtaTrans = new Transaction().add(...createPmmAtaIns, ...createProtocolAtaIns);
    // console.log('Create ATA transaction', createAtaTrans.instructions.length);
    // if (createAtaTrans.instructions.length > 0) {
    //     const createAtaSig = await sendAndConfirmTransaction(connection, createAtaTrans, [mpc], { commitment: 'finalized' });
    //     console.log(`Create PMM ATA success at ${createAtaSig}`);
    // }
    console.log('Perform tx');

    try {
        const latestBlockhash = await connection.getLatestBlockhash();
        const sig = await connection.sendRawTransaction(recoveredTransaction.serialize(), {
            skipPreflight: false,
        });
        await connection.confirmTransaction({
            signature: sig,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed')

        console.log(`Settlement success at ${sig}`);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()
