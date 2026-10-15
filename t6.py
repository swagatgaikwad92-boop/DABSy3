import asyncio
from playwright.async_api import async_playwright
orig={"butter":"255,236,170","blush":"255,214,208","sage":"214,235,214","sky":"208,228,245","lilac":"228,218,245"}
new={"butter":"255,224,110","blush":"255,190,180","sage":"176,224,188","sky":"168,208,246","lilac":"208,190,246"}
def lum(c):
    f=lambda v:(v/255)/12.92 if v/255<=.03928 else (((v/255)+.055)/1.055)**2.4
    r,g,b=[f(x) for x in c]; return .2126*r+.7152*g+.0722*b
def mix(c,a,bg): return tuple(round(a*x+(1-a)*y) for x,y in zip(c,bg))
paper=(244,241,234); glass=lambda c:mix((255,255,255),.5,c)  # white glass layer .5 over what's below
ink=(42,38,34)
def cr(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+.05)/(lo+.05)
def sat(c):
    mx,mn=max(c),min(c); return round((mx-mn)/mx,2)
rows=[]
for k in orig:
    o=mix(tuple(map(int,orig[k].split(','))),.62,paper); n=mix(tuple(map(int,new[k].split(','))),.90,paper)
    rows.append((k,o,n,round(cr(ink,o),1),round(cr(ink,n),1),sat(o),sat(n)))
    print(k,'before',o,'sat',sat(o),'contrast',round(cr(ink,o),1),'| after',n,'sat',sat(n),'contrast',round(cr(ink,n),1))
html="<body style='margin:0;background:#f4f1ea;font:600 15px system-ui;color:#2a2622;padding:16px;width:358px'>"
for title,pal,al in (("BEFORE (.62)",orig,.62),("AFTER (.90)",new,.9)):
    html+=f"<div style='margin:6px 0'>{title}</div><div style='display:grid;grid-template-columns:1fr 1fr;gap:10px'>"
    for k,v in pal.items(): html+=f"<div style='border-radius:16px;padding:18px 12px;height:60px;background:rgba({v},{al});box-shadow:inset 0 1px 0 rgba(255,255,255,.75),0 0 0 1px rgba(70,62,50,.12)'>{k} note<br><small style='font-weight:400'>Chemistry revision</small></div>"
    html+="</div>"
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':390,'height':520},device_scale_factor=2)
    await pg.set_content(html); await pg.screenshot(path='/home/claude/shots/ss_cards_before_after.png'); await b.close()
asyncio.run(main())
