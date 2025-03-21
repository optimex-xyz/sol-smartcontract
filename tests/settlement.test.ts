import * as anchor from '@coral-xyz/anchor';
import { OptimexSolSmartcontract } from '../target/types/optimex_sol_smartcontract';
import {
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import dotenv from 'dotenv';
import { expect, assert } from 'chai';
import { airdropTokenToUser, createAccount, createTokenPair, getBlockTime, getTokenBalance, sleep } from './utils';
import { keccak256, toUtf8Bytes } from 'ethers';
import { solverAddress } from './example-data';
import {
  createMint,
  getAssociatedTokenAddress,
  setTransferFeeInstructionData,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { bigintToBytes32, DepositInstructionParam, getProtocolPda, getUserTradeDetailPda } from '../solana-js/dist';
import { delay } from '../scripts/utils/helper';
import { createDepositAndVaultAtaIfNeededAndNonceAccountInstructions, createDepositAndVaultAtaIfNeededInstructions } from '../solana-js/instructions/deposit';
import { createAssociatedTokenAccountInstructionIfNeeded } from '../solana-js/instructions/helpers';
import { createInitializeProgramInstructions } from '../solana-js/instructions/intialize';
import { createAddOperatorInstruction } from '../solana-js/instructions/manage_operator';
import { createAddOrUpdateWhitelistInstruction } from '../solana-js/instructions/manage_config';
import { createSetTotalFeeInstructions } from '../solana-js/instructions/set_total_fee';
import { WSOL_MINT } from '../solana-js/constants';
import { getNonceCheckPda, getTradeVaultPda } from '../solana-js/pda/get_pda_address';
import { getTradeDetailData } from '../solana-js/pda/get_pda_data';
import { getTradeInput } from '../solana-js/utils/param_utils';
dotenv.config();

type TradeDetail = anchor.IdlTypes<OptimexSolSmartcontract>['tradeDetail'];

describe('Settlement() functional testing', () => {
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
  let fakeVaultPda: PublicKey;

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
  })

  describe('Settlement() with SOL success', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = 0.1 * LAMPORTS_PER_SOL;
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    before(async () => {
      const addWhitelistIns = await createAddOrUpdateWhitelistInstruction({
        operator: operator.publicKey,
        token: WSOL_MINT,
        amount: 0.001 * LAMPORTS_PER_SOL,
        connection: connection,
      });
      const addWhitelistTransaction = new Transaction().add(...addWhitelistIns);
      await sendAndConfirmTransaction(connection, addWhitelistTransaction, [operator], { commitment: 'confirmed' });

      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
        connection,
        scriptTimeout: await getBlockTime(connection) + 15,
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
      fakeVaultPda = vaultPda;
      const beforeVaultBalance = await connection.getBalance(vaultPda, 'confirmed');
      const userTradeDetailBalance = await connection.getBalance(correctUserTradeDetail, 'confirmed');
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

    it('Settlement() failed when trade already settled', async () => {
      const newDepositParam = {
        ...depositParam,
        sessionId: BigInt(keccak256(toUtf8Bytes(crypto.randomUUID()))),
      };

      // console.log(correctUserAccount);
      const nonceLamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
      const withdrawNonceIns = await SystemProgram.nonceWithdraw({
        noncePubkey: depositParam.userEphemeralPubkey,
        authorizedPubkey: mpcKey.publicKey,
        toPubkey: user.publicKey,
        lamports: nonceLamports,
      })
      const nonceWithdrawTransaction = new Transaction().add(withdrawNonceIns);
      await sendAndConfirmTransaction(connection, nonceWithdrawTransaction, [mpcKey], { commitment: 'confirmed' });
      // Need to wait 10 second until nonce is closed, because nonce is required to be finalized to be processed
      await sleep(10000);
      const depositIns = await createDepositAndVaultAtaIfNeededInstructions(newDepositParam);
      const transaction = new Transaction().add(...depositIns);
      try {
        await sendAndConfirmTransaction(connection, transaction, [user, userEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        throw error;
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        assert.isTrue(error.toString().includes('InvalidTradeStatus'));
      }
    })
  })

  describe('Settlement() with SOL failed', () => {
    const [fromToken, toToken] = createTokenPair();
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const amount = 0.1 * LAMPORTS_PER_SOL;
    let correctTradeId: string;
    let correctTradeIdBytes: number[];
    let correctUserTradeDetail: PublicKey;
    let depositParam: DepositInstructionParam;
    let correctUserAccount = {};
    before(async () => {
      depositParam = {
        sessionId,
        userPubkey: user.publicKey,
        mpcPubkey: mpcKey.publicKey,
        userEphemeralPubkey: userEphemeralKey.publicKey,
        amount,
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

    it('Settlement() failed when mismatch user_account', async () => {
      let newUserAccount = {
        ...correctUserAccount,
        userAccount: Keypair.generate().publicKey,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidUserAccount');
      }
    })

    it('Settlement() failed when mismatch refund_account', async () => {
      let newUserAccount = {
        ...correctUserAccount,
        refundAccount: Keypair.generate().publicKey,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidRefundPubkey');
      }
    })

    it('Settlement() failed when mismatch ephemeral_account', async () => {
      const newEphemeralKey = Keypair.generate();
      const newDepositParam: DepositInstructionParam = {
        ...depositParam,
        sessionId: BigInt(keccak256(toUtf8Bytes(crypto.randomUUID()))),
        userEphemeralPubkey: newEphemeralKey.publicKey,
      }
      let newUserAccount = {
        ...correctUserAccount,
        userEphemeralAccount: newEphemeralKey.publicKey,
      }

      const newDepositIns = await createDepositAndVaultAtaIfNeededAndNonceAccountInstructions(newDepositParam);
      const newDepositTransaction = new Transaction().add(...newDepositIns);
      try {
        await sendAndConfirmTransaction(connection, newDepositTransaction, [user, newEphemeralKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([newEphemeralKey, mpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('Unauthorized');
      }
    })

    it('Settlement() failed when mismatch signer', async () => {
      const newMpcKey = Keypair.generate();
      let newUserAccount = {
        ...correctUserAccount,
        signer: newMpcKey.publicKey,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([userEphemeralKey, newMpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('Unauthorized');
      }
    })

    it('Settlement() failed when mismatch protocol', async () => {
      const newProtocolPda = Keypair.generate();
      let newUserAccount = {
        ...correctUserAccount,
        protocol: newProtocolPda.publicKey,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.errorLogs.some(log => log.includes('ConstraintSeeds') && log.includes('protocol'))).to.be.true;
      }
    })

    it('Settlement() failed when mismatch vault', async () => {
      await delay(5000);
      let newUserAccount = {
        ...correctUserAccount,
        vault: fakeVaultPda,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...newUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc();
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.errorLogs.some(log => log.includes('ConstraintSeeds') && log.includes('vault'))).to.be.true;
      }
    })

    it('Settlement() failed when timeout', async () => {
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        })
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('TimeOut');
      }
    })
  })

  describe('Settlement() with token success success', () => {
    const mint = Keypair.generate();
    const tokenMint = mint.publicKey;
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const tokenUnit = 10 ** 8;
    const amount = 0.1 * tokenUnit;
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
        amount: 0.001 * LAMPORTS_PER_SOL,
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
        amount,
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
  })

  describe('Settlement() with token failed', () => {
    const mint = Keypair.generate();
    const tokenMint = mint.publicKey;
    const [fromToken, toToken] = createTokenPair(tokenMint.toBase58());
    const userEphemeralKey = Keypair.generate();
    const refundKey = Keypair.generate();
    const sessionId = BigInt(keccak256(toUtf8Bytes(crypto.randomUUID())));
    const tokenUnit = 10 ** 8;
    const amount = 0.1 * tokenUnit;
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
        amount: 0.001 * LAMPORTS_PER_SOL,
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
        amount,
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
      const { tradeId } = await getTradeInput(depositParam);
      vaultPda = getTradeVaultPda(tradeId);
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

      const setProtocolFeeIns = await createSetTotalFeeInstructions({
        tradeId: correctTradeId,
        amount: (0.001 * LAMPORTS_PER_SOL),
        mpcPubkey: mpcKey.publicKey,
        connection: connection,
      });
      const setProtocolFeeTransaction = new Transaction().add(...setProtocolFeeIns);
      try {
        await sendAndConfirmTransaction(connection, setProtocolFeeTransaction, [mpcKey], { commitment: 'confirmed' });
      } catch (error) {
        console.error(error);
        throw error;
      }
    })

    it('Settlement() failed when mismatch mint account', async () => {
      const newRemainingAccounts = remainingAccounts.slice(0);
      newRemainingAccounts[1] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: false,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        }).remainingAccounts(newRemainingAccounts)
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidMint');
      }
    })

    it('Settlement() failed when mismatch vault token account', async () => {
      const newRemainingAccounts = remainingAccounts.slice(0);
      newRemainingAccounts[2] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        }).remainingAccounts(newRemainingAccounts)
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidSourceAta');
      }
    })

    it('Settlement() failed when mismatch pmm token account', async () => {
      const newRemainingAccounts = remainingAccounts.slice(0);
      newRemainingAccounts[3] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        }).remainingAccounts(newRemainingAccounts)
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
        assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidDestinationAta');
      }
    })

    it('Settlement() failed when mismatch protocol token account', async () => {
      const newRemainingAccounts = remainingAccounts.slice(0);
      newRemainingAccounts[4] = {
        pubkey: Keypair.generate().publicKey,
        isSigner: false,
        isWritable: true,
      }
      try {
        await program.methods.settlement({
          tradeId: correctTradeIdBytes,
        }).accounts({
          ...correctUserAccount,
        }).remainingAccounts(newRemainingAccounts)
          .signers([userEphemeralKey, mpcKey])
          .rpc({ commitment: 'confirmed' });
          assert.fail('Should not reach here');
      } catch (error) {
        expect(error.toString()).to.include('InvalidDestinationAta');
      }
    })

    it('Settlement() failed when timeout', async () => {
      await delay(5000);
      const userTradeDetail = (correctUserAccount as any).userTradeDetail;
      const tradeDetailInfo = await program.account.tradeDetail.fetch(userTradeDetail);
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
        expect(error.toString()).to.include('TimeOut');
      }
    })
  })
});