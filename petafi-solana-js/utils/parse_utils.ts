import { SimpleToken } from "../types";
import { ethers, AbiCoder, sha256, getBytes } from "ethers";
import { TradeInfoStruct } from "../types/trade_info";
import { InvalidParamError } from "../errors";
import { Connection, Keypair } from "@solana/web3.js";

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * Convert the amount of ether in string to bytes32, pad to 32 bytes
 * @param value - The amount in string
 * @returns The bytes32 representation of the amount
 * @example
 * Here is the example of the amount of 100,000
 * const result = parseEtherToBytes32(100000);
 * result = [
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 1, 134, 160 ]
 * 
 * Explain: 160 * 256^0 + 134 * 256^1 + 1 * 256^2 = 100,000
 */
export function parseEtherToBytes32(value: string): number[] {
    // Directly convert to number instead of using parseEther
    const amount = BigInt(value);

    // Convert to hex, pad to 64 chars (32 bytes) and remove 0x
    const hex = amount.toString(16).padStart(64, '0');
    return Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Convert the amount in BigInt to bytes32, pad to 32 bytes
 * @param value - The amount of ether
 * @returns The bytes32 representation of the amount
 * @example
 * Here is the example of the amount of 100,000
 * const result = parseEtherToBytes32(BigInt(100000));
 * result = [
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 0, 0, 0, 0, 0, 0, 0,
 * 0, 0, 1, 134, 160 ]
 * 
 * Explain: 160 * 256^0 + 134 * 256^1 + 1 * 256^2 = 100,000
 */
export function bigintToBytes32(value: bigint): number[] {
    // Convert to hex, pad to 64 chars (32 bytes) and remove 0x
    const hex = value.toString(16).padStart(64, '0');
    return Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Encode the address to the correct format depending on the network type
 * @param address - The address to encode
 * @param token - The token
 * @returns The encoded address
 */
export const encodeAddress = (address: string, token: SimpleToken) => {
    const networkId = token.networkId.toUpperCase();
    if (networkId.includes('SOLANA')) {
        return ethers.toUtf8Bytes(address);
        // return new PublicKey(address).toBuffer();
    } else if (networkId.includes('ETHEREUM')) {
        return ethers.hexlify(address);
    } else if (networkId.includes('BITCOIN')) {
        return ethers.toUtf8Bytes(address);
    } else {
        throw new Error(`Unsupported network: ${token.networkType}`);
    }
};

/**
 * Derive the trade id from the session id, solver address, and trade info
 * @param sessionId - The session id
 * @param solverAddress - The solver address
 * @param tradeInfo - The trade info
 * @returns The trade id
 */
export function getTradeId(
    sessionId: bigint,
    solverAddress: string,
    tradeInfo: TradeInfoStruct
): string {
    const encodedData: string = abiCoder.encode(
        ['uint256', 'address', 'tuple(uint256,bytes[3],bytes[3])'],
        [
            sessionId,
            solverAddress,
            [tradeInfo.amountIn, tradeInfo.fromChain, tradeInfo.toChain],
        ]
    );

    // return bigintToBytes32(BigInt(sha256(encodedData)));
    return sha256(encodedData);
}

export function getSolanaUserEphemeralKeys(signature: string) {
    const seed = signature.startsWith('0x') ? signature.slice(2) : signature;
    if (seed.length < 64) {
        throw new InvalidParamError('Insufficient length for seed', {'minLength': '64'});
    }
    const ephemeralSeed: string = '0x' + seed.slice(-64);
    return Keypair.fromSeed(getBytes(ephemeralSeed));
}

export async function getBlockTime(connection: Connection) {
    const slot = await connection.getSlot({ commitment: 'confirmed' });
    const blockTime = await connection.getBlockTime(slot);
    return blockTime;
}