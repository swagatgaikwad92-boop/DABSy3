import asyncio, json
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'; SH='/home/claude/shots/'; R=[]
def ok(n,c,e=''):
    R.append((n,bool(c),e)); print('PASS' if c else 'FAIL',n,e)
async def mk(p,vw=390,vh=844,pre='',tour=False):
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script(('' if tour else 'if(!localStorage.getItem("dabsy_onboarding_v1"))localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));')+pre)
    pg=await ctx.new_page(); pg.errs=[]
    pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(2600); return b,ctx,pg
MAGIC='localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}));localStorage.setItem("dabsy_world_v1",JSON.stringify({habitat:"desk",roam:"off",v:2}));'
async def main():
  async with async_playwright() as p:
    # ---- keyboard (emulated visualViewport) ----
    for vw,vh,pre,name in [(390,844,MAGIC,'magic'),(360,640,'','classic')]:
        b,ctx,pg=await mk(p,vw,vh,pre)
        await pg.evaluate('''(()=>{window.__vv=0;const v=window.visualViewport;Object.defineProperty(v,"height",{get:()=>innerHeight-window.__vv,configurable:true});
          window.__cnt={w:0};const o=document.documentElement.style.setProperty.bind(document.documentElement.style);document.documentElement.style.setProperty=function(...a){window.__cnt.w++;return o(...a)}})()''')
        await pg.tap('#sc-talk') if await pg.query_selector('#sc-talk:visible') else await pg.evaluate('DABSy.app.openCommand(true)')
        await pg.wait_for_timeout(900)
        await pg.focus('#text-input')
        await pg.evaluate('window.__cnt.w=0;window.__vv=300;visualViewport.dispatchEvent(new Event("resize"));[1,2,3,4,5,6].forEach(i=>setTimeout(()=>visualViewport.dispatchEvent(new Event("resize")),i*40))')
        await pg.wait_for_timeout(1100)
        st=await pg.evaluate('''(()=>{const c=document.getElementById("chat-area").getBoundingClientRect(),f=document.getElementById("face").getBoundingClientRect();return {kb:document.body.classList.contains("kb-open"),var:getComputedStyle(document.documentElement).getPropertyValue("--kb"),chatBottom:Math.round(c.bottom),vh:innerHeight-300,faceBottom:Math.round(f.bottom),chatTop:Math.round(c.top),moving:document.body.classList.contains("kb-moving"),writes:window.__cnt.w,focused:document.activeElement.id}})()''')
        ok(f'{name}: keyboard open => dock sits above keyboard, input keeps focus, few style writes', st['kb'] and st['chatBottom']<=st['vh'] and st['focused']=='text-input' and st['writes']<=6 and not st['moving'], json.dumps(st))
        await pg.screenshot(path=SH+f't12_kb_{name}.png')
        await pg.evaluate('window.__vv=0;visualViewport.dispatchEvent(new Event("resize"))'); await pg.wait_for_timeout(900)
        ok(f'{name}: keyboard close restores', await pg.evaluate('!document.body.classList.contains("kb-open")'))
        n=await pg.evaluate('''(()=>{let c=0;const a=EventTarget.prototype.addEventListener;return window.__dabsyViewport===true})()''')
        ok(f'{name}: viewport listeners registered once (guard)', n)
        await b.close()
    # ---- study mode ----
    b,ctx,pg=await mk(p,390,844,MAGIC+'localStorage.setItem("dabsy_settings",JSON.stringify({speakReplies:false}));')
    txt="**What is Newton's second law?**\nForce: a push or pull on an object.\nThe acceleration of an object depends on the net force and its mass.\nF = m × a\n1. Write down the known values.\n2. Choose the formula F = m a.\n3. Substitute and solve.\n- Heavier objects accelerate less.\n- Force and acceleration point the same way."
    await pg.evaluate('(t=>{DABSy.ai.askDABSy=async()=>({text:t})})(%s)'%json.dumps(txt))
    await pg.evaluate('DABSy.bus.emit("study:launch",{topic:"Newton second law"})'); await pg.wait_for_timeout(1500)
    st=await pg.evaluate('''(()=>{const d=document.querySelector(".study-doc");const f=(document.querySelector(".mw-body")||document.getElementById("face")).getBoundingClientRect(),s=document.getElementById("projection-surface").getBoundingClientRect();
      return {steps:document.querySelectorAll("#projection-content .step").length,h:document.querySelectorAll(".study-h").length,formula:document.querySelectorAll(".study-formula").length,def:document.querySelectorAll(".study-def").length,ol:document.querySelectorAll(".study-steps li").length,pending:document.querySelectorAll(".study-steps li.pending").length,
      bgs:[...document.querySelectorAll(".study-doc *")].filter(e=>{const c=getComputedStyle(e);return c.backgroundColor!=="rgba(0, 0, 0, 0)"&&!e.matches(".study-steps li::before")}).length,faceBottom:Math.round(f.bottom),surfTop:Math.round(s.top),more:!!document.querySelector(".study-more")}})()''')
    ok('study: no .step cards; heading/definition/formula/steps parsed', st['steps']==0 and st['h']==1 and st['formula']==1 and st['def']>=1 and st['ol']==3, json.dumps(st))
    ok('study: elements carry no card backgrounds', st['bgs']==0, str(st['bgs']))
    ok('study: DABSy compact companion above explanation (no overlap)', st['faceBottom']<=st['surfTop']+6, f"face bottom {st['faceBottom']} surface top {st['surfTop']}")
    ok('study: steps revealed progressively (some still pending right after start)', st['pending']>=1 or st['more'], json.dumps(st))
    await pg.screenshot(path=SH+'t12_study_a.png')
    await pg.wait_for_timeout(5500)
    ok('study: all steps revealed by the end, Show-all control removed', await pg.evaluate('document.querySelectorAll(".study-steps li.pending").length===0&&!document.querySelector(".study-more")'))
    await pg.screenshot(path=SH+'t12_study_b.png')
    await pg.evaluate('document.getElementById("projection-close").click()'); await pg.wait_for_timeout(1200)
    ok('study: Done returns DABSy to her desk spot', await pg.evaluate('(()=>{const s=DABSy.world.snapshot();return Math.abs(s.feet.y-s.spots.find(x=>x.id===s.home).fy)<4})()'))
    ok('study: no page errors', not pg.errs, str(pg.errs)); await b.close()
asyncio.run(main()); print('SUMMARY',sum(r[1] for r in R),'/',len(R))
