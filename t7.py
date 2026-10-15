import asyncio, json
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'
async def run(p, name, vw, vh, pre=None, theme=None):
    b=await p.chromium.launch()
    ctx=await b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));'+(pre or ''))
    pg=await ctx.new_page(); errs=[]; bad=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('response',lambda r: bad.append((r.status,r.url)) if r.status>=400 and 'localhost' in r.url else None)
    pg.on('requestfailed',lambda r: bad.append(('FAIL',r.url)) if 'localhost' in r.url else None)
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(3000)
    info=await pg.evaluate('''(()=>{const f=document.getElementById("face").getBoundingClientRect(),w=document.getElementById("creature-wrap").getBoundingClientRect();
      return {form:document.body.dataset.form,faceCenter:[Math.round(f.left+f.width/2),Math.round(f.top+f.height/2)],faceBox:[Math.round(f.left),Math.round(f.top),Math.round(f.right),Math.round(f.bottom)],vw:innerWidth,vh:innerHeight,
       broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).length,imgs:document.images.length,
       saved:localStorage.getItem("dabsy_outfits")||localStorage.getItem("dabsy_outfit_v1")}})()''')
    print(name,json.dumps(info),'pageerrors',errs,'bad',bad)
    await pg.screenshot(path=f'/home/claude/shots/{name}.png')
    return b,pg
async def main():
  async with async_playwright() as p:
    b,pg=await run(p,'classic_default_390x844',390,844); await b.close()
    b,pg=await run(p,'classic_default_360x640',360,640); await b.close()
    # stale v10 state: form magic never chosen (what the user's phone has) -> must fall back to Classic
    b,pg=await run(p,'stale_magic_unchosen',390,844,'localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic"}))'); await b.close()
    # explicit choice honoured
    b,pg=await run(p,'magic_chosen',390,844,'localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}))'); await b.close()
    # invalid value
    b,pg=await run(p,'invalid_form',390,844,'localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"banana",formChosen:true}))'); await b.close()
    # magic with assets blocked entirely -> graceful fallback to Classic
    ctx=None
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}))')
    await ctx.route(lambda u: 'magic-assets.js' in u or '/assets/magic/' in u, lambda r: r.fulfill(status=404,body='nope'))
    pg=await ctx.new_page(); await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(4000)
    print('assets-404 ->', await pg.evaluate('({form:document.body.dataset.form,broken:[...document.images].filter(i=>i.complete&&!i.naturalWidth).length,world:DABSy.world.active(),a:DABSy.world.assets(),loading:document.body.classList.contains("mw-loading")})'))
    await pg.screenshot(path='/home/claude/shots/magic_assets_404_fallback.png'); await b.close()
asyncio.run(main())
