import { getKeypairFromFile } from "../utils/helper";
import { clusterApiUrl, Connection, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { keccak256, toUtf8Bytes } from "ethers";
import path from 'path';
import { getBlockTime } from "../utils/helper";
import { createAssociatedTokenAccountInstructionIfNeeded, createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, createUserPresignSettlementTransactionAndSerializeToString, DepositInstructionParam, getNonceCheckPda, getProtocolPda, /*  */getTradeInput } from "../../solana-js";

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


    const scriptTimeout = await getBlockTime(connection) + 36000;
    const token = new PublicKey('So11111111111111111111111111111111111111112');
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
            tokenId: token.toBase58(),
            networkName: 'solana',
            networkSymbol: 'solana',
            networkType: 'SOLANA',
            tokenName: 'WSOL',
            tokenSymbol: 'WSOL',
            tokenAddress: token.toBase58(),
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

    const { tradeId } = await getTradeInput(depositParams);
    console.log(`Trade ID: ${tradeId}`);
    console.log(`Ephemeral nonce`, userEphemeral.publicKey.toBase58());
    console.log(`Nonce check PDA`, getNonceCheckPda(userEphemeral.publicKey).toBase58());


    const depositInstructions = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParams);

    const depositTransaction = new Transaction().add(...depositInstructions);
    // deposit transaction contains nonce intialize instruction. So the transaction status need to be finalized so that nonce can be used in the settlement transaction
    const depositSignature = await sendAndConfirmTransaction(connection, depositTransaction, [user, userEphemeral], { commitment: 'finalized' });
    console.log(`Deposit success at ${depositSignature}`);

    const protocolAta = getProtocolPda();
    const createPmmAtaInstruction = await createAssociatedTokenAccountInstructionIfNeeded(connection, mpc.publicKey, token, pmm.publicKey);
    const createProtocolAtaInstruction = await createAssociatedTokenAccountInstructionIfNeeded(connection, mpc.publicKey, token, protocolAta);

    const createAtaInstruction = [...createPmmAtaInstruction, ...createProtocolAtaInstruction];
    if (createAtaInstruction.length > 0) {
        console.log(`Create ATA`);
        const createAtaTransaction = new Transaction().add(...createAtaInstruction);
        const createAtaSignature = await sendAndConfirmTransaction(connection, createAtaTransaction, [mpc], { commitment: 'finalized' });
        console.log(`Create ATA success at ${createAtaSignature}`);
    } else {
        console.log(`No ATA created`);
    }

    console.log(`Start settling deposit`);
    // const { tradeId } = await getTradeInput(depositParams);
    // console.log(`Trade ID: ${tradeId}`);
    const settlementPresign = await createUserPresignSettlementTransactionAndSerializeToString({
        connection: connection,
        tradeId: tradeId,
        mpcPubkey: mpc.publicKey,
        pmmPubkey: pmm.publicKey,
        userEphemeral: userEphemeral,
    });

    console.log(`Presign success`);
    console.log('Presign ', settlementPresign);

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
