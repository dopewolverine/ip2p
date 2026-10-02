const ROOT = require('path').resolve(__dirname, '../..') + '/';
const http = require('http');
const state = { utxos: {}, txs: {}, conf: {}, sent: [] };
http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const u = req.url;
  if (req.method === 'POST' && u === '/__set') {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { Object.assign(state, JSON.parse(b)); send(200, { ok: true }); });
    return;
  }
  if (u === '/__sent') return send(200, state.sent);
  let m;
  if ((m = u.match(/^\/api\/v2\/estimatefee\/\d+/))) return send(200, { result: '0.00010000' });
  if ((m = u.match(/^\/api\/v2\/utxo\/([^?]+)/))) return send(200, state.utxos[m[1]] ?? []);
  if ((m = u.match(/^\/api\/v2\/tx-specific\/([0-9a-f]{64})/))) return state.txs[m[1]] ? send(200, { hex: state.txs[m[1]] }) : send(404, { error: 'not found' });
  if ((m = u.match(/^\/api\/v2\/tx\/([0-9a-f]{64})/))) return send(200, { confirmations: state.conf[m[1]] ?? 0 });
  if ((m = u.match(/^\/api\/v2\/sendtx\/([0-9a-f]+)/))) {
    const bitcoin = require(ROOT + 'backend/node_modules/bitcoinjs-lib');
    if (state.rejectBroadcast) return send(503, { error: 'unknown provider error' });
    const tx = bitcoin.Transaction.fromHex(m[1]); state.txs[tx.getId()] = m[1]; state.sent.push(m[1]); return send(200, { result: tx.getId() });
  }
  if ((m = u.match(/^\/api\/v2\/address\//))) return send(200, { balance: '0', unconfirmedBalance: '0' });
  send(404, { error: 'mock: unknown path ' + u });
}).listen(5999, () => console.log('mock blockbook on 5999'));
