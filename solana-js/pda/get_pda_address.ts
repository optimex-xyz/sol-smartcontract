import { BN } from '@coral-xyz/anchor'
import { Connection, Finality, ParsedInstruction, PublicKey, SystemProgram } from '@solana/web3.js'

import { getOffchainProgram } from '../artifacts'
import { BPF_LOADER_PROGRAM } from '../constants'
import { bigintToBytes32 } from '../utils/parse_utils'

/**
 * The specific offchain program for deriving PDA addresses, not depend on the connection
 */
const program = getOffchainProgram()

/**
 * Get the vault PDA address
 * @returns The vault PDA address
 */
export function getVaultPda() {
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], program.programId)
  return vaultPda
}

/**
 * Get the trade vault PDA address
 * @param tradeId - The tradeId
 * @returns The trade vault PDA address
 */
export function getTradeVaultPda(tradeId: string) {
  const tradeIdBytes = bigintToBytes32(BigInt(tradeId))
  const [tradeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), Buffer.from(tradeIdBytes)],
    program.programId
  )
  return tradeVaultPda
}

/**
 * Get the user trade detail PDA address
 * @param tradeId - The tradeId
 * @returns The user trade detail PDA address
 */
export function getUserTradeDetailPda(tradeId: string) {
  const tradeIdBytes = bigintToBytes32(BigInt(tradeId))
  const [userTradeDetail] = PublicKey.findProgramAddressSync([Buffer.from(tradeIdBytes)], program.programId)
  return userTradeDetail
}

/**
 * Get the protocol PDA address
 * @returns The protocol PDA address
 */
export function getProtocolPda() {
  const [protocolPda] = PublicKey.findProgramAddressSync([Buffer.from('protocol')], program.programId)
  return protocolPda
}

/**
 * Get the program data PDA address
 * @param programId - The programId
 * @returns The program data PDA address
 */
export function getProgramData(programId?: PublicKey) {
  const resolvedProgramId = programId || program.programId
  const [programData] = PublicKey.findProgramAddressSync([resolvedProgramId.toBuffer()], BPF_LOADER_PROGRAM)
  return programData
}

/**
 * Get the config PDA
 * @returns The config PDA address
 */
export function getConfigPda() {
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId)
  return configPda
}

/**
 * Get the whitellist token PDA
 * @param token The address of the token
 * @returns The whitellist token PDA
 */
export function getWhitelistPda(token: PublicKey) {
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), token.toBuffer()],
    program.programId
  )
  return whitelistPda
}

export function getNonceCheckPda(nonceAccount: PublicKey) {
  const [noncePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nonce'), nonceAccount.toBuffer()],
    program.programId
  )
  return noncePda
}

export function getFeeReceiverPda(feeReceiver: PublicKey) {
  const [feeReceiverPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_receiver'), feeReceiver.toBuffer()],
    program.programId
  )
  return feeReceiverPda
}

/**
 * The parameters for getting the payment receipt PDA
 */
export type GetPaymentReceiptPdaParam = {
  /**
   * The tradeId
   */
  tradeId: string
  /**
   * The from user, who perform the payment
   * This user has to be the signer of the payment instruction
   */
  fromUser: PublicKey
  /**
   * The to user, who receive the payment
   */
  toUser: PublicKey
  /**
   * The amount of the payment, with decimals
   */
  amount: bigint
  /**
   * The protocol fee of the payment, with decimals
   */
  protocolFee: bigint
  /**
   * The token of the payment
   */
  token: PublicKey | null
}

/**
 * Get the payment receipt PDA address
 * @dev We use lot of informations to generate the PDA address to avoid collision, and support multiple payment for each trade
 * @param paymentArgs - The parameters for getting the payment receipt PDA
 * @returns The payment receipt PDA address
 */
export function getPaymentReceiptPda(paymentArgs: GetPaymentReceiptPdaParam) {
  const tradeIdBytes = bigintToBytes32(BigInt(paymentArgs.tradeId))
  const [paymentReceiptPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('payment_receipt'),
      Buffer.from(tradeIdBytes),
      paymentArgs.fromUser.toBuffer(),
      paymentArgs.toUser.toBuffer(),
      new BN(paymentArgs.amount.toString()).toArrayLike(Buffer, 'le', 8),
      new BN(paymentArgs.protocolFee.toString()).toArrayLike(Buffer, 'le', 8),
      paymentArgs.token ? paymentArgs.token.toBuffer() : PublicKey.default.toBuffer(),
    ],
    program.programId
  )
  return paymentReceiptPda
}

/**
 * Get the list of created PDA in a transaction
 * @dev To check whether a PDA is created in a transaction, we check inner transactions logs for the SystemProgram create account instruction
 * @param connection - A solana connection
 * @param txHash  - The transaction hash
 * @param programId - The programId, default is the optimex program
 * @param commitment - The finality of the transaction, default is confirmed
 */
export async function getCreatedPdaInTx(
  connection: Connection,
  txHash: string,
  programId: PublicKey = program.programId,
  commitment: Finality = 'confirmed'
): Promise<PublicKey[]> {
  // Get parsed transaction
  const parsedTx = await connection.getParsedTransaction(txHash, { commitment, maxSupportedTransactionVersion: 0 })
  // The PDA should be created in the inner instructions, not outside ins
  const innerIns = parsedTx?.meta?.innerInstructions?.flatMap((i) => i.instructions)
  // No inner instructions, return empty
  if (!innerIns) return []
  // Get all system instructions, system instructions must be a parsed instruction, not partially decoded transaction
  const systemIns = innerIns.filter(
    (i) => i.programId.toBase58() === SystemProgram.programId.toBase58() && 'parsed' in i
  ) as ParsedInstruction[]
  // Get Created account instructions
  const createdIns = systemIns.filter((si) => si.parsed.type === 'createAccount')
  // Get PDA with owner is the programId
  const createdPdaIns = createdIns.filter((ci) => ci.parsed.info.owner === programId.toBase58())
  const createdPda = createdPdaIns.map((ci) => new PublicKey(ci.parsed.info.newAccount))

  return createdPda
}

/**
 * Get the account of nonce check PDA that is closed in a transaction
 * @dev To check whether a nonce check PDA is closed in a transaction, we check that the PDA balance is changed from non-zero to zero
 * and the address is the match with the nonce check PDA
 * @param connection - A solana connection
 * @param txHash  - The transaction hash
 * @param tradeId:
 * @param programId - The programId, default is the optimex program
 * @param commitment - The finality of the transaction, default is confirmed
 */
export async function getClosedNonceCheck(
  connection: Connection,
  txHash: string,
  nonceAccount: PublicKey,
  commitment: Finality = 'confirmed'
): Promise<PublicKey | null> {
  // Get parsed transaction
  const parsedTx = await connection.getParsedTransaction(txHash, { commitment, maxSupportedTransactionVersion: 0 })
  // The PDA should be created in the inner instructions, not outside ins
  const preBalances = parsedTx?.meta?.preBalances || []
  const postBalances = parsedTx?.meta?.postBalances || []
  const accountsList = parsedTx?.transaction.message.accountKeys || []
  if (preBalances.length === 0) {
    return null
  }
  for (let i = 0; i < preBalances.length; i++) {
    // Balance change to zero, means the account is closed
    if (preBalances[i] !== 0 && postBalances[i] === 0) {
      const nonceCheckPda = getNonceCheckPda(nonceAccount)
      if (nonceCheckPda.toBase58() === accountsList[i].pubkey.toBase58()) {
        return nonceCheckPda
      }
    }
  }
  return null
}
