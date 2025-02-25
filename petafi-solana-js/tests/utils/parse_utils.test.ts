import { getSolanaUserEphemeralKeys } from '../../utils/parse_utils';
import { Keypair } from '@solana/web3.js';
import { expect } from 'chai';

describe('getSolanaUserEphemeralKeys', () => {
  it('should generate correct keypair from valid signature with 0x prefix', () => {
    const testSignature = '0x' + 'a'.repeat(64);
    const result = getSolanaUserEphemeralKeys(testSignature);
    
    expect(result).instanceOf(Keypair);
  });
}); 