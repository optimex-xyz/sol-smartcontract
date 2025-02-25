import * as anchor from "@coral-xyz/anchor";
import { PetaFiSolSmartcontract } from "../artifacts/peta_fi_sol_smartcontract";
import { BytesLike, BigNumberish } from "ethers";

export type TradeInput = anchor.IdlTypes<PetaFiSolSmartcontract>['tradeInput'];
export type TradeInfo = anchor.IdlTypes<PetaFiSolSmartcontract>['tradeInfo'];
export type TradeDetail = anchor.IdlTypes<PetaFiSolSmartcontract>['tradeDetail'];
export type PaymentReceipt = anchor.IdlTypes<PetaFiSolSmartcontract>['paymentReceipt'];
export type TradeDetailInput = anchor.IdlTypes<PetaFiSolSmartcontract>['tradeDetailInput'];
export type TradeInfoStruct = {
    amountIn: BigNumberish;
    fromChain: [BytesLike, BytesLike, BytesLike];
    toChain: [BytesLike, BytesLike, BytesLike];
};