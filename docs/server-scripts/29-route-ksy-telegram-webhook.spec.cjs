const {test}=require('node:test');
const assert=require('node:assert/strict');
const {run}=require('./29-route-ksy-telegram-webhook.cjs');
test('real Node22 HTTPS target lookup reaches fixed IPv4 socket',async()=>{
  const net=require('node:net');
  const {probeTarget,request}=require('./29-route-ksy-telegram-webhook.cjs');
  let connections=0;
  const server=net.createServer(socket=>{connections++;socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=server.address().port;
    await assert.rejects(probeTarget('127.0.0.1',{url:'https://ksy-deals.fedrbodr.com/telegram/webhook',secret:'fixture'},(options,body)=>request({...options,port},body)));
    assert.equal(connections,1,'TLS failure must occur after connecting, not in DNS address handling');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('target preflight verifies TLS hostname and both webhook authentication outcomes',async()=>{
  const {probeTarget}=require('./29-route-ksy-telegram-webhook.cjs');
  const calls=[];
  const send=async(options,body)=>{calls.push({options,body});return {status:options.method==='GET'?200:options.headers['x-telegram-bot-api-secret-token']==='fixture_secret'?204:403};};
  await probeTarget('185.158.249.84',{url:'https://ksy-deals.fedrbodr.com/telegram/order-webhook',secret:'fixture_secret'},send);
  assert.equal(calls.length,3);
  for(const c of calls){assert.equal(c.options.servername,'ksy-deals.fedrbodr.com');assert.equal(c.options.rejectUnauthorized,undefined);}
  assert.equal(calls[2].body,'{}');
});
test('stdin CLI executes and rejects invalid bot without API traffic',()=>{
  const {spawnSync}=require('node:child_process');
  const {readFileSync}=require('node:fs');
  const source=readFileSync(__dirname+'/29-route-ksy-telegram-webhook.cjs','utf8');
  const result=spawnSync(process.execPath,['-','status','other'],{input:source,encoding:'utf8',env:{}});
  assert.equal(result.status,1);
  assert.match(result.stderr,/BOT_INVALID/);
});
const URL='https://ksy-deals.fedrbodr.com/telegram/order-webhook';
const env={ORDER_BOT_TOKEN:'123456:fixture_token',ORDER_BOT_WEBHOOK_SECRET:'fixture_secret',ORDER_BOT_WEBHOOK_URL:URL};
function fixture(overrides={}) {
  let current={url:URL,ip_address:'201.51.7.50',pending_update_count:15,has_custom_certificate:false,max_connections:40,allowed_updates:['message','callback_query']};
  const calls=[],logs=[];
  const api=async(method,body)=>{calls.push({method,body});if(method==='setWebhook'){current={...current,ip_address:body.ip_address};return true;} return {...current};};
  return {action:'relay',bot:'order',env,api,probe:async()=>{},log:(x)=>logs.push(x),calls,logs,...overrides};
}
test('preserves URL, secret, update filter, connections and pending queue',async()=>{
  const f=fixture(); await run(f);
  assert.deepEqual(f.calls.find(x=>x.method==='setWebhook').body,{url:URL,ip_address:'185.158.249.84',secret_token:'fixture_secret',drop_pending_updates:false,max_connections:40,allowed_updates:['message','callback_query']});
  assert.equal(f.logs.at(-1).pendingUpdateCount,15);assert.equal(f.logs.at(-1).ipAddress,'185.158.249.84');
  assert.ok(!JSON.stringify(f.logs).includes('fixture'));
});
test('status never probes or mutates',async()=>{const f=fixture({action:'status',probe:()=>{throw Error('unexpected');}});await run(f);assert.deepEqual(f.calls.map(x=>x.method),['getWebhookInfo']);});
test('failed TLS preflight prevents mutation',async()=>{const f=fixture({probe:async()=>{throw Error('TLS');}});await assert.rejects(run(f));assert.ok(!f.calls.some(x=>x.method==='setWebhook'));});
test('unexpected URL refuses mutation',async()=>{const f=fixture({api:async()=>({url:'https://other.invalid',ip_address:'201.51.7.50'})});await assert.rejects(run(f),/REGISTRATION_UNEXPECTED/);});
test('ambiguous set response is not retried',async()=>{let sets=0;const f=fixture();const old=f.api;f.api=async(m,b)=>{if(m==='setWebhook'){sets++;throw Error('raw secret');}return old(m,b);};await assert.rejects(run(f),/MUTATION_UNCONFIRMED/);assert.equal(sets,1);});
test('wrong postcondition does not claim success',async()=>{const f=fixture();const old=f.api;f.api=async(m,b)=>m==='setWebhook'?true:old(m,b);await assert.rejects(run(f),/POSTCONDITION_FAILED/);});
test('already routed is checked without resetting webhook',async()=>{const f=fixture();const old=f.api;f.api=async(m,b)=>({...await old(m,b),ip_address:'185.158.249.84'});await run(f);assert.equal(f.calls.length,1);});
test('rollback targets original IP, keeps queue',async()=>{const f=fixture({action:'direct'});const old=f.api;let n=0;f.api=async(m,b)=>{const r=await old(m,b);return m==='getWebhookInfo'&&n++===0?{...r,ip_address:'185.158.249.84'}:r;};await run(f);assert.equal(f.calls.find(x=>x.method==='setWebhook').body.drop_pending_updates,false);assert.equal(f.logs.at(-1).ipAddress,'201.51.7.50');});
test('invalid bot/action and missing secret never call API',async()=>{for(const change of [{bot:'other'},{action:'delete'},{env:{...env,ORDER_BOT_WEBHOOK_SECRET:''}}]){const f=fixture(change);await assert.rejects(run(f));assert.equal(f.calls.length,0);}});
test('catalogue uses only its configured credentials and URL',async()=>{const f=fixture({bot:'catalogue',env:{TELEGRAM_BOT_TOKEN:'123456:catalogue',TELEGRAM_WEBHOOK_SECRET:'catalogue_secret',TELEGRAM_WEBHOOK_URL:'https://ksy-deals.fedrbodr.com/telegram/webhook'}});const old=f.api;f.api=async(m,b)=>{const r=await old(m,b);return typeof r==='object'?{...r,url:f.env.TELEGRAM_WEBHOOK_URL}:r;};await run(f);assert.equal(f.calls.find(x=>x.method==='setWebhook').body.secret_token,'catalogue_secret');});
