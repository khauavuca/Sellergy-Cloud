const fs = require('fs');
const path = require('path');
const names = process.argv.slice(2);
let bad = 0;
for (const n of names) {
  const f = path.join(__dirname, 'project', n + '.dc.html');
  const html = fs.readFileSync(f, 'utf8');
  const m = html.match(/data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  const markup = html.slice(html.indexOf('<x-dc>'), html.indexOf('</x-dc>'));
  try {
    class DCLogic { constructor(p) { this.props = p; } setState(o) { this.state = { ...this.state, ...o }; } }
    const C = new Function('DCLogic', m[1] + ';return Component')(DCLogic);
    const c = new C({});
    let v = c.renderVals();
    const loopVars = [...markup.matchAll(/as="(\w+)"/g)].map((x) => x[1]);
    const holes = [...new Set([...markup.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((x) => x[1]))];
    const missing = holes.filter((h) => { const root = h.split('.')[0]; if (loopVars.includes(root)) return false; if (['true', 'false'].includes(h)) return false; let o = v; for (const k of h.split('.')) { if (o == null || !(k in o)) return true; o = o[k]; } return false; });
    // click every top-level function, re-render each time
    let clicks = 0;
    for (let round = 0; round < 3; round++) {
      for (const [k, fn] of Object.entries(v)) {
        if (typeof fn === 'function') { fn({ target: { value: 'x' }, preventDefault() {} }); v = c.renderVals(); clicks++; }
        else if (Array.isArray(fn)) for (const it of fn) for (const g of Object.values(it || {})) if (typeof g === 'function') { g({ target: { value: 'x' }, preventDefault() {} }); v = c.renderVals(); clicks++; }
      }
    }
    console.log(n, 'ok', 'clicks', clicks, missing.length ? 'MISSING ' + missing.join(',') : '');
    if (missing.length) bad++;
  } catch (e) { console.log(n, 'ERRO', e.message); bad++; }
}
process.exit(bad ? 1 : 0);
