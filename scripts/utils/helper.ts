import { Connection, Keypair } from "@solana/web3.js";
import fs from 'fs';

export function bigintToBytes32(value: bigint): number[] {
  // Convert to hex, pad to 64 chars (32 bytes) and remove 0x
  const hex = value.toString(16).padStart(64, '0');
  return Array.from(Buffer.from(hex, 'hex'));
}

export async function getBlockTime(connection: Connection) {
  const slotHeight = await connection.getSlot('confirmed');
  const blockTime = await connection.getBlockTime(slotHeight);
  return blockTime;
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getKeypairFromFile(filePath: string): Keypair {
  const data = fs.readFileSync(filePath);
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(data.toString()))
  );
}
