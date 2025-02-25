import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
// Use this instead of Wallet from '@coral-xyz/anchor', because the latter is not compatible with the front-end
import Wallet from "@coral-xyz/anchor/dist/cjs/nodewallet"
import { PetaFiSolSmartcontract } from './peta_fi_sol_smartcontract';
import IDL from './peta_fi_sol_smartcontract.json';
import { Connection, Keypair } from '@solana/web3.js';

// Keypair for initialize provider, just for reading on-chain state
const dummyWallet = new Wallet(Keypair.generate());

let petaFiProgram: Program<PetaFiSolSmartcontract> | null = null;
let offchainProgram: Program<PetaFiSolSmartcontract> | null = null;

export const getOffchainProgram = () => {
    if (offchainProgram) return offchainProgram;
    const provider = new anchor.AnchorProvider(new Connection('http://127.0.0.1:8899'), dummyWallet, { commitment: 'confirmed' });
    const program = new anchor.Program(
        IDL as PetaFiSolSmartcontract,
        provider,
    );
    offchainProgram = program;
    return offchainProgram;
}

export const getPetaFiProgram = (connection: Connection) => {
    if (petaFiProgram) return petaFiProgram;
    const provider = new anchor.AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
    const program = new anchor.Program(
        IDL as PetaFiSolSmartcontract,
        provider,
    );
    petaFiProgram = program;
    return petaFiProgram;
}
