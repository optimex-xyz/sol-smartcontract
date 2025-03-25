import { getKeypairFromFile } from "../utils/helper";
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { keccak256, toUtf8Bytes } from "ethers";
import path from 'path';
import crypto from 'crypto';
import { delay, getBlockTime } from "../utils/helper";
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, createSetTotalFeeInstructions, createUserPresignSettlementTransactionAndSerializeToString, DepositInstructionParam, getTradeInput } from "../../solana-js";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'));
    // const connection = new Connection('http://127.0.0.1:8899');
    const currentDir = __dirname;
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral_2.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    const pmm = await getKeypairFromFile(path.join(currentDir, '../../.wallets/pmm.json'));
    const refund = await getKeypairFromFile(path.join(currentDir, '../../.wallets/refund.json'));
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    console.log(`Session ID: ${sessionId}`);
    console.log(`Start depositing 0.1 SOL`);

    const scriptTimeout = await getBlockTime(connection) + 1800;
    const depositParams: DepositInstructionParam = {
        sessionId: sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpc.publicKey,
        userEphemeralPubkey: userEphemeral.publicKey,
        amount: BigInt(0.1 * LAMPORTS_PER_SOL),
        connection: connection,
        scriptTimeout,
        fromToken: {
            id: 1,
            networkId: 'solana-devnet',
            tokenId: 'native',
            networkName: 'solana',
            networkSymbol: 'solana',
            networkType: 'SOLANA',
            tokenName: 'native',
            tokenSymbol: 'SOL',
            tokenAddress: 'native',
            tokenDecimals: 9,
            tokenLogoUri: '',
            networkLogoUri: '',
            createdAt: '',
            updatedAt: ''
        },
        toToken: {
            id: 0,
            networkId: 'bitcoin-testnet',
            tokenId: 'native',
            networkName: 'bitcoin-testnet',
            networkSymbol: 'tbtc',
            networkType: 'TBTC',
            tokenName: 'native',
            tokenSymbol: 'btc',
            tokenAddress: 'native',
            tokenDecimals: 8,
            tokenLogoUri: '',
            networkLogoUri: '',
            createdAt: '',
            updatedAt: ''
        },
        toUserAddress: 'tb1q85w8v43nj5gq2elmc57fj0jrk8q900sk3udj8h',
        solver: '0x1Fec27e711599E149588DE9b7d240de57d1606a4',
        refundPubkey: refund.publicKey,
    }

    const depositInstructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams);

    const depositTransaction = new Transaction().add(...depositInstructions);
    depositTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const depositSignature = await sendAndConfirmTransaction(connection, depositTransaction, [user, userEphemeral], { commitment: 'finalized' });
    console.log(`Deposit success at ${depositSignature}`);

    const { tradeId } = await getTradeInput(depositParams);
    console.log(`Trade ID: ${tradeId}`);

    console.log(`Start setting protocol fee`);
    const setFeeIns = await createSetTotalFeeInstructions({
        tradeId,
        amount: BigInt(0.0001 * LAMPORTS_PER_SOL),
        connection,
        mpcPubkey: mpc.publicKey,
    });
    const setFeeTransaction = new Transaction().add(...setFeeIns);
    const setFeeSignature = await sendAndConfirmTransaction(connection, setFeeTransaction, [mpc], { commitment: 'confirmed' });
    console.log(`Set fee success at ${setFeeSignature}`);

    await delay(2000);

    console.log(`Start settling deposit`);
    console.log(`Trade ID: ${tradeId}`);
    const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        connection: connection,
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmm.publicKey,
        userEphemeral: userEphemeral,
    });

    console.log(`Presign success`);

    const recoveredTransaction = Transaction.from(Buffer.from(settlementPresign, 'hex'));
    recoveredTransaction.partialSign(mpc);
    const latestBlockhash = await connection.getLatestBlockhash();
    const sig = await connection.sendRawTransaction(recoveredTransaction.serialize(), {
        skipPreflight: false,
    })
    await connection.confirmTransaction({
        signature: sig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed')

    console.log(`Settlement success at ${sig}`);
})()