import * as anchor from "@coral-xyz/anchor";
import { OptimexSolSmartcontract } from "../artifacts/optimex_sol_smartcontract";
import { BytesLike, BigNumberish } from "ethers";

export type TradeInput = anchor.IdlTypes<OptimexSolSmartcontract>['tradeInput'];
export type TradeInfo = anchor.IdlTypes<OptimexSolSmartcontract>['tradeInfo'];
export type TradeDetail = anchor.IdlTypes<OptimexSolSmartcontract>['tradeDetail'];
export type PaymentReceipt = anchor.IdlTypes<OptimexSolSmartcontract>['paymentReceipt'];
export type TradeDetailInput = anchor.IdlTypes<OptimexSolSmartcontract>['tradeDetailInput'];
export type TradeInfoStruct = {
    amountIn: BigNumberish;
    fromChain: [BytesLike, BytesLike, BytesLike];
    toChain: [BytesLike, BytesLike, BytesLike];
};