import { Connection, PublicKey } from "@solana/web3.js";
import { getPetaFiProgram as getPetaFiProgram } from "../artifacts";
import { getPaymentReceiptData } from "../pda/get_pda_data";

/**
 * Parameters for creating a claim instructions
 */
export type ClosePaymentReceiptInstructionParam = {
    /** The tradeId of the trade that want to close to claim rent-fee */
    paymentReceipt: PublicKey,
    /** A solana connection */
    connection: Connection,
}

/**
 * Create group of instructions for closing a payment receipt
 * The pmm who perform the payment must sign this transaction
 * @param params - Parameters for creating a close payment receipt instructions,
 * 
 * @returns An array of instructions for closing a payment receipt
 */
export async function createClosePaymentReceiptInstructions(params: ClosePaymentReceiptInstructionParam) {
    const { paymentReceipt, connection } = params;

    const petaFiProgram = await getPetaFiProgram(connection);
    const paymentReceiptData = await getPaymentReceiptData(paymentReceipt, connection);
    const closeIns = await petaFiProgram.methods.closePaymentReceipt()
        .accounts({
            signer: paymentReceiptData.fromPubkey,
            paymentReceipt,
        })
        .instruction();

    return [closeIns];
}