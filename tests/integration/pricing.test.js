const assert = require('node:assert/strict');
const root = require('path').resolve(__dirname, '../..');
const pricing = require(root+'/backend/dist/src/marketplace/pricing');
const originalFetch = global.fetch;
let calls=0;
global.fetch = async url => {
 calls++;
 if(String(url).includes('coingecko')) return {ok:true,json:async()=>({bitcoin:{usd:60000}})};
 if(String(url).includes('frankfurter')) return {ok:true,json:async()=>({base:'USD',date:new Date().toISOString().slice(0,10),rates:{EUR:0.9,INR:83}})};
 throw new Error('unexpected provider');
};
(async()=>{
 const offer={price_type:'margin',price:null,margin_percent:'2',asset_symbol:'BTC',currency_code:'EUR'};
 assert.equal(await pricing.resolveOfferPrice(offer),55080);
 assert.equal(await pricing.resolveOfferPrice({...offer,currency_code:'INR'}),5079600);
 assert.equal(await pricing.resolveOfferPrice({...offer,currency_code:'ZZZ'}),null);
 assert.equal(await pricing.resolveOfferPrice({...offer,price_type:'fixed',price:'100'}),100);
 assert.equal(await pricing.resolveOfferPrice({...offer,price_type:'fixed',price:'-1'}),null);
 assert.equal(await pricing.resolveOfferPrice({...offer,margin_percent:'NaN'}),null);
 assert.equal(calls,2);
 delete require.cache[require.resolve(root+'/backend/dist/src/lib/fiatRates')];
 global.fetch=async()=>({ok:true,json:async()=>({base:'USD',date:'2000-01-01',rates:{EUR:0.9}})});
 assert.equal(await require(root+'/backend/dist/src/lib/fiatRates').getUsdRates(),null);
 console.log('8 pricing checks passed: FX, margin, fixed price, invalid values, caching and stale rates');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{global.fetch=originalFetch});
