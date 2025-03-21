import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction, NonceAccount, Commitment } from "@solana/web3.js";
import { getTradeDetailData } from "../pda";
import { createNonceAdvanceAndSettlementInstruction } from "./settlement";
import nacl from "tweetnacl";
import { FetchAccountError, InvalidPresignStringError } from "../errors";

/**
 * Create a group of instructions for creating an associated token account if it not exists, return empty array if the token is null or the ata is already exists
 * @param connection - A solana connection
 * @param payer - The user who will pay for the associated token account. This user must sign the transaction
 * @param tokenPubkey - The token pubkey for the associated token account
 * @param userPubkey - The user pubkey for the associated token account
 * @returns An array of instructions for creating an associated token account if it not exists, return empty array if it already exists
 */
export async function createAssociatedTokenAccountInstructionIfNeeded(connection: Connection, payer: PublicKey, tokenPubkey: PublicKey | null, userPubkey: PublicKey, commitment: Commitment = 'confirmed') {
    if (!tokenPubkey) return [];
    const userTokenAta = await getAssociatedTokenAddressSync(tokenPubkey, userPubkey, true);
    const userTokenAtaInfo = await connection.getAccountInfo(userTokenAta, commitment);
    if (!userTokenAtaInfo) {
        const createTokenAtaIns = createAssociatedTokenAccountInstruction(payer, userTokenAta, userPubkey, tokenPubkey);
        return [createTokenAtaIns];
    }
    return [];
}

/**
 * Parameters for verifying a presign settlement
 * @param connection - A solana connection
 * @param tradeId - The tradeId of the trade, unique for each trade
 * @param presign - The presign transaction, serialized to a string
 * @param commitment - The commitment level, default is confirmed
 */
export type VerifyPresignSettlementParam = {
    connection: Connection,
    tradeId: string,
    pmmPubkey: PublicKey,
    presign: string,
    commitment?: Commitment,
}

/**
 * Verify the validity of a presign settlement
 * @param params - The parameters for verifying a presign settlement
 * @returns An object containing the error and a boolean indicating whether the presign settlement is valid
 */
