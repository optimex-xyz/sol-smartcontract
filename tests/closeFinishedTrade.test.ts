import * as anchor from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from '../target/types/optimex_sol_smartcontract';
import {
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { assert } from 'chai';
import { airdropTokenToUser, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { solverAddress } from './example-data';
import {
  createMint,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { bigintToBytes32, getProtocolPda, getUserTradeDetailPda } from '../solana-js';
import { DepositInstructionParam } from '../solana-js/instructions/deposit';
import { delay } from '../scripts/utils/helper';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions  } from '../solana-js/instructions/deposit';
import { createAssociatedTokenAccountInstructionIfNeeded } from '../solana-js/instructions/helpers';
import { createInitializeProgramInstructions } from '../solana-js/instructions/intialize';
import { createAddOperatorInstruction } from '../solana-js/instructions/manage_operator';
import { createAddOrUpdateWhitelistInstruction, createSetCloseWaitDurationInstruction } from '../solana-js/instructions/manage_config';
import { WSOL_MINT } from '../solana-js/constants';
import { getNonceCheckPda, getTradeVaultPda } from '../solana-js/pda/get_pda_address';
import { getTradeDetailData } from '../solana-js/pda/get_pda_data';
import { createCloseFinishedTradeInstructions } from '../solana-js/instructions/close_finished_trade';
import { getTradeInput } from '../solana-js/utils/param_utils';
dotenv.config();

describe('Close finished trade functional testing', () => {
  // Configure the client to use the local cluster.
  const anchorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(anchorProvider);

  const program = anchor.workspace
    .OptimexSolSmartcontract as anchor.Program<OptimexSolSmartcontract>;

  const connection = anchorProvider.connection;
  const deployer = (anchorProvider.wallet as anchor.Wallet).payer;
  const user = Keypair.generate();
  const mpcKey = Keypair.generate();
  const pmm = Keypair.generate();
  const protocolPda = getProtocolPda();
  const operator = Keypair.generate();

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
      await delay(3000);
    })

    it('Add operator success', async () => {
      const addOperatorIns = await createAddOperatorInstruction({
        signer: deployer.publicKey,
        operator: operator.publicKey,
        connection: connection,
      });
      const addOperatorTransaction = new Transaction().add(...addOperatorIns);
      await sendAndConfirmTransaction(connection, addOperatorTransaction, [deployer], { commitment: 'confirmed' });
    })

    it('Set close wait duration success', async () => {
      const setCloseWaitDurationIns = await createSetCloseWaitDurationInstruction({
        operator: operator.publicKey,
        closeTradeDuration: 5,
        connection: connection,
      });
      const setCloseWaitDurationTransaction = new Transaction().add(...setCloseWaitDurationIns);
      await sendAndConfirmTransaction(connection, setCloseWaitDurationTransaction, [operator], { commitment: 'confirmed' });
    })
  })

  describe('Any user close settled trade with SOL success', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = (0.1 * LAMPORTS_PER_SOL)
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    before(async () => {
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount: BigInt(amount),
        connection,
        scriptTimeout: await getBlockTime(connection) + 3,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      correctUserAccount = {
        userAccount: user.publicKey,
        userEphemeralAccount: userEphemeralKey.publicKey,
        userTradeDetail: correctUserTradeDetail,
        refundAccount: refundKey.publicKey,
        pmm: pmm.publicKey,
        signer: mpcKey.publicKey,
        vault: getTradeVaultPda(correctTradeId),
      };
    })

    it('Settlement() success', async () => {
      const vaultPda = getTradeVaultPda(correctTradeId);
      const beforeVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const beforeUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const beforePmmBalance = await connection.getBalance(pmm.publicKey, 'confirmed');
      const nonceCheckPda = getNonceCheckPda(userEphemeralKey.publicKey);
      const nonceCheckAccountBalance = await connection.getBalance(nonceCheckPda, 'confirmed');
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      assert.equal(beforeVaultBalance - afterVaultBalance, Number(amount), 'Vault balance should be decreased by the amount of SOL');
      const afterUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, nonceCheckAccountBalance, 'User balance should be increased by the amount of SOL nonceCheckAccount');
      const afterPmmBalance = await connection.getBalance(pmm.publicKey, 'confirmed');
      assert.equal(afterPmmBalance - beforePmmBalance, Number(amount), 'Pmm balance should be increased by the amount deposit');
    })

    it('Close settled trade with SOL success', async () => {
      // Timeout is 5 seconds,
      await sleep(9000);
      const closeFinishedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: user.publicKey,
      });
      const closeFinishedTradeTransaction = new Transaction().add(...closeFinishedTradeIns);
      const tradeDetailData = await getTradeDetailData(correctTradeId, connection);
      const beforeUserBalance = await connection.getBalance(tradeDetailData.userPubkey, 'confirmed');
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const tradeDetailBalance = await connection.getBalance(tradeDetailPda, 'confirmed');
      try {
        await sendAndConfirmTransaction(connection, closeFinishedTradeTransaction, [user], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterUserBalance = await connection.getBalance(tradeDetailData.userPubkey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, vaultBalance + tradeDetailBalance, 'User balance should be increased by the amount of SOL nonceCheckAccount');
      const vaultInfo = await connection.getAccountInfo(vaultPda, 'confirmed');
      assert.isNull(vaultInfo, 'Vault should be deleted');
      const tradeDetailInfo = await connection.getAccountInfo(tradeDetailPda, 'confirmed');
      assert.isNull(tradeDetailInfo, 'Trade detail should be deleted');
    })
  })

  describe('MPC close settled trade with SOL success', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = (0.1 * LAMPORTS_PER_SOL);
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    before(async () => {
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount: BigInt(amount),
        connection,
        scriptTimeout: await getBlockTime(connection) + 3,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      correctUserAccount = {
        userAccount: user.publicKey,
        userEphemeralAccount: userEphemeralKey.publicKey,
        userTradeDetail: correctUserTradeDetail,
        refundAccount: refundKey.publicKey,
        pmm: pmm.publicKey,
        signer: mpcKey.publicKey,
        vault: getTradeVaultPda(correctTradeId),
      };
    })

    it('Settlement() success', async () => {
      const vaultPda = getTradeVaultPda(correctTradeId);
      const beforeVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const beforeUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      const beforePmmBalance = await connection.getBalance(pmm.publicKey, 'confirmed');
      const nonceCheckPda = getNonceCheckPda(userEphemeralKey.publicKey);
      const nonceCheckAccountBalance = await connection.getBalance(nonceCheckPda, 'confirmed');
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      assert.equal(beforeVaultBalance - afterVaultBalance, Number(amount), 'Vault balance should be decreased by the amount of SOL');
      const afterUserBalance = await connection.getBalance(user.publicKey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, nonceCheckAccountBalance, 'User balance should be increased by the amount of SOL nonceCheckAccount');
      const afterPmmBalance = await connection.getBalance(pmm.publicKey, 'confirmed');
      assert.equal(afterPmmBalance - beforePmmBalance, Number(amount), 'Pmm balance should be increased by the amount deposit');
    })

    it('Close settled trade with SOL success', async () => {
      const closeFinishedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: mpcKey.publicKey,
      });
      const closeFinishedTradeTransaction = new Transaction().add(...closeFinishedTradeIns);
      const tradeDetailData = await getTradeDetailData(correctTradeId, connection);
      const beforeUserBalance = await connection.getBalance(tradeDetailData.userPubkey, 'confirmed');
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const tradeDetailBalance = await connection.getBalance(tradeDetailPda, 'confirmed');
      try {
        await sendAndConfirmTransaction(connection, closeFinishedTradeTransaction, [mpcKey], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterUserBalance = await connection.getBalance(tradeDetailData.userPubkey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, vaultBalance + tradeDetailBalance, 'User balance should be increased by the amount of SOL nonceCheckAccount');
      const vaultInfo = await connection.getAccountInfo(vaultPda, 'confirmed');
      assert.isNull(vaultInfo, 'Vault should be deleted');
      const tradeDetailInfo = await connection.getAccountInfo(tradeDetailPda, 'confirmed');
      assert.isNull(tradeDetailInfo, 'Trade detail should be deleted');
    })
  })

  describe('Close settled trade with SOL failed', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = (0.1 * LAMPORTS_PER_SOL);
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    before(async () => {
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount: BigInt(amount),
        connection,
        scriptTimeout: await getBlockTime(connection) + 5,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      correctUserAccount = {
        userAccount: user.publicKey,
        userEphemeralAccount: userEphemeralKey.publicKey,
        userTradeDetail: correctUserTradeDetail,
        refundAccount: refundKey.publicKey,
        pmm: pmm.publicKey,
        signer: mpcKey.publicKey,
        vault: getTradeVaultPda(correctTradeId),
      };
    })

    it('Close settled trade with SOL FAILED when InvalidTradeStatus', async () => {
      // Timeout is 5 seconds,
      await sleep(3000);
      const closeFinishedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: mpcKey.publicKey,
      });
      const closeFinishedTradeTransaction = new Transaction().add(...closeFinishedTradeIns);
      try {
        await sendAndConfirmTransaction(connection, closeFinishedTradeTransaction, [mpcKey], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTradeStatus'));
      }
    })

    it('Close settled trade with SOL FAILED when close time not available', async () => {
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const closeFinishedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: user.publicKey,
      });
      const closeFinishedTradeTransaction = new Transaction().add(...closeFinishedTradeIns);
      try {
        await sendAndConfirmTransaction(connection, closeFinishedTradeTransaction, [user], { commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('CloseNotAvailable'));
      }
    })

  })


  describe('Close settled trade with token success', () => {
    const mint = Keypair.generate();
    const tokenMint = mint.publicKey;
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const tokenUnit = 10 ** 8;
    const amount = (0.1 * tokenUnit);
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    let remainingAccounts: AccountMeta[] = [];
    let vaultPda: PublicKey;
    before(async () => {
      await createMint(connection, deployer, deployer.publicKey, null, 8, mint, { commitment: 'confirmed' });

      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: tokenMint,
        amount: BigInt(0.001 * LAMPORTS_PER_SOL),
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      await airdropTokenToUser(connection, tokenMint, deployer, user.publicKey, 10 * tokenUnit);
      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount: BigInt(amount),
        connection,
        scriptTimeout: await getBlockTime(connection) + 3,
        fromToken,
        toToken,
        toUserAddress: '0x629C473e0E698FD101496E5fbDA4bcB58DA78dC4',
        solver: solverAddress,
        refundPubkey: refundKey.publicKey,
      };
      ({ tradeId: correctTradeId } = await getTradeInput(depositParam));

      vaultPda = getTradeVaultPda(correctTradeId);

      correctTradeIdBytes = bigintToBytes32(BigInt(correctTradeId));
      correctUserTradeDetail = getUserTradeDetailPda(correctTradeId);

      const depositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(depositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      correctUserAccount = {
        userAccount: user.publicKey,
        userEphemeralAccount: userEphemeralKey.publicKey,
        userTradeDetail: correctUserTradeDetail,
        refundAccount: refundKey.publicKey,
        pmm: pmm.publicKey,
        signer: mpcKey.publicKey,
        vault: vaultPda,
      };
      remainingAccounts = [
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: await getAssociatedTokenAddress(tokenMint, vaultPda, true), isSigner: false, isWritable: true },
        { pubkey: await getAssociatedTokenAddress(tokenMint, pmm.publicKey, true), isSigner: false, isWritable: true },
        { pubkey: await getAssociatedTokenAddress(tokenMint, protocolPda, true), isSigner: false, isWritable: true },
      ]

      const createPmmAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, pmm.publicKey);
      const createProtocolAtaIns = await createAssociatedTokenAccountInstructionIfNeeded(connection, deployer.publicKey, tokenMint, protocolPda);
      const createAtaTransaction = new Transaction().add(...createPmmAtaIns, ...createProtocolAtaIns);
      await sendAndConfirmTransaction(connection, createAtaTransaction, [deployer], { commitment: 'confirmed' });
    })

    it('Settlement() success', async () => {
      const beforeVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      const beforePmmBalance = await getTokenBalance(connection, tokenMint, pmm.publicKey);
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .remainingAccounts(remainingAccounts)
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const afterVaultBalance = await getTokenBalance(connection, tokenMint, vaultPda);
      assert.equal(beforeVaultBalance - afterVaultBalance, Number(amount), 'Vault balance should be decreased by the amount of token');
      const afterPmmBalance = await getTokenBalance(connection, tokenMint, pmm.publicKey);
      assert.equal(afterPmmBalance - beforePmmBalance, Number(amount), 'Pmm balance should be increased by the amount deposit');
      const userTradeDetailData = await getTradeDetailData(correctTradeId, connection);
      assert.isObject(userTradeDetailData.status.settled, 'User trade detail should be deleted');
    })

    it('Close settled trade with token failed when wrong vault token account', async () => {
      // await sleep(9000);
      const userAta = await getAssociatedTokenAddress(tokenMint, user.publicKey, true);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      try {
        await program.methods
          .closeFinishedTrade({
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: mpcKey.publicKey,
            userAccount: user.publicKey,
            userTradeDetail: tradeDetailPda,
            vault: vaultPda,
            vaultTokenAccount: userAta,
            userTokenAccount: userAta,
          })
          .signers([mpcKey])
          .rpc({ commitment: 'confirmed' });
          assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTokenAccount'));
      }
    })

    it('Close settled trade with token failed when vault token account is not set', async () => {
      // await sleep(9000);
      const userAta = await getAssociatedTokenAddress(tokenMint, user.publicKey, true);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      try {
        await program.methods
          .closeFinishedTrade({
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: mpcKey.publicKey,
            userAccount: user.publicKey,
            userTradeDetail: tradeDetailPda,
            vault: vaultPda,
            vaultTokenAccount: null,
            userTokenAccount: userAta,
          })
          .signers([mpcKey])
          .rpc({ commitment: 'confirmed' });
          assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTokenAccount'));
      }
    })

    it('Close settled trade with token failed when wrong user token account', async () => {
      // await sleep(9000);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const vaultAta = await getAssociatedTokenAddress(tokenMint, vaultPda, true);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      try {
        await program.methods
          .closeFinishedTrade({
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: mpcKey.publicKey,
            userAccount: user.publicKey,
            userTradeDetail: tradeDetailPda,
            vault: vaultPda,
            vaultTokenAccount: vaultAta,
            userTokenAccount: vaultAta,
          })
          .signers([mpcKey])
          .rpc({ commitment: 'confirmed' });
          assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTokenAccount'));
      }
    })

    it('Close settled trade with token failed when user token account is not set', async () => {
      // await sleep(9000);
      const userAta = await getAssociatedTokenAddress(tokenMint, user.publicKey, true);
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      try {
        await program.methods
          .closeFinishedTrade({
            tradeId: correctTradeIdBytes,
          })
          .accounts({
            signer: mpcKey.publicKey,
            userAccount: user.publicKey,
            userTradeDetail: tradeDetailPda,
            vault: vaultPda,
            vaultTokenAccount: userAta,
            userTokenAccount: null,
          })
          .signers([mpcKey])
          .rpc({ commitment: 'confirmed' });
          assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTokenAccount'));
      }
    })

    it('Close settled trade with token success', async () => {
      await sleep(9000);
      const closeFinishedTradeIns = await createCloseFinishedTradeInstructions({
        tradeId: correctTradeId,
        connection: connection,
        userPubkey: deployer.publicKey,
      });
      const userTradeDetailData = await getTradeDetailData(correctTradeId, connection);
      const beforeUserBalance = await connection.getBalance(userTradeDetailData.userPubkey, 'confirmed');
      const vaultPda = getTradeVaultPda(correctTradeId);
      const tradeDetailPda = getUserTradeDetailPda(correctTradeId);
      const vaultAta = await getAssociatedTokenAddress(tokenMint, vaultPda, true);
      const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const tradeDetailBalance = await connection.getBalance(tradeDetailPda, 'confirmed');
      const vaultAtaBalance = await connection.getBalance(vaultAta, 'confirmed');
      const userAtaTokenBalanceBefore = await getTokenBalance(connection, tokenMint, userTradeDetailData.userPubkey);
      const closeFinishedTradeTransaction = new Transaction().add(...closeFinishedTradeIns);
      await airdropTokenToUser(connection, tokenMint, deployer, vaultPda, 10 * tokenUnit);
      try {
        await sendAndConfirmTransaction(connection, closeFinishedTradeTransaction, [deployer], { commitment: 'confirmed' });
      } catch (error) {
        console.log(error);
        throw error;
      }
      const userAtaTokenBalanceAfter = await getTokenBalance(connection, tokenMint, userTradeDetailData.userPubkey);
      const afterUserBalance = await connection.getBalance(userTradeDetailData.userPubkey, 'confirmed');
      assert.equal(afterUserBalance - beforeUserBalance, vaultBalance + vaultAtaBalance + tradeDetailBalance, 'User balance should be increased by the amount of SOL nonceCheckAccount');
      assert.equal(userAtaTokenBalanceAfter - userAtaTokenBalanceBefore, 10 * tokenUnit, 'User Ata token balance should be increased by the new amount of token');

      const vaultInfo = await connection.getAccountInfo(vaultPda, 'confirmed');
      assert.isNull(vaultInfo, 'Vault should be deleted');
      const tradeDetailInfo = await connection.getAccountInfo(tradeDetailPda, 'confirmed');
      assert.isNull(tradeDetailInfo, 'Trade detail should be deleted');
      const vaultAtaInfo = await connection.getAccountInfo(vaultAta, 'confirmed');
      assert.isNull(vaultAtaInfo, 'Vault Ata should be deleted');
    })
  })
});

