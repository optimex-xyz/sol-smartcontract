import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, DepositInstructionParam, getTradeInput } from "optimex-solana-js";
import { keccak256, toUtf8Bytes  } from 'ethers';
import { clusterApiUrl, LAMPORTS_PER_SOL, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { getKeypairFromFile } from '../utils/helper';
import { Connection } from '@solana/web3.js';
import { getBlockTime } from '../utils/helper';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
(async () => {
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    console.log(`session Id`, sessionId);
    const currentDir = __dirname;
    const userEphemeral = await getKeypairFromFile(path.join(currentDir, '../../.wallets/ephemeral.json'));
    const user = await getKeypairFromFile(path.join(currentDir, '../../.wallets/user.json'));
    const mpc = await getKeypairFromFile(path.join(currentDir, '../../.wallets/mpc.json'));
    const refundKey = await getKeypairFromFile(path.join(currentDir, '../../.wallets/refund.json'));
    const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    const scriptTimeout = await getBlockTime(connection) + 1800;
    const depositParams: DepositInstructionParam  = {
        sessionId: sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpc.publicKey,
        userEphemeralPubkey: userEphemeral.publicKey,
        amount: 0.1 * LAMPORTS_PER_SOL,
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
        refundPubkey: refundKey.publicKey,
    }
    const instructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams);
    const { tradeId } = await getTradeInput(depositParams);
    console.log(`Trade ID: ${tradeId}`);
    const transaction = new Transaction().add(...instructions);
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = user.publicKey;
    const signature =  await sendAndConfirmTransaction(connection, transaction, [user, userEphemeral], { commitment: 'confirmed' });
    console.log(`Deposit success at ${signature}`);
})();

// sessionId:
// 103766280146293506834343841014263180468566023839362730764331060826118334079461n