import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createDatabase } from '../lib/database.mjs';
import { createService } from '../lib/service.mjs';
import { createApp, createFailureLimiter } from '../server.mjs';

async function fixture(t, options={}) {
  const database=createDatabase(':memory:');const service=createService(database);
  const server=createApp(service,options);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));database.close();});
  return {database,service,base:`http://127.0.0.1:${server.address().port}`};
}
async function login(base,username,headers={}) {
  return fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({username,password:'wrong-password'})});
}

test('spoofed CF and XFF headers do not bypass canonical proxy source limits',async t=>{
  for(const header of ['CF-Connecting-IP','X-Forwarded-For']) {
    const {base}=await fixture(t,{trustProxy:true,loginSourceLimiter:createFailureLimiter({maxFailures:2})});
    const statuses=[];
    for(let i=0;i<4;i++) {const r=await login(base,`unknown-${header}-${i}`,{'X-Real-IP':'192.0.2.5',[header]:`203.0.113.${i+1}`});statuses.push(r.status);await r.json();}
    assert.deepEqual(statuses,[401,401,429,429]);
  }
});

test('canonical proxy addresses separate real clients and malformed values fall back to socket',async t=>{
  const {base}=await fixture(t,{trustProxy:true,loginSourceLimiter:createFailureLimiter({maxFailures:1})});
  for(const address of ['192.0.2.10','192.0.2.11','2001:db8::2']) {
    const r=await login(base,`unknown-${address}`,{'X-Real-IP':address});assert.equal(r.status,401);await r.json();
    const denied=await login(base,`again-${address}`,{'X-Real-IP':address});assert.equal(denied.status,429);await denied.json();
  }
  const first=await login(base,'invalid-first',{'X-Real-IP':'not-an-ip'});assert.equal(first.status,401);await first.json();
  const next=await login(base,'invalid-next',{'X-Real-IP':'192.0.2.1, 192.0.2.2'});assert.equal(next.status,429);await next.json();
});

test('LAN overwrites forwarded addresses; VPS canonicalizes only from loopback Caddy',()=>{
  for(const profile of ['lan','vps']) {
    const nginx=readFileSync(new URL(`../../../deploy/${profile}/nginx.conf`,import.meta.url),'utf8');
    assert.match(nginx,/proxy_set_header X-Real-IP \$remote_addr;/);
    assert.match(nginx,/proxy_set_header X-Forwarded-For \$remote_addr;/);
    assert.match(nginx,/proxy_set_header CF-Connecting-IP "";/);
    if(profile==='vps') {assert.match(nginx,/set_real_ip_from 127\.0\.0\.1;/);assert.match(nginx,/real_ip_header CF-Connecting-IP;/);}
    else assert.doesNotMatch(nginx,/real_ip_header/);
  }
});

test('HTTP login never issues a session from credentials reset after authentication',async t=>{
  const {service,base}=await fixture(t);const admin=service.listUsers().find(u=>u.role==='developer');
  const original=service.authenticate.bind(service);
  service.authenticate=async(...args)=>{const user=await original(...args);service.resetUserPassword(user.id,admin);return user;};
  const r=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'member01',password:'123456'})});
  assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);await r.json();
});

test('HTTP password change never issues a session if an intervening reset invalidated the new credentials',async t=>{
  const {service,base}=await fixture(t);const admin=service.listUsers().find(u=>u.role==='developer'),member=service.listUsers().find(u=>u.username==='member01');
  const session=service.createSession(member.id);const original=service.changePassword.bind(service);
  service.changePassword=async(...args)=>{const user=await original(...args);service.resetUserPassword(user.id,admin);return user;};
  const r=await fetch(`${base}/api/auth/change-password`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:`cipc_session=${session.token}`},body:JSON.stringify({currentPassword:'123456',newPassword:'NewPassword2026'})});
  assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);await r.json();
});
