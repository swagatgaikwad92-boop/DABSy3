import asyncio, json
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'; SH='/home/claude/shots/'; R=[]
def ok(n,c,e=''):
    R.append((n,bool(c),e)); print('PASS' if c else 'FAIL',n,e)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':360,'height':640},device_scale_factor=2,has_touch=True,is_mobile=True)
    pg=await ctx.new_page(); pg.errs=[]; pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(5200)
    ok('first launch: tutorial offer appears', await pg.evaluate('!!document.querySelector("#popup-layer.on")&&/tour/i.test(document.querySelector("#popup-layer").textContent)'))
    await pg.evaluate('document.querySelector("#popup-layer.on .btn.primary").click()'); await pg.wait_for_timeout(600)
    titles=[]
    for i in range(30):
        t=await pg.evaluate('(()=>{const h=document.querySelector("#tour h2");return h&&h.textContent})()')
        if not t: break
        titles.append(t)
        if i in (9,10,13,15): await pg.screenshot(path=SH+f't14_step{i}.png')
        fits=await pg.evaluate('(()=>{const c=document.querySelector(".tour-card").getBoundingClientRect();return c.top>=0&&c.bottom<=innerHeight})()')
        if not fits: ok('tour card fits 360x640: '+t, False)
        last=await pg.evaluate('(()=>{const b=document.querySelector("#tour .btn.primary");const l=b.textContent==="Done";b.click();return l})()')
        await pg.wait_for_timeout(120)
        if last: break
    need=['Choose a wallpaper','Back to the black screen','Day or Night','Where I sit','Add a glass widget','Make a widget yours','The double-tap glow','Study Mode, simplified','Typing with the keyboard']
    ok('tour covers all 9 new topics', all(n in titles for n in need), str(len(titles))+' steps')
    st=await pg.evaluate('JSON.parse(localStorage.getItem("dabsy_onboarding_v1"))'); ok('completion remembered', st.get('tutorialCompleted'), json.dumps(st))
    await pg.reload(); await pg.wait_for_timeout(5200)
    ok('not shown again after reload', await pg.evaluate('!document.querySelector("#tour")&&!/tour/i.test(document.querySelector("#popup-layer")?document.querySelector("#popup-layer").textContent:"")'))
    # replay does not reset prefs
    await pg.evaluate('DABSy.theme.setMode("day");DABSy.outfits.setForm("magic");DABSy.world.setHabitat("lake")'); await pg.wait_for_timeout(1200)
    before=await pg.evaluate('JSON.stringify([DABSy.theme.mode(),DABSy.outfits.form(),DABSy.world.habitatId()])')
    await pg.evaluate('DABSy.require("settings").then(s=>s.open("help"))'); await pg.wait_for_timeout(900)
    await pg.evaluate('[...document.querySelectorAll("#set-help .btn")].find(b=>b.textContent==="Replay").click()'); await pg.wait_for_timeout(1200)
    ok('Settings → Help & Tutorial → Replay opens the tour', await pg.evaluate('!!document.querySelector("#tour")'))
    await pg.evaluate('(()=>{const s=document.querySelector("#tour .btn.ghost");s.click()})()'); await pg.wait_for_timeout(600)
    after=await pg.evaluate('JSON.stringify([DABSy.theme.mode(),DABSy.outfits.form(),DABSy.world.habitatId()])')
    ok('replay + skip leaves preferences untouched', before==after, before+' / '+after)
    ok('no page errors', not pg.errs, str(pg.errs)); await b.close()
asyncio.run(main()); print('SUMMARY',sum(r[1] for r in R),'/',len(R))
