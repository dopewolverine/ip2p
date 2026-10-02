#!/usr/bin/env node
// Offline-only recovery. No network request, server secret or platform login.
const fs = require('fs');
const path = require('path');
const base = path.resolve(__dirname, '..');
require(base + '/backend/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module: 'node16', moduleResolution: 'node16',target:'es2020',esModuleInterop:true}});
const bitcoin = require(base + '/backend/node_modules/bitcoinjs-lib');
const ecc = require(base + '/backend/node_modules/@bitcoinerlab/secp256k1');
bitcoin.initEccLib(ecc);

async function main() {
 const [command, bundleFile, ...args] = process.argv.slice(2);
 if (!['build','inspect','sign','combine'].includes(command) || !bundleFile) throw new Error('Usage: recover-escrow.cjs build BUNDLE UTXOS release|refund RATE OUT | inspect BUNDLE PSBT release|refund | sign BUNDLE PSBT release|refund OUT | combine BUNDLE PSBT1 PSBT2 release|refund OUT');
 const b = JSON.parse(fs.readFileSync(bundleFile,'utf8'));
 if (b.format !== 'ip2p-escrow-recovery-v1' || !['bitcoin','litecoin'].includes(b.chain) || !['testnet','mainnet'].includes(b.network)) throw new Error('Invalid recovery bundle');
 if (!b.platform_xpub || !b.fee_address) throw new Error('Bundle lacks pinned platform public data');
 process.env.IP2P_NETWORK = process.env.NEXT_PUBLIC_IP2P_NETWORK = b.network;
 const suffix = b.chain === 'bitcoin' ? 'BTC' : 'LTC';
 process.env['NEXT_PUBLIC_PLATFORM_XPUB_'+suffix] = b.platform_xpub;
 process.env['NEXT_PUBLIC_PLATFORM_FEE_ADDRESS_'+suffix] = b.fee_address;
 const V = require(base + '/frontend/src/lib/escrow/verify.ts');
 const {buildProposalPsbt} = require(base + '/backend/src/escrow/releaseTx.ts');
 const {networkFor} = require(base + '/backend/src/chain/networks.ts');
 const network = networkFor(b.chain);
 const idx = Number(b.contract_index);
 if (!Number.isSafeInteger(idx) || idx < 0 || idx >= 0x80000000) throw new Error('Invalid derivation index');
 const mineFor = party => ({publicKeyHex:b.keys[party],payoutAddress:b.keys[party+'_payout']});
 const setup = (party,mine) => ({chain:b.chain,contractIndex:idx,myParty:party,mine,keys:b.keys,escrowAddress:b.escrow_address,witnessScriptHex:b.witness_script});
 const contract = {state:b.state,crypto_side:b.crypto_side,amount:b.amount,fee_amount:b.fee_amount,network_reserve:b.network_reserve};
 const check = (psbt,purpose,party='vendor',mine=mineFor(party)) => {
   if (!['release','refund'].includes(purpose)) throw new Error('Invalid purpose');
   return V.verifyProposal({...setup(party,mine),purpose,psbtBase64:psbt,contract});
 };
 const read = f=>fs.readFileSync(f,'utf8').trim();
 const save = (f,s)=>fs.writeFileSync(f,s+'\n',{mode:0o600,flag:'wx'});
 const summary = (psbt,purpose) => {
   const checked=check(psbt,purpose);
   console.log(JSON.stringify({chain:b.chain,network:b.network,purpose,outputs:checked.outputs,networkFee:checked.networkFee},(_,v)=>typeof v==='bigint'?String(v):v,2));
 };
 if(command==='build'){
   const [utxoFile,purpose,rateText,out]=args;
   if(!out)throw new Error('Missing arguments');
   const rate=BigInt(rateText);if(rate<=0n||rate>1000n)throw new Error('Invalid fee rate');
   V.verifyEscrowSetup(setup('vendor',mineFor('vendor')));
   const funder=b.crypto_side,buyer=funder==='vendor'?'customer':'vendor';
   const utxos=JSON.parse(read(utxoFile)).map(u=>({...u,value:BigInt(u.value)}));
   const fee=purpose==='release'||b.state==='disputed'?BigInt(b.fee_amount):0n;
   const result=buildProposalPsbt({chain:b.chain,purpose,witnessScriptHex:b.witness_script,utxos,amount:BigInt(b.amount),feeAmount:fee,buyerAddress:b.keys[buyer+'_payout'],funderAddress:b.keys[funder+'_payout'],feeAddress:b.fee_address,feeRate:rate});
   summary(result.psbtBase64,purpose);save(out,result.psbtBase64);
 } else if(command==='inspect'){
   summary(read(args[0]),args[1]);
 } else if(command==='sign'){
   const [file,purpose,out]=args;const psbt=read(file);summary(psbt,purpose);
   if(!process.stdin.isTTY)throw new Error('Enter the recovery phrase in an interactive terminal; never pass it as an argument.');
   const {Writable}=require('stream'),readline=require('readline');
   let muted=false;const output=new Writable({write(chunk,enc,next){if(!muted)process.stdout.write(chunk);next();}});
   const rl=readline.createInterface({input:process.stdin,output,terminal:true});
   const phrase=await new Promise(resolve=>{rl.question('Recovery phrase (hidden): ',resolve);muted=true;});
   rl.close();process.stdout.write('\n');
   const mine=V.deriveTradeKeys(String(phrase),b.chain,idx);
   const party=['vendor','customer'].find(p=>b.keys[p]===mine.publicKeyHex);
   if(!party)throw new Error('This phrase does not control either participant key');
   check(psbt,purpose,party,mine);
   save(out,V.signProposal(psbt,b.chain,mine));
   mine.privateKey.fill(0);
 } else {
   const [a,c,purpose,out]=args;const left=read(a),right=read(c);check(left,purpose);check(right,purpose);
   const tx=bitcoin.Psbt.fromBase64(left,{network});tx.combine(bitcoin.Psbt.fromBase64(right,{network}));
   if(!tx.validateSignaturesOfAllInputs((pub,hash,sig)=>ecc.verify(hash,pub,sig)))throw new Error('Invalid signature');
   tx.finalizeAllInputs();const raw=tx.extractTransaction();save(out,raw.toHex());
   console.log('Transaction ID:',raw.getId());console.log('Signed transaction saved. Verify it independently before broadcasting.');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
