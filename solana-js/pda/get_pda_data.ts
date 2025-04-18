import { Commitment, Connection, PublicKey } from '@solana/web3.js'

import { getConfigPda, getFeeReceiverPda, getUserTradeDetailPda, getWhitelistPda } from './get_pda_address'

import { getOptimexProgram } from '../artifacts'
import { FetchAccountError } from '../errors/fetch_account_error'
import { bigintToBytes32 } from '../utils/parse_utils'

/**
 * Get the trade detail data for a given trade id
 * @param tradeId - The trade id
 * @param connection - The connection to the Solana network
 * @returns The trade detail data
 * @throws FetchAccountError if the trade detail data cannot be fetched
 */
export async function getTradeDetailData(
  tradeId: string,
  connection: Connection,
  commitment: Commitment = 'confirmed'
) {
  const onchainProgram = await getOptimexProgram(connection)
  const userTradeDetail = getUserTradeDetailPda(tradeId)
  try {
    const userTradeDetailData = await onchainProgram.account.tradeDetail.fetch(userTradeDetail, commitment)
    return userTradeDetailData
  } catch {
    throw new FetchAccountError(userTradeDetail.toBase58(), { type: 'TradeDetail', tradeId })
  }
}

/**
 *
 * Get the config account data of the program
 * @param connection The connection to Solana network
 * @returns The config account data
 * @throws FetchAccountError if the config data cannot be fetched
 */
export async function getConfigData(connection: Connection, commitment: Commitment = 'confirmed') {
  const onchainProgram = await getOptimexProgram(connection)
  const configPda = getConfigPda()
  try {
    const configData = await onchainProgram.account.config.fetch(configPda, commitment)
    return configData
  } catch {
    throw new FetchAccountError(configPda.toBase58(), { type: 'Config' })
  }
}

/**
 * Get the whitelist token data
 * @param token The address of the token
 * @returns The whitelist token data
 */
export async function getWhitelistTokenData(
  token: PublicKey,
  connection: Connection,
  commitment: Commitment = 'confirmed'
) {
  const onchainProgram = await getOptimexProgram(connection)
  const whitelistPda = getWhitelistPda(token)
  try {
    const whitelistTokenData = await onchainProgram.account.whitelistToken.fetch(whitelistPda, commitment)
    return whitelistTokenData
  } catch {
    throw new FetchAccountError(whitelistPda.toBase58(), { type: 'WhitelistToken', token: token.toBase58() })
  }
}

/**
 * Get the payment receipt data
 * @param paymentReceiptPda - The payment receipt PDA
 * @param connection - The connection to the Solana network
 * @returns The payment receipt data
 * @throws FetchAccountError if the payment receipt data cannot be fetched
 */
export async function getPaymentReceiptData(
  paymentReceiptPda: PublicKey,
  connection: Connection,
  commitment: Commitment = 'confirmed'
) {
  const onchainProgram = await getOptimexProgram(connection)
  try {
    const paymentReceiptData = await onchainProgram.account.paymentReceipt.fetch(paymentReceiptPda, commitment)
    return paymentReceiptData
  } catch {
    throw new FetchAccountError(paymentReceiptPda.toBase58(), { type: 'PaymentReceipt' })
  }
}

/**
 * The parameters for getting the payment receipt addresses
 */
export type GetPaymentReceiptAddressesFilter = {
  /**
   * The trade id
   * If null, don't apply this filter
   */
  tradeId?: string
  /**
   * The from user, who perform the payment
   * If null, don't apply this filter
   */
  fromUser?: PublicKey

  /**
   * The to user, who receive the payment
   * If null, don't apply this filter
   */
  toUser?: PublicKey
}
/**
 * Get all payment receipt addresses
 * @param connection - The connection to the Solana network
 * @returns The payment receipt addresses
 */
export async function getPaymentReceiptAddresses(connection: Connection, filter: GetPaymentReceiptAddressesFilter) {
  const onchainProgram = await getOptimexProgram(connection)
  const allReceipts = await onchainProgram.account.paymentReceipt.all()
  let filteredReceipts = allReceipts
  if (filter.tradeId != undefined && filter.tradeId != null) {
    const tradeIdBytes = bigintToBytes32(BigInt(filter.tradeId))
    filteredReceipts = filteredReceipts.filter(
      (receipt) => receipt.account.tradeId.toString() === tradeIdBytes.toString()
    )
  }
  if (filter.fromUser != undefined && filter.fromUser != null) {
    filteredReceipts = filteredReceipts.filter(
      (receipt) => receipt.account.fromPubkey.toBase58() === filter.fromUser!.toBase58()
    )
  }

  if (filter.toUser != undefined && filter.toUser != null) {
    filteredReceipts = filteredReceipts.filter(
      (receipt) => receipt.account.toPubkey.toBase58() === filter.toUser!.toBase58()
    )
  }
  return filteredReceipts
}

export async function getFeeReceiverData(
  feeReceiver: PublicKey,
  connection: Connection,
  commitment: Commitment = 'confirmed'
) {
  const onchainProgram = await getOptimexProgram(connection)
  const feeReceiverPda = getFeeReceiverPda(feeReceiver)
  try {
    const feeReceiverData = await onchainProgram.account.feeReceiver.fetch(feeReceiverPda, commitment)
    return feeReceiverData
  } catch {
    throw new FetchAccountError(feeReceiverPda.toBase58(), { type: 'FeeReceiver', feeReceiver: feeReceiver.toBase58() })
  }
}
