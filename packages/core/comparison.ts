import { DomainError } from '../contracts/index.js';
export type Money={currency:string;minorUnits:number};
export type ComparableOffer={asin:string;sellerId?:string;condition:string;purchaseMode:string;price:Money;shipping?:Money;tax?:Money;quantity:number;unitsPerItem?:number;unit?:string};
export function compareOffers(offers:ComparableOffer[]) {
  if(!offers.length||offers.length>20)throw new DomainError('INVALID_COMPARISON','Choose one to twenty offers',400);
  return offers.map(o=>{
    const values=[o.price,o.shipping,o.tax].filter((v):v is Money=>Boolean(v));
    if(values.some(v=>!Number.isSafeInteger(v.minorUnits)||v.minorUnits<0||v.currency!==o.price.currency)||!Number.isInteger(o.quantity)||o.quantity<1)throw new DomainError('INVALID_MONEY','Comparable prices need nonnegative minor units, one currency and a positive quantity',400);
    if(o.unitsPerItem!==undefined&&(!Number.isFinite(o.unitsPerItem)||o.unitsPerItem<=0))throw new DomainError('INVALID_UNITS','Explicit positive unit quantity is required',400);
    const itemTotal=o.price.minorUnits*o.quantity;
    return {...o,itemTotal:{currency:o.price.currency,minorUnits:itemTotal},deliveredTotal:o.shipping&&o.tax?{currency:o.price.currency,minorUnits:itemTotal+o.shipping.minorUnits+o.tax.minorUnits}:null,missing:['shipping','tax'].filter(k=>o[k as 'shipping'|'tax']===undefined),unitPrice:o.unitsPerItem&&o.unit?{currency:o.price.currency,minorUnits:o.price.minorUnits/o.unitsPerItem,unit:o.unit}:null};
  });
}
