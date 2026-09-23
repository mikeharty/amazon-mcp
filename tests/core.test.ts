import {describe,it,expect} from 'vitest';
import {compareOffers} from '../packages/core/comparison.js';
import {canonical,digest,Vault} from '../packages/store/crypto.js';
import {randomBytes} from 'node:crypto';
describe('money and confidentiality',()=>{
 it('keeps missing shipping/tax unknown and never treats them as zero',()=>{const [v]=compareOffers([{asin:'B000000001',condition:'new',purchaseMode:'one-time',price:{currency:'USD',minorUnits:199},quantity:2,unitsPerItem:4,unit:'oz'}]);expect(v!.deliveredTotal).toBeNull();expect(v!.missing).toEqual(['shipping','tax']);expect(v!.unitPrice?.minorUnits).toBe(49.75);});
 it('rejects mixed currency arithmetic',()=>{expect(()=>compareOffers([{asin:'B000000001',condition:'new',purchaseMode:'one-time',price:{currency:'USD',minorUnits:100},shipping:{currency:'EUR',minorUnits:1},quantity:1}])).toThrow('one currency');});
 it('uses stable nested intent fingerprints',()=>{expect(digest({b:{z:1,a:2},a:3})).toBe(digest({a:3,b:{a:2,z:1}}));expect(canonical([2,1])).not.toBe(canonical([1,2]));});
 it('encrypts per owner with randomized authenticated ciphertext',()=>{const v=new Vault(randomBytes(32).toString('base64'));const a=v.seal({total:42},'owner');const b=v.seal({total:42},'owner');expect(a).not.toBe(b);expect(v.open(a,'owner')).toEqual({total:42});expect(()=>v.open(a,'other')).toThrow();});
});