export async function verifyPresignSettlement(params: VerifyPresignSettlementParam): Promise<{ error: InvalidPresignStringError | null, isVerified: boolean }> {
    const { connection, tradeId, pmmPubkey, presign, commitment } = params;
    const commitmentLevel = commitment || 'confirmed';
    // MPC must validate the data of the asset chain and L2 to make sure the trade is valid
    const tradeDetailData = await getTradeDetailData(tradeId, connection, commitmentLevel);
    // Recovered the presign transaction from presign string
    let recoveredTx: Transaction;
    try {
        recoveredTx = Transaction.from(Buffer.from(presign, 'hex'));
    } catch (e) {
        const error = new InvalidPresignStringError('Invalid presign string format', { presign });
        return { error, isVerified: false };
    }
    const isSignaturesValid = await verifyTransactionSignatures(recoveredTx);
    if (!isSignaturesValid) {
        const error = new InvalidPresignStringError('Invalid verify signatures', {});
        return { error, isVerified: false };
    }

    const signatures = recoveredTx.signatures;
    const numberOfSignaturesPair = signatures.length;
    // Required only 2 signatures: MPC key and ephemeral key
    if (numberOfSignaturesPair !== 2) {
        const error = new InvalidPresignStringError('Invalid number of signatures', { expected: 2, actual: numberOfSignaturesPair });
        return { error, isVerified: false };
    }

    // MPC is fee payer, so it must be the fist signer of the transaction
    // Mpc must not sign the transaction
    const mpcSignaturePair = signatures[0];
    if (mpcSignaturePair.publicKey.toBase58() !== tradeDetailData.mpcPubkey.toBase58()) {
        const error = new InvalidPresignStringError('Invalid MPC pubkey', { expected: tradeDetailData.mpcPubkey.toBase58(), actual: mpcSignaturePair.publicKey.toBase58() });
        return { error, isVerified: false };
    }
    if (mpcSignaturePair.signature !== null) {
        const error = new InvalidPresignStringError(`MPC's presign signature is not null`, { expected: null, actual: Buffer.from(mpcSignaturePair.signature).toString('hex') });
        return { error, isVerified: false };
    }

    // Verify whether the transaction is settlment transaction
    // We rebuild the settlment transaction, and check whether the signatures with ephemeral key are valid
    //
    // The ephemeral signature is valid as we check in #L57.
    // If ephemeral signature is valid for rebuild settlement transaction
    // Then the original transaction and rebuild transaction are the same
    const ephemeralSignaturePair = signatures[1];
    const settlmentIns = await createNonceAdvanceAndSettlementInstruction({
        tradeId: tradeId,
        mpcPubkey: tradeDetailData.mpcPubkey,
        userEphemeralPubkey: tradeDetailData.userEphemeralPubkey,
        pmmPubkey,
        connection: connection,
    });
    const rebuildSettlmentTrans = new Transaction().add(...settlmentIns);
    const nonceAccountInfo = await connection.getAccountInfo(tradeDetailData.userEphemeralPubkey, commitmentLevel);
    const nonceAccountData = NonceAccount.fromAccountData(nonceAccountInfo!.data);
    rebuildSettlmentTrans.recentBlockhash = nonceAccountData.nonce;
    rebuildSettlmentTrans.feePayer = tradeDetailData.mpcPubkey;
    let verfied: boolean;
    try {
        verfied = nacl.sign.detached.verify(
            Buffer.from(rebuildSettlmentTrans.serializeMessage()),
            ephemeralSignaturePair.signature!,
            tradeDetailData.userEphemeralPubkey.toBytes(),
        )
    } catch (error) {
        verfied = false;
    }
    if (!verfied) {
        const error = new InvalidPresignStringError('Invalid ephemeral settlement signatures', {
            ephemeralPresign: ephemeralSignaturePair.publicKey.toBase58(),
            ephemeralActual: tradeDetailData.userEphemeralPubkey.toBase58(),
            signature: ephemeralSignaturePair.signature ? ephemeralSignaturePair.signature.toString('hex') : null
        });
        return { error, isVerified: false };
    }
    return { error: null, isVerified: true };
}

/**
 * Verify the validity of existed signatures of a transaction, if transaction signature is null, it will be ignored
 * @param transaction - The transaction to verify
 * @returns True if the all existed signatures are valid, false otherwise
 */
export async function verifyTransactionSignatures(transaction: Transaction): Promise<boolean> {
    for (const signaturePair of transaction.signatures) {
        // Don't check the null signature
        if (signaturePair.signature === null) {
            continue;
        }
        const signatureVerified = nacl.sign.detached.verify(
            Buffer.from(transaction.serializeMessage()),
            signaturePair.signature,
            signaturePair.publicKey.toBytes(),
        )
        // One of the signatures is invalid, return false
        if (!signatureVerified) {
            return false;
        }
    }
    return true;
}

/**
 * Get the balance of a token, with decimals
 * @param connection - A solana connection
 * @param tokenPubkey - The token pubkey, if null query the SOL balance
 * @param accountPubkey - The pubkey address we want to query the balance
 * @returns The balance of the token
 */
export async function getTokenBalance(connection: Connection, tokenPubkey: PublicKey | null, accountPubkey: PublicKey, commitment: Commitment = 'confirmed'): Promise<bigint> {
    if (!tokenPubkey) {
        const balance = await connection.getBalance(accountPubkey, commitment);
        return BigInt(balance);
    }
    const tokenAta = await getAssociatedTokenAddressSync(tokenPubkey, accountPubkey, true);
    try {
        const tokenBalance = await connection.getTokenAccountBalance(tokenAta, commitment);
        return BigInt(tokenBalance.value.amount);
    } catch (error) {
        throw new FetchAccountError('Failed to fetch token account balance', { tokenPubkey: tokenPubkey.toBase58(), accountPubkey: accountPubkey.toBase58(), ata: tokenAta.toBase58() });
    }
}