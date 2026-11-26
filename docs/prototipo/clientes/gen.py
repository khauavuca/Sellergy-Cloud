import re, glob, os

base = open('project/Caixa.dc.html', encoding='utf-8').read()
head = base.split('</style>')[0]
side = base[base.index('<aside'):base.index('</aside>') + 8]
side = side.replace('class="nav on" aria-current="page"', 'class="nav"')

SHARED = r"""
.t1{margin:0;font-family:'Space Grotesk',sans-serif;font-size:28px;letter-spacing:-0.02em}
.t2{margin:0;font-size:16px}
.mut{color:#5B616B}.sm{font-size:13px}.n{font-variant-numeric:tabular-nums}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
.k{padding:16px}.kl{margin:0;font-size:13px;color:#5B616B}.kv{margin:6px 0 0;font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.kx{margin:4px 0 0;font-size:12px;color:#5B616B}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}
.ok{background:#E3F4EA;color:#0E5C34}.wait{background:#FDF0D9;color:#7A4A00}.bad{background:#FBE4E1;color:#8F1D12}.neu{background:#E8EAED;color:#3D434B}.info{background:#E4EEF9;color:#1D4F86}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid #D5D8DC;background:#fff;font:inherit;font-size:14px;font-weight:500;cursor:pointer;color:#3D434B}
.chip.on{background:#15171A;border-color:#15171A;color:#fff}
.f{display:flex;flex-direction:column;gap:6px;min-width:0}
.f label,.f .lb{font-size:13px;font-weight:600;color:#3D434B}
.f input,.f select,.f textarea{font:inherit;font-size:15px;min-height:44px;padding:0 12px;border:1px solid #CDD1D6;border-radius:10px;background:#fff;box-sizing:border-box;width:100%}
.f textarea{padding:10px 12px;min-height:96px;resize:vertical;line-height:1.5}
.ajuda{font-size:12px;color:#5B616B}
.steps{display:flex;gap:6px;flex-wrap:wrap}
.st{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#8A9099;padding:6px 10px 6px 6px;border-radius:999px;border:1px solid transparent}
.st b{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#E8EAED;color:#5B616B;font-size:12px}
.st.on{color:#15171A;background:#fff;border-color:#E3E5E8}.st.on b{background:#136F4D;color:#fff}
.st.done{color:#0E5C34}.st.done b{background:#E3F4EA;color:#0E5C34}
.sw{width:46px;height:28px;border-radius:999px;background:#CDD1D6;position:relative;border:0;cursor:pointer;flex-shrink:0;padding:0}
.sw::after{content:'';position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.sw.on{background:#136F4D}.sw.on::after{left:22px}
.ov{position:absolute;inset:0;background:rgba(21,23,26,.42);display:flex;align-items:flex-start;justify-content:center;padding:70px 16px;z-index:5}
.modal{background:#fff;border-radius:18px;width:min(560px,100%);padding:24px;box-sizing:border-box;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.li{display:flex;gap:12px;align-items:center;padding:12px 18px;border-top:1px solid #EEF0EC;font-size:14px}
.av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:12px;flex-shrink:0;background:#E3F1EA;color:#0E5C34}
.tabs{display:flex;gap:4px;border-bottom:1px solid #E3E5E8;flex-wrap:wrap}
.tab{min-height:44px;padding:0 14px;border:0;background:none;font:inherit;font-size:14px;font-weight:600;color:#5B616B;cursor:pointer;border-bottom:2px solid transparent}
.tab.on{color:#136F4D;border-bottom-color:#136F4D}
.opt{display:flex;gap:12px;align-items:flex-start;text-align:left;padding:14px;border:1px solid #D5D8DC;border-radius:12px;background:#fff;font:inherit;cursor:pointer;width:100%;box-sizing:border-box;color:#15171A}
.opt.on{border-color:#136F4D;box-shadow:0 0 0 1px #136F4D inset;background:#F3FAF6}
.bars{display:flex;align-items:flex-end;gap:10px;height:170px;padding:0 4px}
.bars div{flex:1;background:#BFE0CF;border-radius:6px 6px 0 0;min-width:10px}
.bars div.hi{background:#136F4D}
""" + ''.join('.b%d{height:%d%%}' % (i, i) for i in range(5, 101, 5)) + """
.drop{border:2px dashed #CDD1D6;border-radius:14px;padding:28px;text-align:center;background:#FAFBF9}
.ok-ic{width:64px;height:64px;border-radius:50%;background:#E3F4EA;color:#136F4D;display:inline-grid;place-items:center}
"""

