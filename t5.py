import asyncio, json
from playwright.async_api import async_playwright
R={}
def rec(k,ok,info=''): print(('PASS ' if ok else 'FAIL ')+k, info)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    ctx=await b.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    pg=await ctx.new_page(); await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(3000)
    rec('no iframe anywhere in DABSy DOM', await pg.evaluate('document.querySelectorAll("iframe").length')==0)
    await pg.evaluate('''window.__o=[];window.open=function(u,n,f){__o.push([u,n,f||null,(new Error().stack||"").replace(/\s+/g," ").slice(0,260)]);return {focus(){}}}''')
    await pg.evaluate('DABSy.ecosystem.open()'); await pg.wait_for_timeout(700)
    await pg.click('.eco-bubble[data-app="study"]'); await pg.wait_for_timeout(900)
    btns=await pg.evaluate('[...document.querySelectorAll("button")].filter(b=>/Open Study Space/i.test(b.textContent)).map(b=>b.textContent)'); print(btns)
    await pg.evaluate('''[...document.querySelectorAll("button")].find(b=>/Open Study Space/i.test(b.textContent))?.click()'''); await pg.wait_for_timeout(500)
    o=await pg.evaluate('__o.filter(x=>x[0])'); print([x[:3] for x in o])
    rec('Study Space launched as top-level named window, absolute real URL, no noopener/embed', len(o)>=1 and o[0][0].startswith('https://swagatgaikwad92-boop.github.io/study-space/') and o[0][1] and o[0][2] is None, str(o))
    await pg.evaluate('document.querySelectorAll("button").forEach(b=>{if(/Open Study Space/i.test(b.textContent))b.click()})'); await pg.wait_for_timeout(300)
    o=await pg.evaluate('__o.filter(x=>x[0])'); rec('second tap re-targets the same named window (no duplicate tab)', len(o)>=2 and o[0][1]==o[-1][1], str([x[1] for x in o]))
    # popup blocked -> top-level navigation, not embed
    await pg.evaluate('window.open=()=>null')
    await b.close()
asyncio.run(main())
