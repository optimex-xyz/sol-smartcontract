import { TradeInfo, TradeInput } from "../types/trade_info";
import { toUtf8Bytes } from "ethers";
import { DepositInstructionParam } from "../instructions/deposit";
import { bigintToBytes32, encodeAddress, getTradeId, parseEtherToBytes32 } from "./parse_utils";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { SimpleToken } from "../types";

/**
 * The parameters for getting the trade input
 */
export type GetTradeInputParams = Pick<DepositInstructionParam, 'userPubkey' | 'toUserAddress' | 'solver' | 'amount' | 'sessionId' | 'connection'> & {
  /**
   * The token information that we are depositing
   */
    fromToken: SimpleToken,
    /**
     * The token information that we want to receive
     */
    toToken: SimpleToken,
}

/**
 * Return necessary information and data for submitting a trade on-chain
 * @param params - The parameters for creating a trade
 * @returns The trade input, the deposit amount with decimals, and the tradeId, and whether the token is native token
 */
export async function getTradeInput(
    params: GetTradeInputParams,
  ) {
    const { connection, fromToken, userPubkey, toToken, toUserAddress, solver, amount, sessionId } = params;

    let depositAmount: string;

    const isNativeToken = fromToken.tokenAddress === 'native';

    if (!isNativeToken) {
        const mintData = await getMint(
            connection,
            new PublicKey(fromToken.tokenAddress)
        );
        depositAmount = (
            Number(amount) * Math.pow(10, mintData.decimals)
        ).toString();
    } else {
        depositAmount = (Number(amount) * LAMPORTS_PER_SOL).toString();
    }
    const fromChain: Uint8Array[] = [
        encodeAddress(userPubkey.toString(), fromToken) as any,
        toUtf8Bytes(fromToken.networkId),
        toUtf8Bytes(fromToken.tokenAddress),
    ];

    const toChain: Uint8Array[] = [
        encodeAddress(toUserAddress, toToken) as any,
        toUtf8Bytes(toToken.networkId),
        toUtf8Bytes(toToken.tokenAddress),
    ];

    const fromChainAsBuffer: Buffer[] = fromChain.map((u8Array) =>
      Buffer.from(u8Array)
    );
  
    const toChainAsBuffer: Buffer[] = toChain.map((u8Array) =>
      Buffer.from(u8Array)
    );
  
    const tradeInfo: TradeInfo = {
      amountIn: parseEtherToBytes32(depositAmount),
      fromChain: fromChainAsBuffer,
      toChain: toChainAsBuffer,
    };
  
    const tradeInput: TradeInput = {
      sessionId: bigintToBytes32(BigInt(sessionId)),
      solver: Array.from(Buffer.from(solver.replace('0x', ''), 'hex')),
      tradeInfo: tradeInfo,
    };

    const tradeId = getTradeId(
      sessionId,
      solver,
      {
        amountIn: BigInt(depositAmount),
        fromChain: tradeInput.tradeInfo.fromChain as any,
        toChain: tradeInput.tradeInfo.toChain as any,
      }
    )
  
    return { tradeInput, depositAmount, isNativeToken, tradeId }
}


