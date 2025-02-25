import { AccountMeta, Connection, Keypair, NonceAccount, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getPetaFiProgram } from "../artifacts";
import { getProtocolPda, getTradeVaultPda, getUserTradeDetailPda } from "../pda/get_pda_address";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bigintToBytes32 } from "../utils/parse_utils";
import { getTradeDetailData } from "../pda/get_pda_data";

/**
 * Parameters for creating a settlement instructions
 */
export type SettlementInstructionParam = {
    /** The tradeId of the trade */
    tradeId: string,
    /** 
     * The mpc pubkey who has the authority to settle the trade
     * This account need to sign the transaction
    */
    mpcPubkey: PublicKey,
    /** The user ephemeral pubkey that created for the trade */
    userEphemeralPubkey: PublicKey,
    /** The pmm pubkey who will receive the amount */
    pmmPubkey: PublicKey,
    /** A solana connection */
    connection: Connection,
}

/**
 * Create a group of instructions for settling a trade
 * @param params - Parameters for creating a settlement instructions
 * @returns An array of instructions for settling the trade
 */
export async function createSettlementInstructions(params: SettlementInstructionParam) {
    const { connection, tradeId, mpcPubkey, userEphemeralPubkey, pmmPubkey } = params;
    const petaFiProgram = await getPetaFiProgram(connection);
    const userTradeDetail = getUserTradeDetailPda(tradeId);
    const userTradeDetailData = await getTradeDetailData(tradeId, connection);
    const tokenPubkey = userTradeDetailData.token;
    const remainingAccounts: AccountMeta[] = [];
    const tradeVaultPda = getTradeVaultPda(tradeId);
    if (tokenPubkey) {
        const protocolPda = getProtocolPda();
        const vaultAta = await getAssociatedTokenAddress(tokenPubkey, tradeVaultPda, true);
        const protocolAta = await getAssociatedTokenAddress(tokenPubkey, protocolPda, true);
        const pmmAta = await getAssociatedTokenAddress(tokenPubkey, pmmPubkey, true);
        remainingAccounts.push({
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        });
        remainingAccounts.push({
            pubkey: tokenPubkey,
            isSigner: false,
            isWritable: false,
        });
        remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
        remainingAccounts.push({ pubkey: pmmAta, isSigner: false, isWritable: true });
        remainingAccounts.push({ pubkey: protocolAta, isSigner: false, isWritable: true });
    }

    const tradeIdBytes = bigintToBytes32(BigInt(tradeId));
    const depositIns = await petaFiProgram.methods.settlement({
        tradeId: tradeIdBytes,
    })
        .accounts({
            signer: mpcPubkey,
            userEphemeralAccount: userEphemeralPubkey,
            userTradeDetail,
            pmm: pmmPubkey,
            refundAccount: userTradeDetailData.refundPubkey,
            userAccount: userTradeDetailData.userPubkey,
            vault: tradeVaultPda,
        }).remainingAccounts(remainingAccounts).instruction();

    return [depositIns];
}

/**
 * Create a nonce advance instruction
 * This instruction is used as the first instruction of the durable transaction
 * @param params - Parameters for creating a nonce advance instruction
 * @returns An array of instructions for advancing the nonce
 */
export async function createNonceAdvanceInstruction(params: Pick<SettlementInstructionParam, 'mpcPubkey' | 'userEphemeralPubkey'>) {
    const { mpcPubkey, userEphemeralPubkey } = params;
    const nonceAdvanceIns = SystemProgram.nonceAdvance({
        authorizedPubkey: mpcPubkey,
        noncePubkey: userEphemeralPubkey,
    });
    return [nonceAdvanceIns];
}

/**
 * Create a group of instructions for advancing the nonce for durable transaction and settling the trade
 * @param params - Parameters for creating a nonce advance and settlement instructions
 * @returns An array of instructions for advancing the nonce and settling the trade
 */
export async function createNonceAdvanceAndSettlementInstruction(params: SettlementInstructionParam) {
    const nonceAdvanceIns = await createNonceAdvanceInstruction(params);
    const settlementIns = await createSettlementInstructions(params);
    return [...nonceAdvanceIns, ...settlementIns];
}

export type UserPresignSettlementTransactionParam = Omit<SettlementInstructionParam, 'userEphemeralPubkey'> & { userEphemeral: Keypair }

/**
 * Create a user presign with ephemeral key transaction for settling the trade 
 * @param params - Parameters for creating a user presign transaction
 * @returns A transaction for settling the trade
 */
export async function createUserPresignSettlementTransaction(params: UserPresignSettlementTransactionParam) {
    const { userEphemeral, connection, mpcPubkey } = params;
    const createInsParams = { ...params, userEphemeralPubkey: userEphemeral.publicKey };
    const createIns = await createNonceAdvanceAndSettlementInstruction(createInsParams);
    const nonceAccountInfo = await connection.getAccountInfo(userEphemeral.publicKey);
    const nonceAccountData = NonceAccount.fromAccountData(nonceAccountInfo!.data);
    const tx = new Transaction().add(...createIns);
    tx.recentBlockhash = nonceAccountData.nonce;
    tx.feePayer = mpcPubkey;
    tx.partialSign(userEphemeral);
    return tx;
}

/**
 * Create a user presign with ephemeral key transaction for settling the trade and serialize it to a string
 * This string is then used to pass to the mpc for settling the trade
 * @param params - Parameters for creating a user presign transaction
 * @returns A string of the transaction
 */
export async function createUserPresignSettlementTransactionAndSerializeToString(params: UserPresignSettlementTransactionParam): Promise<string> {
    const tx = await createUserPresignSettlementTransaction(params);
    const dataPresign = tx.serialize({ requireAllSignatures: false, verifySignatures: true });
    return Buffer.from(dataPresign).toString('hex');
}

