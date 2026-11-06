'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {checkin,requestClient,proof,STATUS,CLAIM}=require('./checkin.cjs');
const status=(checked=false,active=true)=>({code:0,data:{active,today_checked_in:checked,today_credit:100,season:10}});
function sequence(values){const routes=[];return {routes,post:async p=>{routes.push(p);assert.ok(values.length,'unexpected request');return values.shift();}};}
test('confirmed claim performs status/claim/status',async()=>{const s=sequence([status(),{code:0},status(true)]);assert.equal((await checkin(s.post)).status,'claimed');assert.deepEqual(s.routes,[STATUS,CLAIM,STATUS]);});
test('already claimed never invokes claim',async()=>{const s=sequence([status(true)]);assert.equal((await checkin(s.post)).status,'already_claimed');assert.deepEqual(s.routes,[STATUS]);});
test('inactive activity never invokes claim',async()=>{const s=sequence([status(false,false)]);assert.equal((await checkin(s.post)).status,'event_inactive');assert.deepEqual(s.routes,[STATUS]);});
test('status mode is read only',async()=>{const s=sequence([status()]);assert.equal((await checkin(s.post,true)).status,'available');assert.deepEqual(s.routes,[STATUS]);});
test('failed claim cannot be reported as success',async()=>{const s=sequence([status(),{code:1003},status()]);await assert.rejects(checkin(s.post),/CLAIM_NOT_CONFIRMED_1003/);});
test('concurrent claim verifies state instead of relying on error text',async()=>{const s=sequence([status(),{code:10001},status(true)]);assert.equal((await checkin(s.post)).status,'already_claimed');});
test('malformed or rejected status stops before write',async()=>{for(const v of [{code:0,data:{}},{code:401},{}]){const s=sequence([v]);await assert.rejects(checkin(s.post),/STATUS_REJECTED/);assert.deepEqual(s.routes,[STATUS]);}});
test('authenticated socket roundtrip and HTTP400 business response',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wb-test-'));const endpoint=path.join(dir,'s.sock'),ticket=crypto.randomBytes(32).toString('hex');
 const sockets=new Set();const server=net.createServer(sock=>{sockets.add(sock);sock.on('close',()=>sockets.delete(sock));let buf='',nonce; sock.on('data',b=>{buf+=b;for(let i;(i=buf.indexOf('\n'))>=0;){const f=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);const send=x=>sock.write(JSON.stringify(x)+'\n');if(f.type==='session_hello'){nonce=f.client_nonce;send({type:'session_challenge',server_nonce:'testnonce',server_proof:proof(ticket,'server',endpoint,nonce,'testnonce')});}else if(f.type==='session_prove'){assert.equal(f.client_proof,proof(ticket,'client',endpoint,nonce,'testnonce'));send({type:'session_hello_ack'});}else if(f.method==='broker/GetPipe')send({id:f.id,result:{channel:'c:wb.request',methods:['http.fetch']}});else{assert.equal(f.params.path,CLAIM);send({id:f.id,result:{status:400,body_b64:Buffer.from(JSON.stringify({code:10001,msg:'already'})).toString('base64')}});}}});});
 await new Promise(r=>server.listen(endpoint,r));let c;
 try{c=await requestClient({endpoint,ticket});assert.equal((await c.post(CLAIM)).code,10001);await assert.rejects(c.post('/unrelated'),/ROUTE_NOT_ALLOWED/);}finally{c?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
