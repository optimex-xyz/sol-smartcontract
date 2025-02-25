import { Commitment } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { PaymentReceipt, TradeDetail } from "../types";
import { getPetaFiProgram } from "../artifacts";


/**
 * Decode list of account to trade detail data.
 * @dev If one account is not trade detail data, it will return error instead throw
 * @param connection - A solana connection
 * @param tradeDetailPubkeys - List of public keys
 * @param checkOwner - If true, it will check if the account is own by the program, default is true
 * @param commitment - The commitment level, default is confirmed
 * @returns 
 */
export async function decodeTradeDetailAccounts(
    connection: Connection,
    tradeDetailPubkeys: PublicKey[],
    checkOwner: boolean = true,
    commitment: Commitment = 'confirmed')
    : Promise<{ error: string | null, data: TradeDetail | null, address: PublicKey }[]> {
    const petaFiProgram = await getPetaFiProgram(connection);
    const results = await Promise.all(
        tradeDetailPubkeys.map(async (pubkey) => {
            try {
                if (checkOwner) {
                    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
                    if (accountInfo?.owner.toBase58() !== petaFiProgram.programId.toBase58()) {
                        return { error: `Not own by the petafi program`, data: null, address: pubkey };
                    }
                }
                const data = await petaFiProgram.account.tradeDetail.fetch(pubkey);
                return { error: null, data, address: pubkey };
            } catch (error) {
                return { error: `Failed to decode trade detail account: ${error}`, data: null, address: pubkey };
            }
        })
    )
    return results;
}

/**
 * Decode list of account to payment receipt data.
 * @dev If one account is not receipt data, it will return error instead throw
 * @param connection - A solana connection
 * @param paymentReceiptPubkeys - List of public keys
 * @param checkOwner - If true, it will check if the account is own by the program, default is true
 * @param commitment - The commitment level, default is confirmed
 * @returns 
 */
export async function decodePaymentReceiptAccounts(
    connection: Connection,
    paymentReceiptPubkeys: PublicKey[],
    checkOwner: boolean = true,
    commitment: Commitment = 'confirmed')
    : Promise<{ error: string | null, data: PaymentReceipt | null, address: PublicKey }[]> {
    const petaFiProgram = await getPetaFiProgram(connection);
    const results = await Promise.all(
        paymentReceiptPubkeys.map(async (pubkey) => {
            try {
                if (checkOwner) {
                    const accountInfo = await connection.getAccountInfo(pubkey, commitment);
                    if (accountInfo?.owner.toBase58() !== petaFiProgram.programId.toBase58()) {
                        return { error: `Not own by the petafi program`, data: null, address: pubkey };
                    }
                }
                const data = await petaFiProgram.account.paymentReceipt.fetch(pubkey);
                return { error: null, data, address: pubkey };
            } catch (error) {
                return { error: `Failed to decode payment receipt account: ${error}`, data: null, address: pubkey };
            }
        })
    )
    return results;
}