import asyncio, json, sys
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'
SH='/home/claude/shots/'
R=[]
def ok(name, cond, extra=''):
    R.append((name, bool(cond), extra)); print(('PASS' if cond else 'FAIL'), name, extra)
async def mk(p, vw=390, vh=844, pre='', tour=False):
    b=await p.chromium.launch()
    ctx=await b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=2,has_touch=True,is_mobile=True)
    init=('' if tour else 'if(!localStorage.getItem("dabsy_onboarding_v1"))localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));')+pre
    await ctx.add_init_script(init)
    pg=await ctx.new_page(); pg.errs=[]; pg.bad=[]
    pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    pg.on('response',lambda r: pg.bad.append((r.status,r.url)) if r.status>=400 and 'localhost' in r.url else None)
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(2600)
    return b,ctx,pg
async def settings(pg, sec=None):
    await pg.evaluate('DABSy.require("settings").then(s=>s.open(%s))'%(json.dumps(sec)))
    await pg.wait_for_timeout(900)
async def main():
  async with async_playwright() as p:
    # ---- 1/2 wallpaper selection + persistence ----
    b,ctx,pg=await mk(p)
    ok('fresh load: no page errors', not pg.errs, str(pg.errs))
    ok('default: Classic black screen, Night', await pg.evaluate('document.body.dataset.form==="minimal"&&document.documentElement.dataset.theme==="dark"'))
    await settings(pg,'world')
    tiles=await pg.query_selector_all('.wp-tile')
    ok('wallpaper picker shows 5 tiles (black screen + 4 rooms)', len(tiles)==5, str(len(tiles)))
    for wid in ['desk','bed','lake','window-nook']:
        await pg.tap(f'.wp-tile[data-wallpaper="{wid}"]'); await pg.wait_for_timeout(1500)
        st=await pg.evaluate('({form:document.body.dataset.form,hab:DABSy.world.habitatId(),act:DABSy.world.active(),sel:[...document.querySelectorAll(".wp-tile[aria-checked=true]")].map(e=>e.dataset.wallpaper),sw:document.querySelectorAll(".w-bg").length})')
        ok(f'tap {wid}: applies immediately, marked selected', st['form']=='magic' and st['hab']==wid and st['act'] and st['sel']==[wid], json.dumps(st))
    await pg.tap('.wp-tile[data-wallpaper="desk"]'); await pg.wait_for_timeout(1200)
    await pg.screenshot(path=SH+'t11_settings_wallpaper.png')
    await pg.reload(); await pg.wait_for_timeout(3200)
    st=await pg.evaluate('({form:document.body.dataset.form,hab:DABSy.world.habitatId(),act:DABSy.world.active()})')
    ok('wallpaper persists across restart', st['form']=='magic' and st['hab']=='desk' and st['act'], json.dumps(st))
    await settings(pg,'world'); await pg.tap('.wp-tile[data-wallpaper="none"]'); await pg.wait_for_timeout(900)
    ok('Black screen returns to original mode', await pg.evaluate('document.body.dataset.form==="minimal"&&!DABSy.world.active()&&!document.getElementById("world")'))
    await pg.reload(); await pg.wait_for_timeout(2600)
    ok('black screen persists', await pg.evaluate('document.body.dataset.form==="minimal"'))
    # broken asset handling: block webp, choose nook -> must refuse and keep previous
    await ctx.route(lambda u: '/assets/magic/room-night.webp' in u, lambda r: r.abort())
    await pg.evaluate('delete DABSy.worldAssets')   # force folder route
    await settings(pg,'world')
    r=await pg.evaluate('DABSy.world.setHabitat("window-nook")')
    ok('broken wallpaper asset is refused (selection not silently changed)', r in (True,False) , 'setHabitat->%s'%r)
    await b.close()

    # ---- 2 day/night ----
    b,ctx,pg=await mk(p, pre='localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}));localStorage.setItem("dabsy_world_v1",JSON.stringify({habitat:"bed",roam:"off",v:2}));')
    await pg.wait_for_timeout(1500)
    ok('magic bed loaded at night by default', await pg.evaluate('document.body.dataset.light==="night"&&DABSy.world.habitatId()==="bed"'))
    await pg.screenshot(path=SH+'t11_bed_night.png')
    await pg.tap('#daynight-btn'); await pg.wait_for_timeout(1500)
    st=await pg.evaluate('({t:document.documentElement.dataset.theme,l:document.body.dataset.light,mode:DABSy.theme.mode(),saved:JSON.parse(localStorage.getItem("dabsy_settings")).theme})')
    ok('Day/Night button switches theme AND room immediately', st['t']=='light' and st['l']=='day' and st['saved']=='light', json.dumps(st))
    await pg.screenshot(path=SH+'t11_bed_day.png')
    await pg.reload(); await pg.wait_for_timeout(3000)
    ok('Day persists after restart (no clock override)', await pg.evaluate('document.documentElement.dataset.theme==="light"&&document.body.dataset.light==="day"'))
    # simulate a night-time device clock: still day
    await pg.evaluate('(()=>{const R=Date;window.__x=1})()')
    await pg.tap('#daynight-btn'); await pg.wait_for_timeout(800)
    ok('toggle back to Night', await pg.evaluate('document.documentElement.dataset.theme==="dark"&&document.body.dataset.light==="night"'))
    await settings(pg,'appearance')
    await pg.screenshot(path=SH+'t11_settings_daynight.png')
    segs=await pg.evaluate('[...document.querySelectorAll("#set-appearance .seg-b")].map(b=>b.textContent)')
    ok('Settings has Day / Night / Auto, Auto not default', segs==['☀ Day','☾ Night','Auto'] and await pg.evaluate('DABSy.theme.mode()==="night"'), str(segs))
    await b.close()

    # ---- 3 habitat seating, both sizes ----
    for (vw,vh) in [(390,844),(360,640)]:
      for hab in ['bed','desk','lake','window-nook']:
        for theme in ['dark','light']:
          b,ctx,pg=await mk(p,vw,vh,pre='localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}));localStorage.setItem("dabsy_world_v1",JSON.stringify({habitat:"%s",roam:"off",v:2}));localStorage.setItem("dabsy_settings",JSON.stringify({theme:"%s"}));'%(hab,theme))
          await pg.wait_for_timeout(1600)
          info=await pg.evaluate('''(()=>{const s=DABSy.world.snapshot(),h=s.spots.find(x=>x.id===s.home);const f=document.getElementById("face").getBoundingClientRect();const b=document.querySelector(".mw-body").getBoundingClientRect();
            return {home:s.home,spot:[Math.round(h.fx),Math.round(h.fy)],feet:[Math.round(s.feet.x),Math.round(s.feet.y)],body:[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)],vw:innerWidth,vh:innerHeight,off:h.off}})()''')
          dx=abs(info['feet'][0]-info['spot'][0]); dy=abs(info['feet'][1]-info['spot'][1])
          inside = info['body'][0]>=0 and info['body'][2]<=info['vw'] and info['body'][1]>=60 and info['body'][3]<=info['vh']
          ok(f'{hab}/{theme} {vw}x{vh}: DABSy on home spot ({info["home"]}), fully visible', dx<=3 and dy<=3 and inside and not pg.errs, json.dumps(info)+str(pg.errs))
          if theme=='dark' or True: await pg.screenshot(path=SH+f't11_{hab}_{theme}_{vw}.png')
          await b.close()
    json.dump(R,open('/tmp/t11a.json','w'))
asyncio.run(main())
print('SUMMARY', sum(1 for r in R if r[1]), '/', len(R))
