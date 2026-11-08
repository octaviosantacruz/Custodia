// Run against disposable binaries, frontend and database; see docs/ACCESS.md.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createServer, request} from 'node:http';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {chromium} from '../web/node_modules/playwright/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ozalBinary = process.env.OZAL_BIN;
const custodiaBinary = process.env.CUSTODIA_BIN;
const webDir = process.env.CUSTODIA_WEB_DIR;
if (!ozalBinary || !custodiaBinary || !webDir || !process.env.CUSTODIA_TEST_DATABASE_URL) {
  throw new Error('Set OZAL_BIN, CUSTODIA_BIN, CUSTODIA_WEB_DIR and CUSTODIA_TEST_DATABASE_URL; see docs/ACCESS.md');
}
const db = new URL(process.env.CUSTODIA_TEST_DATABASE_URL);
assert(db.hostname === '127.0.0.1' && db.pathname === '/custodia_test', 'Use the disposable database from scripts/test-db.sh');
const root = await mkdtemp('/tmp/custodia-ozal-run-');
const children = [];
const servers = [];
const errors = [];
const checks = [];
let browser, stage = 'setup', edge, backend;
let captured, cookieLeak = false;
const token = randomBytes(24).toString('hex');
const delay = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject).listen(0, '127.0.0.1', () => { servers.push(server); resolve(server.address().port); });
});
const freePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise(r => server.close(r)); servers.splice(servers.indexOf(server), 1);
  return port;
};
const start = (binary, args) => {
  const child = spawn(binary, args, {env: {...process.env, OZAL_ACCEPTANCE_ADMIN: token}, stdio: ['ignore','pipe','pipe']});
  // Keep all service output private; never emit tokens or invitation links.
  child.stdout.resume(); child.stderr.resume(); children.push(child); return child;
};
const stop = async child => {
  if (!child || child.exitCode !== null) return;
  const done = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await done;
};
const ready = async (url, child) => {
  for (let i=0; i<150; i++) {
    if(child.exitCode !== null) throw new Error('service exited during startup');
    try {if ((await fetch(url)).ok) return;} catch {}
    await delay(100);
  }
  throw new Error('service startup timed out');
};
const jsonFile = (name, data) => writeFile(join(root,name),JSON.stringify(data),{mode:0o600});
try {
  const [port, adminPort, backendPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const login = `http://auth.acceptance.localhost:${port}`;
  const app = `http://custodia.acceptance.localhost:${port}`;
  const direct = `http://127.0.0.1:${backendPort}`;
  // Observe the actual signed hop without saving or printing its assertion.
  const observerPort = await listen(createServer((req,res) => {
    if(req.headers['x-ozal-assertion']) captured=req.headers['x-ozal-assertion'];
    if(/(?:sb_session|sb_handoff)/.test(req.headers.cookie ?? '')) cookieLeak=true;
    const upstream = request(`${direct}${req.url}`, {method:req.method,headers:req.headers}, incoming => {
      res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
    });
    upstream.on('error',()=>{res.writeHead(502);res.end();}); req.pipe(upstream);
  }));
  await jsonFile('edge.json', {
    listen:`127.0.0.1:${port}`,
    admin:{listen:`127.0.0.1:${adminPort}`, token:'env:OZAL_ACCEPTANCE_ADMIN'},
    auth:{cookie_domain:'acceptance.localhost',passkeys:{rp_id:'acceptance.localhost',login_url:login,display_name:'Acceptance'}},
    identity_assertion:{key_dir:join(root,'assertion')},
    routes:[{host:`custodia.acceptance.localhost:${port}`,target:`http://127.0.0.1:${observerPort}`,health_path:'/healthz',
      access:{allowed_domains:['acme.example']},identity_assertion:{audience:'custodia'}}]
  });
  const edgeArgs=['-config',join(root,'edge.json'),'-db',join(root,'state.db')];
  execFileSync(ozalBinary,['migrate','-db',join(root,'state.db')],{stdio:'pipe'});
  edge=start(ozalBinary,edgeArgs);
  await ready(`http://127.0.0.1:${adminPort}/_/healthz`,edge);
  const publicKey=execFileSync(ozalBinary,['assertion','public-key','-config',join(root,'edge.json')]);
  await writeFile(join(root,'ozal.pub'),publicKey);
  await jsonFile('custodia.json',{
    listen:`127.0.0.1:${backendPort}`,database_url:'env:CUSTODIA_TEST_DATABASE_URL',web_dir:webDir,
    ozal:{issuer:login,audience:'custodia',public_keys:[join(root,'ozal.pub')],max_skew_seconds:5},
    readers:{groups:['security'],emails:[]}
  });
  const cfg=['-config',join(root,'custodia.json')];
  execFileSync(custodiaBinary,['migrate','up',...cfg],{stdio:'pipe'});
  execFileSync(custodiaBinary,['seed','demo',...cfg,'-fixture',join(repo,'web/src/demo/model/company.json')],{stdio:'pipe'});
  backend=start(custodiaBinary,['serve',...cfg]);
  await ready(`${direct}/healthz`,backend);
  // The first edge probe ran before the backend existed. Restart only our
  // isolated edge so its initial health probe sees the ready backend.
  await stop(edge); edge=start(ozalBinary,edgeArgs);
  await ready(`http://127.0.0.1:${adminPort}/_/healthz`,edge);
  const admin = async (method,path,body) => {
    const r=await fetch(`http://127.0.0.1:${adminPort}/_/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert(r.ok,`admin operation failed: ${r.status}`); return r.status===204?null:r.json();
  };
  await admin('POST','/groups',{name:'security'});
  browser=await chromium.launch({args:['--no-sandbox']});
  const device = async (email,groups) => {
    const context=await browser.newContext();const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
    const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
    const invitation=await admin('POST','/people/invite',{email,name:email.split('@')[0],groups,ttl_minutes:15});
    await page.goto(invitation.link);await page.locator('#action').click();
    await page.locator('#who:not([hidden])').waitFor({timeout:20000});
    assert.equal((await cdp.send('WebAuthn.getCredentials',{authenticatorId})).credentials.length,1);
    return {context,page,cdp,authenticatorId};
  };
  stage='two independent passkey enrolments';
  const reader=await device('reader@acme.example',['security']);
  const outsider=await device('outsider@acme.example',[]);
  checks.push(stage);
  stage='reader reaches People in Spanish and English through real Ozal';
  for(const lang of ['es','en']) {
    const response=await reader.page.goto(`${app}/chains/person?lang=${lang}`);
    assert.equal(response.status(),200,`app status ${response.status()}: ${response.status() === 200 ? 'OK' : await response.text()}`);
    await reader.page.getByRole('heading',{name:lang==='es'?'Personas':'People',exact:true,level:1}).waitFor();
    await reader.page.getByRole('searchbox').fill('bob');
    await reader.page.getByRole('option',{name:/Bob Chen/}).click();
    await reader.page.getByLabel(/(?:Persona|Person) Bob Chen/, {exact:true}).waitFor();
    await reader.page.screenshot({path:join(root,`people-${lang}.png`),fullPage:true});
  }
  checks.push(stage);
  stage='fresh assertions, verified identity and real inventory';
  const api=async (device,path,options={}) => device.context.request.get(`${app}${path}`,options);
  for(let i=0;i<3;i++) {
    const r=await api(reader,'/api/auth/status');assert.equal(r.status(),200);
    const auth=await r.json();assert.equal(auth.user.email,'reader@acme.example');
  }
  const search=await api(reader,'/api/chains/person/search');assert.equal(search.status(),200);assert.equal((await search.json()).people.length,6);
  const coverage=await api(reader,'/api/chains/person/coverage');assert.equal(coverage.status(),200);
  const detail=await api(reader,'/api/chains/person/coverage/detail?email=bob.chen%40acme.example');assert.equal(detail.status(),200);
  assert.equal(cookieLeak,false,'Ozal session cookie leaked upstream');checks.push(stage);
  stage='non-reader denied by Custodia despite successful Ozal login';
  const denied=await api(outsider,'/api/chains/person/search');assert.equal(denied.status(),403);assert.equal((await denied.json()).detail,'not_a_reader');
  assert.equal((await outsider.page.goto(`${app}/`)).status(),403);checks.push(stage);
  stage='direct and forged-header bypasses denied';
  for(const headers of [{},{'X-Auth-Request-Email':'reader@acme.example','X-Ozal-Visitor-Email':'reader@acme.example'},{'X-Ozal-Assertion':'forged'}]) {
    assert.equal((await fetch(`${direct}/api/auth/status`,{headers})).status,401);
  }
  assert.equal((await api(reader,'/api/auth/status',{headers:{'X-Ozal-Assertion':'forged','X_Ozal_Assertion':'forged'}})).status(),200);
  const replay=await fetch(`${direct}/api/auth/status`,{headers:{'X-Ozal-Assertion':captured}});assert.equal(replay.status,401);assert.equal((await replay.json()).detail,'replayed');
  checks.push(stage);
  stage='restart preserves passkey sessions and authorization';
  await stop(edge);edge=start(ozalBinary,edgeArgs);await ready(`http://127.0.0.1:${adminPort}/_/healthz`,edge);
  assert.equal((await api(reader,'/api/auth/status')).status(),200);assert.equal((await api(outsider,'/api/auth/status')).status(),403);checks.push(stage);
  stage='logout revokes reader session without affecting other user';
  await reader.cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId:reader.authenticatorId,enabled:false});
  const logout=await reader.context.request.post(`${login}/_/auth/logout`,{maxRedirects:0});assert.equal(logout.status(),303);
  const signedOut=await api(reader,'/api/auth/status',{maxRedirects:0});assert([302,303].includes(signedOut.status()));
  assert.equal((await api(outsider,'/api/auth/status')).status(),403);checks.push(stage);
  stage='existing passkey signs in again without enrolment';
  await reader.cdp.send('WebAuthn.setAutomaticPresenceSimulation',{authenticatorId:reader.authenticatorId,enabled:true});
  await reader.page.goto(`${app}/chains/person?lang=en`);
  await reader.page.getByRole('heading',{name:'People',exact:true,level:1}).waitFor({timeout:20000});
  assert.equal((await api(reader,'/api/auth/status')).status(),200);
  assert.equal((await reader.cdp.send('WebAuthn.getCredentials',{authenticatorId:reader.authenticatorId})).credentials.length,1);checks.push(stage);
  assert.deepEqual(errors,[],'browser errors');
  console.log(JSON.stringify({result:'PASS',checks,limits:['isolated loopback HTTP; browser virtual authenticators','public Cloudflare ingress and physical passkeys not tested']},null,2));
} catch(error) {
  const message = error.message.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try { const url = new URL(raw); return url.origin + url.pathname; } catch { return '[URL omitted]'; }
  });
  console.error(`FAIL during ${stage}: ${message}`);process.exitCode=1;
} finally {
  await browser?.close();for(const child of children.reverse()) await stop(child);
  for(const server of servers) await new Promise(r=>server.close(r));
  await rm(root,{recursive:true,force:true});
}
