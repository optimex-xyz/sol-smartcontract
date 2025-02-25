import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PetaFiSolSmartcontract } from '../target/types/peta_fi_sol_smartcontract';
import {
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { getProtocolPda, getVaultPda } from '../petafi-solana-js';
import { createInitializePetaFiInstructions } from '../petafi-solana-js/instructions/intialize';
import { createAddOperatorInstruction, createRemoveOperatorInstruction } from '../petafi-solana-js/instructions/manage_operator';
import { getConfigData, getFeeReceiverData, getWhitelistTokenData } from '../petafi-solana-js/pda/get_pda_data';
import { getConfigPda, getFeeReceiverPda, getWhitelistPda } from '../petafi-solana-js/pda/get_pda_address';
import { createAddFeeReceiverInstruction, createAddOrUpdateWhitelistInstruction, createRemoveFeeReceiverInstruction, createRemoveWhitelistInstruction } from '../petafi-solana-js/instructions/manage_config';
import { WSOL_MINT } from '../petafi-solana-js/constants';
import { sleep } from './utils';

dotenv.config();

describe('Admin manage functional testing', () => {
  // Configure the client to use the local cluster.
  const anchorProvider = anchor.AnchorProvider.env();
  const connection = anchorProvider.connection;
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .PetaFiSolSmartcontract as Program<PetaFiSolSmartcontract>;

  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const admin = Keypair.generate();
  const oldAdmin = Keypair.generate();
  const vaultPda = getVaultPda();
  const protocolPda = getProtocolPda();

  before('Setup', async () => {
    await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
    await sleep(3000);
  })

  describe('Initialize', async () => {
    it('Init without admin success', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: null });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      const configPda = await getConfigPda();
      assert.isNotNull(configPda, 'Config PDA should not be null');
    })

    it('Init with admin success', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: oldAdmin.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const configData = await getConfigData(connection);
      assert.equal(configData.admin.toBase58(), oldAdmin.publicKey.toBase58(), 'Admin mismatch');
      assert.equal(configData.operators.length, 0, 'Operator length should be 0');
    });

    it('Init failed because of unauthorized', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: admin.publicKey, connection, admin: admin.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized'));
      }
    })

    it('Init and set admin again success', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: admin.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const configData = await getConfigData(connection);
      assert.equal(configData.admin.toBase58(), admin.publicKey.toBase58(), 'Admin mismatch');
      assert.equal(configData.operators.length, 0, 'Operator length should be 0');
    });

    it('Init without admin will not change admin', async () => {
      const instructions = await createInitializePetaFiInstructions({ signer: deployer.publicKey, connection, admin: null });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      const configData = await getConfigData(connection);
      assert.equal(configData.admin.toBase58(), admin.publicKey.toBase58(), 'Admin mismatch');
      assert.equal(configData.operators.length, 0, 'Operator length should be 0');
    });
  });

  describe('Manage operator', () => {
    const newOperator = Keypair.generate();
    it('Add operator failed because of unauthorized', async () => {
      const instruction = await createAddOperatorInstruction({
        signer: newOperator.publicKey,
        operator: newOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [newOperator], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized'));
      }
    })
    it('Add operator success', async () => {
      const instruction = await createAddOperatorInstruction({
        signer: admin.publicKey,
        operator: newOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const configData = await getConfigData(connection);
      assert.equal(configData.operators.length, 1, 'Operator length should be 1');
      assert.equal(configData.operators[0].toBase58(), newOperator.publicKey.toBase58(), 'Operator mismatch');
    })

    it('Add operator failed because of operator already existed', async () => {
      const instruction = await createAddOperatorInstruction({
        signer: admin.publicKey,
        operator: newOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('OperatorAlreadyExists'));
      }

      const configData = await getConfigData(connection);
      assert.equal(configData.operators.length, 1, 'Operator length should be 1');
      assert.equal(configData.operators[0].toBase58(), newOperator.publicKey.toBase58(), 'Operator mismatch');
    })

    it('Remove operator failed because not existed operator', async () => {
      const fakeOperator = Keypair.generate();
      const instruction = await createRemoveOperatorInstruction({
        signer: admin.publicKey,
        operator: fakeOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('OperatorNotFound'));
      }
    })

    it('Remove operator success', async () => {
      const instruction = await createRemoveOperatorInstruction({
        signer: admin.publicKey,
        operator: newOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const configData = await getConfigData(connection);
      assert.equal(configData.operators.length, 0, 'Operator length should be 0');
    })

    it('Add up to 3 operator success', async () => {
      const operators = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const instructions: TransactionInstruction[] = [];
      for (const operator of operators) {
        const instruction = await createAddOperatorInstruction({
          signer: admin.publicKey,
          operator: operator.publicKey,
          connection,
        });
        instructions.push(...instruction);
      }
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const configData = await getConfigData(connection);
      assert.equal(configData.operators.length, 3, 'Operator length should be 0');
      assert.equal(configData.operators[0].toBase58(), operators[0].publicKey.toBase58(), 'Operator mismatch');
      assert.equal(configData.operators[1].toBase58(), operators[1].publicKey.toBase58(), 'Operator mismatch');
      assert.equal(configData.operators[2].toBase58(), operators[2].publicKey.toBase58(), 'Operator mismatch');

      const removeInstructions: TransactionInstruction[] = [];
      for (const operator of operators) {
        const instruction = await createRemoveOperatorInstruction({
          signer: admin.publicKey,
          operator: operator.publicKey,
          connection,
        });
        removeInstructions.push(...instruction);
      }
      const removeTransaction = new Transaction().add(...removeInstructions);
      try {
        await sendAndConfirmTransaction(connection, removeTransaction, [admin], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
    })
  })

  describe('Manage whitelist', async () => {
    const newOperator = Keypair.generate();
    const fakeOperator = Keypair.generate();
    before('Add and fund operator success', async () => {
      await connection.requestAirdrop(newOperator.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(fakeOperator.publicKey, 10 * LAMPORTS_PER_SOL);
      const instruction = await createAddOperatorInstruction({
        signer: admin.publicKey,
        operator: newOperator.publicKey,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const configData = await getConfigData(connection);
      assert.equal(configData.operators.length, 1, 'Operator length should be 1');
      assert.equal(configData.operators[0].toBase58(), newOperator.publicKey.toBase58(), 'Operator mismatch');
    })

    it(`Add whitelist success`, async () => {
      const minAmount = '0.01';
      const instruction = await createAddOrUpdateWhitelistInstruction({
        operator: newOperator.publicKey,
        token: WSOL_MINT,
        connection,
        amount: minAmount,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [newOperator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const whitelistTokenData = await getWhitelistTokenData(WSOL_MINT, connection);
      assert.equal(whitelistTokenData.token.toBase58(), WSOL_MINT.toBase58(), 'Token mismatch');
      assert.equal(whitelistTokenData.amount.toString(), (Number(minAmount) * LAMPORTS_PER_SOL).toString(), 'Amount mismatch');
    })

    it('Add whitelist failed because of unathorized operator', async () => {
      const minAmount = '0.01';
      const instruction = await createAddOrUpdateWhitelistInstruction({
        operator: fakeOperator.publicKey,
        token: WSOL_MINT,
        connection,
        amount: minAmount,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [fakeOperator], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized'));
      }
    })

    it('Update whitelist success', async () => {
      const minAmount = '0.02';
      const instruction = await createAddOrUpdateWhitelistInstruction({
        operator: newOperator.publicKey,
        token: WSOL_MINT,
        connection,
        amount: minAmount,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [newOperator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }

      const whitelistTokenData = await getWhitelistTokenData(WSOL_MINT, connection);
      assert.equal(whitelistTokenData.token.toBase58(), WSOL_MINT.toBase58(), 'Token mismatch');
      assert.equal(whitelistTokenData.amount.toString(), (Number(minAmount) * LAMPORTS_PER_SOL).toString(), 'Amount mismatch');
    })

    it('Remove whitelist success', async () => {
      const instruction = await createRemoveWhitelistInstruction({
        operator: newOperator.publicKey,
        token: WSOL_MINT,
        connection,
      });
      const transaction = new Transaction().add(...instruction);
      try {
        await sendAndConfirmTransaction(connection, transaction, [newOperator], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const whitelistTokenPda = getWhitelistPda(WSOL_MINT);
      const whitelistTokenInfo = await connection.getAccountInfo(whitelistTokenPda);
      assert.isNull(whitelistTokenInfo, 'Whitelist token PDA should be null');
    })
  })

  describe('Manage fee receiver', async () => {
    const feeReceiver = Keypair.generate();
    it('Add fee receiver success', async () => {
      const instruction = await createAddFeeReceiverInstruction({
        signer: admin.publicKey,
        connection,
        receiver: feeReceiver.publicKey,
      });

      try {
        const transaction = new Transaction().add(...instruction);
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
        const feeReceiverData = await getFeeReceiverData(feeReceiver.publicKey, connection);
        assert.equal(feeReceiverData.receiver.toBase58(), feeReceiver.publicKey.toBase58(), 'Fee receiver mismatch');
      } catch (error) {
        console.log(error);
        throw error;  
      }
    })

    it('Add fee receiver failed because of unauthorized', async () => {
      const instruction = await createAddFeeReceiverInstruction({
        signer: deployer.publicKey,
        connection,
        receiver: feeReceiver.publicKey,
      });

      try {
        const transaction = new Transaction().add(...instruction);
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized'));
      }
    })

    it('Remove fee receiver failed when unauthorized', async () => {
      const instruction = await createRemoveFeeReceiverInstruction({
        signer: deployer.publicKey,
        connection,
        receiver: feeReceiver.publicKey,
      });

      try {
        const transaction = new Transaction().add(...instruction);
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized'));
      }
    })

    it('Remove fee receiver success', async () => {
      const instruction = await createRemoveFeeReceiverInstruction({
        signer: admin.publicKey,
        connection,
        receiver: feeReceiver.publicKey,
      });

      try {
        const transaction = new Transaction().add(...instruction);
        await sendAndConfirmTransaction(connection, transaction, [admin], { commitment: 'confirmed' });
        const feeReceiverPda = getFeeReceiverPda(feeReceiver.publicKey);
        const feeReceiverInfo = await connection.getAccountInfo(feeReceiverPda, "confirmed");
        assert.isNull(feeReceiverInfo, 'Fee receiver should be null');
      } catch (error) {
        console.log(error);
        throw error;  
      }
    })
  })
});

