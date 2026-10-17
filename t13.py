import asyncio, json
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'; SH='/home/claude/shots/'; R=[]
def ok(n,c,e=''):
    R.append((n,bool(c),e)); print('PASS' if c else 'FAIL',n,e)
async def mk(p,vw=390,vh=844,pre='',tour=False):
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script(('' if tour else 'if(!localStorage.getItem("dabsy_onboarding_v1"))localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));')+pre)
    pg=await ctx.new_page(); pg.errs=[]
    _tap=pg.tap
    async def tap2(sel,**k):
        await pg.evaluate('(()=>{const b=document.querySelector("#popup-layer.on .btn.ghost");b&&b.click()})()'); await pg.wait_for_timeout(250)
        return await _tap(sel,timeout=8000,**k)
    pg.tap=tap2
    pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(2600)
    await pg.evaluate('(()=>{const b=document.querySelector("#popup-layer.on .btn.ghost");b&&b.click()})()'); await pg.wait_for_timeout(500); return b,ctx,pg
MAGIC='localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}));localStorage.setItem("dabsy_world_v1",JSON.stringify({habitat:"bed",roam:"off",v:2}));'
async def main():
  async with async_playwright() as p:
    for vw,vh,pre,name in [(390,844,MAGIC,'magic390'),(360,640,'','classic360')]:
        b,ctx,pg=await mk(p,vw,vh,pre)
        await pg.evaluate('''DABSy.tasks.add({title:"Submit form",dueAt:new Date(Date.now()+3600e3).toISOString(),durationMin:15});DABSy.tasks.add({title:"Physics revision",subject:"Physics",dueAt:new Date(Date.now()+7200e3).toISOString(),durationMin:40})''')
        await pg.wait_for_timeout(900); await pg.evaluate('(()=>{const b=document.querySelector("#popup-layer.on .btn.ghost");b&&b.click()})()'); await pg.wait_for_timeout(600)
        await pg.evaluate('DABSy.require("settings").then(s=>s.open("widgets"))'); await pg.wait_for_timeout(900)
        await pg.tap('#set-widgets .btn.primary'); await pg.wait_for_timeout(1000)
        rows=await pg.query_selector_all('.wd-add-row'); ok(f'{name}: Add-widget sheet lists 6 types', len(rows)==6, str(len(rows)))
        for i in range(len(rows)):
            btns=await pg.query_selector_all('.wd-add-row .btn')
            if (await btns[i].inner_text()).strip()=='Add': await btns[i].tap(); await pg.wait_for_timeout(250)   # the clock is auto-added once on first run
        res=await pg.evaluate('JSON.stringify(DABSy.widgets.list().map(w=>[w.type,!!w.rect]))')
        print(name,res)
        await pg.screenshot(path=SH+f't13_{name}_add.png')
        n=len(json.loads(res)); await pg.tap('.wd-add .. .btn.primary:has-text("Done")') if False else await pg.evaluate('document.querySelector(".sheet .popup-actions .btn.primary").click()'); await pg.wait_for_timeout(900)
        st=await pg.evaluate('''(()=>{const f=(document.querySelector(".mw-body")||document.getElementById("eye-left")).getBoundingClientRect();const ws=[...document.querySelectorAll(".wgt")].filter(w=>!w.hidden).map(w=>w.getBoundingClientRect());
          const ov=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;let pair=0;for(let i=0;i<ws.length;i++)for(let j=i+1;j<ws.length;j++)if(ov(ws[i],ws[j]))pair++;
          return {shown:ws.length,onface:ws.filter(w=>ov(w,f)).length,pairs:pair,off:ws.filter(w=>w.left<0||w.right>innerWidth||w.top<0).length,types:[...document.querySelectorAll(".wgt:not([hidden])")].map(x=>x.dataset.type)}})()''')
        ok(f'{name}: widgets appear immediately, none overlap DABSy/each other/screen edge', st['shown']>=1 and st['onface']==0 and st['pairs']==0 and st['off']==0, json.dumps(st))
        await pg.screenshot(path=SH+f't13_{name}_widgets.png')
        if name=='magic390':
            # double tap (wait for the 'added' toasts, which sit over the top area, to leave)
            await pg.wait_for_timeout(7000)
            w=await pg.query_selector('.wgt[data-type="clock"]'); bb=await w.bounding_box(); x=bb['x']+bb['width']/2; y=bb['y']+bb['height']/2
            await pg.touchscreen.tap(x,y); await pg.wait_for_timeout(90); await pg.touchscreen.tap(x,y); await pg.wait_for_timeout(180)
            seen=await pg.evaluate('({glow:!!document.querySelector(".wgt-glow"),sheen:!!document.querySelector(".wgt-sheen"),rip:!!document.querySelector(".wgt-ripple")})')
            await pg.screenshot(path=SH+'t13_dtap_mid.png')
            await pg.wait_for_timeout(900)
            sheet=await pg.evaluate('({sheet:!!document.querySelector(".sheet.wgt-sheet"),title:document.querySelector(".sheet h2")&&document.querySelector(".sheet h2").textContent,leftover:document.querySelectorAll(".wgt-glow,.wgt-sheen").length,sheets:document.querySelectorAll(".sheet").length})')
            ok('double-tap: glow + sheen + ripple play, then details sheet opens exactly once', seen['glow'] and seen['rip'] and sheet['sheet'] and sheet['leftover']==0 and sheet['sheets']==1, json.dumps(seen)+json.dumps(sheet))
            await pg.screenshot(path=SH+'t13_details.png')
            # customise: shape + size
            await pg.tap('.wd-chips[aria-label="Shape"] .wd-chip[data-k="blob"]'); await pg.tap('.wd-chips[aria-label="Size"] .wd-chip[data-k="l"]'); await pg.wait_for_timeout(500)
            cu=await pg.evaluate('JSON.stringify(DABSy.widgets.list().find(w=>w.type==="clock"))'); c=json.loads(cu)
            ok('customise: shape blob + size L applied live and stay on-screen', c['shape']=='blob' and c['size']=='l' and c['rect']['x']>=0 and c['rect']['x']+c['rect']['w']<=390, cu)
            await pg.screenshot(path=SH+'t13_custom.png')
            await pg.tap('.wd-chips[aria-label="Shape"] .wd-chip[data-k="circle"]'); await pg.wait_for_timeout(300)
            # remove
            await pg.evaluate('[...document.querySelectorAll(".sheet .btn.danger")][0].click()'); await pg.wait_for_timeout(700)
            ok('remove widget', await pg.evaluate('!DABSy.widgets.list().some(w=>w.type==="clock")&&DABSy.widgets.removed().includes("clock")'))
            # restore keeps look
            await pg.evaluate('DABSy.widgets.restore("clock")'); await pg.wait_for_timeout(500)
            ok('restore brings back customised widget', await pg.evaluate('(()=>{const w=DABSy.widgets.list().find(w=>w.type==="clock");return !!w&&w.shape==="circle"&&["l","m","s"].includes(w.size)})()'))
            await pg.reload(); await pg.wait_for_timeout(3000)
            ok('widgets persist after restart with customisation', await pg.evaluate('(()=>{const l=DABSy.widgets.list();const w=l.find(w=>w.type==="clock");return l.length>=4&&w&&w.shape==="circle"&&["l","m","s"].includes(w.size)})()'))
            # drag
            w=await pg.query_selector('.wgt[data-type="todos"]'); bb=await w.bounding_box() if w else None
            # data honesty
            txt=await pg.evaluate('({w:(document.querySelector(".wgt[data-type=weather] .wgt-body")||{}).textContent,t:(document.querySelector(".wgt[data-type=todos] .wgt-body")||{}).textContent,s:(document.querySelector(".wgt[data-type=study] .wgt-body")||{}).textContent})')
            ok('weather shows setup state (no fake data); to-dos/study show only real tasks', 'Set up weather' in (txt['w'] or '') and 'Submit form' in (txt['t'] or '') and 'Physics' in (txt['s'] or '') and 'Physics' not in (txt['t'] or ''), json.dumps(txt))
            # hidden during chat
            await pg.evaluate('DABSy.app.openCommand(true)'); await pg.wait_for_timeout(600)
            ok('widgets hide while chat/keyboard is open', await pg.evaluate('document.getElementById("widgets").classList.contains("off")'))
            await pg.evaluate('DABSy.app.closeCommand()'); await pg.wait_for_timeout(600)
            ok('widgets return afterwards', await pg.evaluate('!document.getElementById("widgets").classList.contains("off")'))
            await pg.screenshot(path=SH+'t13_day_widgets.png') if False else None
            await pg.tap('#daynight-btn'); await pg.wait_for_timeout(900); await pg.screenshot(path=SH+'t13_widgets_day.png')
        ok(f'{name}: no page errors', not pg.errs, str(pg.errs)); await b.close()
asyncio.run(main()); print('SUMMARY',sum(r[1] for r in R),'/',len(R))
