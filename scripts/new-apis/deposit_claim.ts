import { getKeypairFromFile } from "../utils/helper";
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { keccak256, toUtf8Bytes } from "ethers";
import path from 'path';
import crypto from 'crypto';
import { delay, getBlockTime } from "../utils/helper";
import { createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions, createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, DepositInstructionParam, getTradeInput } from "optimex-solana-js";

(async () => {
    const connection = new Connection(clusterApiUrl('devnet'));
    const currentDir = __dirname;
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    const pmm = await getKeypairFromFile(path.join(currentDir, '../../.wallets/pmm.json'));
    const refund = await getKeypairFromFile(path.join(currentDir, '../../.wallets/refund.json'));
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    console.log(`Session ID: ${sessionId}`);
    console.log(`Start depositing 0.1 SOL`);

    const scriptTimeout = await getBlockTime(connection) + 10;
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
            networkType: 'SOL',
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
    console.log(`Start claiming deposit`);
    const { tradeId } = await getTradeInput(depositParams);
    console.log(`Trade ID: ${tradeId}`);
    const depositTransaction = new Transaction().add(...depositInstructions);
    depositTransaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    depositTransaction.feePayer = user.publicKey;
    // deposit transaction contains nonce intialize instruction. So the transaction status need to be finalized so that nonce can be used in the settlement transaction
    const depositSignature = await sendAndConfirmTransaction(connection, depositTransaction, [user, userEphemeral], { commitment: 'finalized' });
    console.log(`Deposit success at ${depositSignature}`);

    console.log(`Waiting for 15 seconds for deposit to be timeout`);
    await delay(15000);


    const claimInstructions = await createClaimAndRefundAtaAndProtocolAtaIfNeededInstructions({
        tradeId,
        connection,
        userPubkey: user.publicKey,
    })

    try {
        const claimTransaction = new Transaction().add(...claimInstructions);
        const signature = await sendAndConfirmTransaction(connection, claimTransaction, [user], { commitment: 'confirmed' });
        console.log(`Claim success at ${signature}`);
    } catch (error) {
        console.log('Error: ', error);
        throw error;
    }
})()