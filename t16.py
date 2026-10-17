import asyncio, json
from playwright.async_api import async_playwright
R=[]
def ok(n,c,e=''):
    R.append((n,bool(c),e)); print('PASS' if c else 'FAIL',n,e)
async def run(p, hour, name, pre=''):
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':360,'height':780},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}));localStorage.setItem("dabsy_world_v1",JSON.stringify({habitat:"lake",roam:"off",v:2}));'+pre)
    pg=await ctx.new_page(); await pg.clock.install(time=f'2026-10-17T{hour:02d}:30:00'); pg.errs=[]; pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(2500); return b,pg
async def main():
  async with async_playwright() as p:
    # real-time day/night
    for hour,exp in [(12,'light'),(22,'dark'),(5,'dark'),(6,'light'),(17,'light'),(18,'dark')]:
        b,pg=await run(p,hour,'t'); t=await pg.evaluate('({t:document.documentElement.dataset.theme,l:document.body.dataset.light,m:DABSy.theme.mode()})')
        ok(f'{hour:02d}:30 real time -> {exp}', t['t']==exp and t['l']==('day' if exp=='light' else 'night') and t['m']=='auto', json.dumps(t)); await b.close()
    # flips while the app is open (clock moves from 17:59 to 18:01)
    b,pg=await run(p,17,'t'); await pg.clock.fast_forward('01:30:00'); await pg.wait_for_timeout(1200)
    ok('app open across 18:00: switches to Night by itself', await pg.evaluate('document.documentElement.dataset.theme==="dark"&&document.body.dataset.light==="night"')); await b.close()
    # manual choice sticks, Auto returns to real time
    b,pg=await run(p,12,'t'); await pg.evaluate('DABSy.theme.setMode("night")'); await pg.wait_for_timeout(400)
    ok('manual Night at noon stays Night', await pg.evaluate('document.documentElement.dataset.theme==="dark"'))
    await pg.evaluate('DABSy.theme.setMode("auto")'); await pg.wait_for_timeout(400)
    ok('back to Auto at noon -> Day', await pg.evaluate('document.documentElement.dataset.theme==="light"')); await b.close()
    # existing install that had Night saved is migrated to Auto once
    b,pg=await run(p,12,'t','localStorage.setItem("dabsy_settings",JSON.stringify({theme:"dark"}));')
    ok('old saved "dark" is migrated to Auto (real time) once', await pg.evaluate('DABSy.theme.mode()==="auto"&&document.documentElement.dataset.theme==="light"')); await b.close()
    # dock stays centred and on-screen: closed chat, open chat, keyboard (predicted + real)
    b,pg=await run(p,22,'t'); await pg.evaluate('DABSy.app.openCommand(true)'); await pg.wait_for_timeout(900)
    async def geo(tag):
        g=await pg.evaluate('(()=>{const r=document.getElementById("chat-area").getBoundingClientRect(),d=document.getElementById("input-dock").getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),dl:Math.round(d.left),dr:Math.round(d.right),w:innerWidth,cx:Math.round((r.left+r.right)/2)}})()')
        ok(f'chat dock centred and fully on screen ({tag})', g['l']>=0 and g['r']<=g['w'] and g['dl']>=0 and g['dr']<=g['w'] and abs(g['cx']-g['w']/2)<=2, json.dumps(g))
    await geo('chat open')
    await pg.focus('#text-input'); await pg.wait_for_timeout(500); await geo('keyboard predicted')
    await pg.evaluate('(()=>{window.__vv=300;Object.defineProperty(visualViewport,"height",{get:()=>innerHeight-window.__vv,configurable:true});visualViewport.dispatchEvent(new Event("resize"))})()'); await pg.wait_for_timeout(700); await geo('keyboard real')
    await pg.screenshot(path='/home/claude/shots/t16_kb.png')
    ok('no page errors', not pg.errs, str(pg.errs)); await b.close()
asyncio.run(main()); print('SUMMARY',sum(r[1] for r in R),'/',len(R))
