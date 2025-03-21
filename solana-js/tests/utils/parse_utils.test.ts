import { getSolanaUserEphemeralKeys, tradeIdBytesToString } from '../../utils/parse_utils';
import { Keypair } from '@solana/web3.js';
import { expect } from 'chai';

describe('getSolanaUserEphemeralKeys', () => {
  it('should generate correct keypair from valid signature with 0x prefix', () => {
    const testSignature = '0x' + 'a'.repeat(64);
    const result = getSolanaUserEphemeralKeys(testSignature);
    
    expect(result).instanceOf(Keypair);
  });
}); 

describe('tradeIdBytesToString', () => {
  it('should convert tradeId to string', () => {
    const tradeId = [237,208,37,231,196,217,80,196,13,252,165,39,120,84,69,105,76,65,28,197,84,68,141,152,146,127,66,241,194,163,94,121];
    const result = tradeIdBytesToString(tradeId);
    expect(result).to.equal('0xedd025e7c4d950c40dfca527785445694c411cc554448d98927f42f1c2a35e79');
  });
}); 