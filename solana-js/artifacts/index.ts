import * as anchor from '@coral-xyz/anchor';
import { Program  } from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from './optimex_sol_smartcontract';
import IDL from './optimex_sol_smartcontract.json';
import { Connection } from '@solana/web3.js';


let onchainProgram: Program<OptimexSolSmartcontract> | null = null;
let offchainProgram: Program<OptimexSolSmartcontract> | null = null;

export const getOffchainProgram = () => {
    if (offchainProgram) return offchainProgram;
    const provider = new anchor.AnchorProvider(new Connection('http://127.0.0.1:8899'), {} as any, { commitment: 'confirmed' });
    const program = new anchor.Program(
        IDL as OptimexSolSmartcontract,
        provider,
    );
    offchainProgram = program;
    return offchainProgram;
}

export const getOptimexProgram = (connection: Connection) => {
    if (onchainProgram) return onchainProgram;
    const provider = new anchor.AnchorProvider(connection, {} as any, { commitment: 'confirmed' });
    const program = new anchor.Program(
        IDL as OptimexSolSmartcontract,
        provider,
    );
    onchainProgram = program;
    return onchainProgram;
}
