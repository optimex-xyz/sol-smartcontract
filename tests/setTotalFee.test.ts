import * as anchor from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from '../target/types/optimex_sol_smartcontract';
import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { createAccount, createTokenPair, getBlockTime, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { solverAddress } from './example-data';
import { createInitializeProgramInstructions } from '../solana-js/instructions/intialize';
import { createDepositAndVaultAtaIfNeededInstructions, DepositInstructionParam } from '../solana-js/instructions/deposit';
import { delay } from '../scripts/utils/helper';
import { createAddOperatorInstruction } from '../solana-js/instructions/manage_operator';
import { getWhitelistPda } from '../solana-js/pda/get_pda_address';
import { getTradeDetailData } from '../solana-js/pda/get_pda_data';
import { WSOL_MINT } from '../solana-js/constants';
import { createAddOrUpdateWhitelistInstruction } from '../solana-js/instructions/manage_config';
import { getTradeInput } from '../solana-js/utils/param_utils';
import { createSetTotalFeeInstructions } from '../solana-js/instructions/set_total_fee';

dotenv.config();

type TradeDetail = anchor.IdlTypes<OptimexSolSmartcontract>['tradeDetail'];

describe('Set Total Fee () functional testing', () => {
  // Configure the client to use the local cluster.
  const anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .OptimexSolSmartcontract as anchor.Program<OptimexSolSmartcontract>;

  const connection = anchorProvider.connection;
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const user = Keypair.generate();
  const mpcKey = Keypair.generate();
  const operator = Keypair.generate();
  const fakeMpcKey = Keypair.generate();

  describe('Setup program', async () => {
    it('Deploy init success', async () => {
      const instructions = await createInitializeProgramInstructions({ signer: deployer.publicKey, connection, admin: deployer.publicKey });
      const transaction = new Transaction().add(...instructions);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }

      await connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(mpcKey.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(operator.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.requestAirdrop(fakeMpcKey.publicKey, 10 * LAMPORTS_PER_SOL);
      await delay(3000);
    })

    it('Add operator successfully', async () => {
      const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const transaction = new Transaction().add(...addOperatorIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })
    it('Operator add whitelist for WSOL successfully', async () => {
      const whitelistToken = getWhitelistPda(WSOL_MINT);
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: 0.001 * LAMPORTS_PER_SOL,
        connection: connection,
      });
      const transaction = new Transaction().add(...addWhitelistIns);
      transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      await sendAndConfirmTransaction(connection, transaction, [operator], { commitment: 'confirmed' });
    });
  })
  describe('Set total fee', () => {
    const userEphemeralKey = Keypair.generate();
    const pmmKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const [fromToken, toToken] = createTokenPair();
    const amount = 0.05 * LAMPORTS_PER_SOL;
    let tradeId: string;
    let depositParams: DepositInstructionParam
    before(async () => {
      let currentTime = await getBlockTime(connection);
      depositParams = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount: amount,
        connection: connection,
        scriptTimeout: currentTime + 5,
        fromToken,
        toToken,
        solver: solverAddress,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId } = await getTradeInput(depositParams));
    })

    it('Deposit and have protocol fee is null', async () => {
      const instructions = await createDepositAndVaultAtaIfNeededInstructions(depositParams)
      try {
        const transaction = new Transaction().add(...instructions);
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = deployer.publicKey;
        const sig = await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey, deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const userTradeDetail = await getTradeDetailData(tradeId, connection);
      assert.isNull(userTradeDetail.totalFee, 'User trade detail should be null');
    });

    it('Set protocol fee successfully', async () => {
      const protocolFee = 0.001 * LAMPORTS_PER_SOL;
      const instructions = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: protocolFee,
        mpcPubkey: mpcKey.publicKey,
        connection: connection,
      })
      try {
        const transaction = new Transaction().add(...instructions);
        const sig = await sendAndConfirmTransaction(connection, transaction, [mpcKey], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const userTradeDetail = await getTradeDetailData(tradeId, connection);
      assert.equal(userTradeDetail.totalFee.toNumber(), protocolFee, 'User trade detail should be equal');
    });

    it('Update protocol fee successfully', async () => {
      const protocolFee = 0.002 * LAMPORTS_PER_SOL;
      const instructions = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: protocolFee,
        mpcPubkey: mpcKey.publicKey,
        connection: connection,
      })
      try {
        const transaction = new Transaction().add(...instructions);
        const sig = await sendAndConfirmTransaction(connection, transaction, [mpcKey], { commitment: 'confirmed' });
      } catch (error) {
        console.log('Error: ', error);
        throw error;
      }
      const userTradeDetail = await getTradeDetailData(tradeId, connection);
      assert.equal(userTradeDetail.totalFee.toNumber(), protocolFee, 'User trade detail should be equal');
    });

    it('Update protocol fee failed because of unauthorized', async () => {
      const protocolFee = 0.002 * LAMPORTS_PER_SOL;
      const instructions = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: protocolFee,
        mpcPubkey: fakeMpcKey.publicKey,
        connection: connection,
      })
      try {
        const transaction = new Transaction().add(...instructions);
        const sig = await sendAndConfirmTransaction(connection, transaction, [fakeMpcKey], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('Unauthorized')).to.be.true;
      }
    });
    
    it('Update protocol fee failed because of invalid total fee', async () => {
      const protocolFee = 1000 * LAMPORTS_PER_SOL;
      const instructions = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: protocolFee,
        mpcPubkey: mpcKey.publicKey,
        connection: connection,
      })
      try {
        const transaction = new Transaction().add(...instructions);
        const sig = await sendAndConfirmTransaction(connection, transaction, [mpcKey], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('InvalidTotalFee')).to.be.true;
      }
    });

    it('Update protocol fee failed because of timeout', async () => {
      const protocolFee = 0.002 * LAMPORTS_PER_SOL;
      await sleep(6000);
      const instructions = await createSetTotalFeeInstructions({
        tradeId: tradeId,
        amount: protocolFee,
        mpcPubkey: mpcKey.publicKey,
        connection: connection,
      })
      try {
        const transaction = new Transaction().add(...instructions);
        const sig = await sendAndConfirmTransaction(connection, transaction, [mpcKey], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString().includes('TimeOut')).to.be.true;
      }
    });
  });
});
