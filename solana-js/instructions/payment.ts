import { BN } from '@coral-xyz/anchor'
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AccountMeta, Connection, PublicKey } from '@solana/web3.js'

import { createAssociatedTokenAccountInstructionIfNeeded } from './helpers'

import { getOptimexProgram } from '../artifacts'
import { WSOL_MINT } from '../constants'
import { getPaymentReceiptPda, getProtocolPda, getWhitelistPda } from '../pda/get_pda_address'
import { bigintToBytes32 } from '../utils/parse_utils'

/**
 * Parameters for creating a payment instruction
 */
export type CreatePaymentInstructionParam = {
  /**
   * The user who is paying
   * This account must sign the transaction
   */
  fromUser: PublicKey
  /** The user who is receiving the payment */
  toUser: PublicKey
  /** The trade id */
  tradeId: string
  /** The token to be paid, null for native token */
  token: PublicKey | null
  /** The amount to be paid, with decimals */
  amount: bigint
  /** The total fee to be deducted from the amount, with decimals */
  totalFee: bigint
  /** The deadline for the payment transaction */
  deadline: number
  /** A solana connection */
  connection: Connection
}

/**
 * Create a payment instruction
 * @param param - Parameters for creating a payment instruction
 * @returns An array of length 1, containing the payment instruction
 * @note This instruction does not check whether the ata is created
 */
export async function createPaymentInstruction(param: CreatePaymentInstructionParam) {
  const { fromUser, toUser, tradeId, token, amount, totalFee, deadline, connection } = param
  const onchainProgram = await getOptimexProgram(connection)
  const remainingAccounts: AccountMeta[] = []
  const protocolPda = getProtocolPda()
  let whitelistToken: PublicKey
  if (token) {
    whitelistToken = getWhitelistPda(token)
    const fromUserAta = await getAssociatedTokenAddress(token, fromUser, true)
    const toUserAta = await getAssociatedTokenAddress(token, toUser, true)
    const protocolAta = await getAssociatedTokenAddress(token, protocolPda, true)
    remainingAccounts.push(
      {
        pubkey: TOKEN_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: token,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: fromUserAta,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: toUserAta,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: protocolAta,
        isSigner: false,
        isWritable: true,
      }
    )
  } else {
    whitelistToken = getWhitelistPda(WSOL_MINT)
  }

  const paymentReceiptPda = getPaymentReceiptPda({
    tradeId,
    fromUser,
    toUser,
    amount,
    protocolFee: totalFee,
    token,
  })

  const paymentIns = await onchainProgram.methods
    .payment({
      tradeId: bigintToBytes32(BigInt(tradeId)),
      token,
      amount: new BN(amount.toString()),
      totalFee: new BN(totalFee.toString()),
      deadline: new BN(deadline),
    })
    .accounts({
      signer: fromUser,
      toUser: toUser,
      whitelistToken,
      paymentReceipt: paymentReceiptPda,
    })
    .remainingAccounts(remainingAccounts)
    .instruction()

  return [paymentIns]
}

/**
 * Create a group of instructions for payment
 * Will create destination ata and protocol ata if needed
 * @param param
 * @returns A group of instructions for payment
 */
export async function createPaymentAndRefundAtaAndProtocolAtaIfNeededInstructions(
  param: CreatePaymentInstructionParam
) {
  const { fromUser, toUser, token, connection } = param
  const protocolPda = getProtocolPda()
  const createDestinationAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(
    connection,
    fromUser,
    token,
    toUser
  )
  const createProtocolAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(
    connection,
    fromUser,
    token,
    protocolPda
  )
  const paymentIns = await createPaymentInstruction(param)
  return [...createDestinationAtaIns, ...createProtocolAtaIns, ...paymentIns]
}