PHONE_HEAD = '''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Space+Grotesk:wght@500;600;700&amp;display=swap">
<style>
body{margin:0}
a{color:#136F4D}
.i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
.bp,.bs,.bg{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:0 20px;border-radius:12px;font-weight:600;font-size:16px;text-decoration:none;cursor:pointer;font-family:inherit;box-sizing:border-box;width:100%}
.bp{background:#136F4D;color:#fff;border:1px solid #136F4D}
.bs{background:#fff;color:#15171A;border:1px solid #D5D8DC}
.bg{background:transparent;color:#3D434B;border:0;min-height:44px;font-size:15px}
.cd{background:#fff;border:1px solid #E3E5E8;border-radius:18px}
.mut{color:#5B616B}.n{font-variant-numeric:tabular-nums}
.pill{display:inline-flex;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px}
.ok{background:#E3F4EA;color:#0E5C34}.wait{background:#FDF0D9;color:#7A4A00}.bad{background:#FBE4E1;color:#8F1D12}
.f{display:flex;flex-direction:column;gap:6px}.f label{font-size:14px;font-weight:600}
.f input{font:inherit;font-size:16px;min-height:50px;padding:0 14px;border:1px solid #CDD1D6;border-radius:12px;box-sizing:border-box;width:100%}
.ok-ic{width:72px;height:72px;border-radius:50%;background:#E3F4EA;color:#136F4D;display:inline-grid;place-items:center}
.h{margin:0;font-family:'Space Grotesk',sans-serif;font-size:26px;letter-spacing:-0.02em}
.wa{background:#EFE7DD;flex:1;display:flex;flex-direction:column;gap:8px;padding:14px 12px;overflow:hidden}
.msg{max-width:84%;background:#fff;border-radius:10px;padding:9px 11px;font-size:14px;line-height:1.45;box-shadow:0 1px 0 rgba(0,0,0,.08)}
.msg.me{align-self:flex-end;background:#D9FDD3}
.msg small{display:block;text-align:right;font-size:11px;color:#667}
.wb{display:block;width:100%;min-height:44px;border:0;border-top:1px solid #E8E8E8;background:#fff;color:#0A7CFF;font:inherit;font-size:15px;font-weight:600;cursor:pointer}
.tb{display:flex;border-top:1px solid #E3E5E8;background:#fff}
.tb a{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0 12px;font-size:11px;font-weight:600;color:#6B717A;text-decoration:none;min-height:44px;justify-content:center}
.tb a.on{color:#136F4D}
__CSS__
</style>
</helmet>
'''

INLINE = ('title', 'nav', 'h', 'loja', 'phone')


def parse(p):
    s = open(p, encoding='utf-8').read()
    d = {}
    for part in re.split(r'^@@', s, flags=re.M)[1:]:
        first, _, rest = part.partition('\n')
        bits = first.strip().split(' ', 1)
        key = bits[0]
        if key in INLINE:
            d[key] = bits[1] if len(bits) > 1 else '1'
        else:
            d[key] = rest
    return d


def script(d, w, h):
    body = d.get('script', 'class Component extends DCLogic { renderVals() { return {}; } }\n')
    return ('<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":%d,"height":%d}}\'>\n' % (w, h)
            + body + '</script>\n</body>\n</html>\n')


for p in sorted(glob.glob('frag/*.txt')):
    name = os.path.basename(p)[:-4]
    d = parse(p)
    h = int(d.get('h', '1040'))
    if 'phone' in d:
        out = PHONE_HEAD.replace('__TITLE__', d.get('title', name)).replace('__CSS__', d.get('css', ''))
        out += ('<div style="width: 390px; height: 844px; font-family: Inter, system-ui, sans-serif; color: #15171A; '
                'background: #F6F7F5; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; position: relative">\n'
                + d['main'] + '</div>\n</x-dc>\n' + script(d, 390, 844))
    else:
        hd = re.sub(r'<title>.*?</title>', '<title>%s</title>' % d.get('title', 'Sellergy'), head)
        sd = side
        nav = d.get('nav', '')
        if nav:
            sd = sd.replace('<a href="%s" class="nav">' % nav, '<a href="%s" class="nav on" aria-current="page">' % nav)
        if d.get('loja'):
            sd = re.sub(r'<a href="Agenda\.dc\.html".*?</a>\n', '', sd, flags=re.S)
            sd = sd.replace('Clínica Lumi Estética', 'Ária Moda Feminina').replace('Marina · dona', 'Rafaela · dona').replace('>ML<', '>RA<')
        out = (hd + SHARED + d.get('css', '') + '\n</style>\n</helmet>\n'
               + '<div style="font-family: Inter, system-ui, sans-serif; color: #15171A; background: #F6F7F5; min-height: %dpx; display: flex; flex-wrap: wrap; position: relative">\n\n' % h
               + sd + '\n\n<main style="flex: 999 1 560px; min-width: 0; padding: 24px 28px 40px; box-sizing: border-box; display: flex; flex-direction: column; gap: 18px">\n'
               + d['main'] + '</main>\n' + d.get('after', '') + '</div>\n</x-dc>\n' + script(d, 1440, h))
    open('project/%s.dc.html' % name, 'w', encoding='utf-8').write(out)
    print('ok', name, len(out))
