#!/usr/bin/env node
'use strict';
// Run: docker exec -i ksy-deals-server-1 node - status|relay|direct order|catalogue < this-file
const https=require('node:https');
const ORIGIN='201.51.7.50', RELAY='185.158.249.84', HOST='ksy-deals.fedrbodr.com';
const fail=(code)=>{throw new Error(code);};
function configuration(bot,env) {
  if(!['order','catalogue'].includes(bot)) fail('BOT_INVALID');
  const prefix=bot==='order'?'ORDER_BOT':'TELEGRAM';
  const token=env[prefix+(bot==='order'?'_TOKEN':'_BOT_TOKEN')];
  const secret=env[prefix+'_WEBHOOK_SECRET'];
  const url='https://'+HOST+(bot==='order'?'/telegram/order-webhook':'/telegram/webhook');
  if(!token||!/^\d+:[A-Za-z0-9_-]+$/.test(token)||!secret||!/^[A-Za-z0-9_-]{1,256}$/.test(secret)||env[prefix+'_WEBHOOK_URL']!==url) fail('CONFIG_INVALID');
  return {token,secret,url};
}
function request(options,body) {
  return new Promise((resolve,reject)=>{
    const req=https.request({...options,agent:false},res=>{
      let data='';
      res.on('data',chunk=>{data+=chunk;if(data.length>65536)req.destroy(new Error('RESPONSE_TOO_LARGE'));});
      res.on('error',()=>reject(new Error('REQUEST_FAILED')));
      res.on('end',()=>resolve({status:res.statusCode,body:data}));
    });
    const timer=setTimeout(()=>req.destroy(new Error('REQUEST_TIMEOUT')),10000);
    req.on('close',()=>clearTimeout(timer));
    req.on('error',()=>reject(new Error('REQUEST_FAILED')));
    req.end(body);
  });
}
async function apiRequest(token,method,body={}) {
  const data=JSON.stringify(body);
  const result=await request({hostname:'api.telegram.org',family:6,path:'/bot'+token+'/'+method,method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},data);
  let json;try{json=JSON.parse(result.body);}catch{fail('API_RESPONSE_INVALID');}
  if(result.status!==200||json.ok!==true)fail('API_REQUEST_FAILED');
  return json.result;
}
async function probeTarget(ip,cfg,send=request) {
  const connection={hostname:HOST,servername:HOST,family:4,lookup:(_host,_opts,cb)=>cb(null,ip,4)};
  const result=await send({...connection,path:'/health/ready',method:'GET'});
  if(result.status!==200)fail('TARGET_NOT_READY');
  for(const [secret,expected] of [['ksy-invalid-preflight',403],[cfg.secret,204]]){
    const response=await send({...connection,path:new URL(cfg.url).pathname,method:'POST',headers:{'content-type':'application/json','content-length':2,'x-telegram-bot-api-secret-token':secret}},'{}');
    if(response.status!==expected)fail('TARGET_AUTH_FAILED');
  }
}
function safeSnapshot(bot,info,stage) {
  return {bot,stage,ipAddress:info.ip_address??null,pendingUpdateCount:info.pending_update_count??null,lastErrorAt:info.last_error_date??null,checkedAt:new Date().toISOString()};
}
async function run({action,bot,env=process.env,api,probe=probeTarget,log=console.log}) {
  if(!['status','relay','direct'].includes(action))fail('ACTION_INVALID');
  const cfg=configuration(bot,env);
  api??=(method,body)=>apiRequest(cfg.token,method,body);
  const before=await api('getWebhookInfo');
  log(safeSnapshot(bot,before,'before'));
  if(action==='status')return;
  if(before.url!==cfg.url||![ORIGIN,RELAY].includes(before.ip_address)||before.has_custom_certificate!==false||
     !Number.isInteger(before.max_connections)||before.max_connections<1||before.max_connections>100||
     (before.allowed_updates!==undefined&&(!Array.isArray(before.allowed_updates)||!before.allowed_updates.every(x=>typeof x==='string'))))fail('REGISTRATION_UNEXPECTED');
  const target=action==='relay'?RELAY:ORIGIN;
  await probe(target,cfg);
  if(before.ip_address===target){log(safeSnapshot(bot,before,'already_configured'));return;}
  const body={url:cfg.url,ip_address:target,secret_token:cfg.secret,drop_pending_updates:false,max_connections:before.max_connections,
    ...(before.allowed_updates===undefined?{}:{allowed_updates:before.allowed_updates})};
  try{if(await api('setWebhook',body)!==true)fail('SET_FAILED');}catch{fail('MUTATION_UNCONFIRMED_RUN_STATUS');}
  let after;try{after=await api('getWebhookInfo');}catch{fail('MUTATION_UNCONFIRMED_RUN_STATUS');}
  if(after.url!==cfg.url||after.ip_address!==target||after.max_connections!==before.max_connections||
     JSON.stringify(after.allowed_updates)!==JSON.stringify(before.allowed_updates))fail('POSTCONDITION_FAILED_RUN_STATUS');
  log(safeSnapshot(bot,after,'verified'));
}
module.exports={run,request,configuration,probeTarget};
if(require.main===module||process.argv[1]==='-')run({action:process.argv[2],bot:process.argv[3],log:x=>console.log(JSON.stringify(x))}).catch(e=>{
  const allowed=/^(BOT_INVALID|ACTION_INVALID|CONFIG_INVALID|REGISTRATION_UNEXPECTED|REQUEST_FAILED|API_RESPONSE_INVALID|API_REQUEST_FAILED|TARGET_NOT_READY|TARGET_AUTH_FAILED|MUTATION_UNCONFIRMED_RUN_STATUS|POSTCONDITION_FAILED_RUN_STATUS)$/;
  console.error(JSON.stringify({code:allowed.test(e.message)?e.message:'ROUTE_CHECK_FAILED'}));process.exitCode=1;
});
