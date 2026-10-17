import asyncio, json, time, urllib.request, subprocess, sys, os
from playwright.async_api import async_playwright
BASE='http://localhost:8090/'; MOCK='http://localhost:8787'; SH='/home/claude/shots/'; R=[]
def ok(n,c,e=''):
    R.append((n,bool(c),e)); print('PASS' if c else 'FAIL',n,e)
def setm(**k):
    urllib.request.urlopen(urllib.request.Request(MOCK+'/__set',data=json.dumps(k).encode(),method='POST')).read()
def stats(): return json.load(urllib.request.urlopen(MOCK+'/__stats'))
async def mk(p, mode='message'):
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_notif_asked","1");')
    pg=await ctx.new_page(); pg.errs=[]; pg.on('pageerror',lambda e:pg.errs.append(str(e)))
    await pg.goto(BASE+'index.html'); await pg.wait_for_timeout(2300)
    await pg.evaluate('(m)=>{DABSy.config.ai.proxyUrl="http://localhost:8787";DABSy.config.ai.mode=m}',mode)
    await pg.evaluate('(()=>{const b=document.querySelector("#popup-layer.on .btn.ghost");b&&b.click()})()')
    return b,pg
async def send(pg, text):
    await pg.evaluate('DABSy.app.openCommand(true)'); await pg.wait_for_timeout(500)
    await pg.evaluate('document.getElementById("text-input").value=%s'%json.dumps(text))
    t0=time.time(); await pg.evaluate('document.getElementById("text-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))')
    return t0
async def subtitle_timeline(pg, t0, timeout=9):
    first=None; final=None; last=''
    while time.time()-t0<timeout:
        s=await pg.evaluate('(()=>{const e=document.getElementById("subtitle");return e.classList.contains("visible")?e.textContent:""})()')
        if s and s!=last:
            if first is None and 'Owls' in s: first=(time.time()-t0, s)
            last=s
            if s.rstrip().endswith('bodies.'): final=(time.time()-t0,s); break
        await asyncio.sleep(0.03)
    return first, final, last
PART=os.environ.get('PART','ABC')
async def main():
  async with async_playwright() as p:
    for mode in (['message','proxy'] if 'A' in PART else []):
        # ---- streaming vs non-streaming, same simulated Gemini timing ----
        for legacy in [False, True]:
            setm(scenario='ok', legacy=legacy, first=900, chunk=220)
            b,pg=await mk(p, mode)
            t0=await send(pg,'tell me something amazing about owls')
            first,final,last=await subtitle_timeline(pg,t0)
            label=('NON-streaming (old Worker)' if legacy else 'STREAMING')+f' [{mode}]'
            print(f'   {label}: first visible text at {first[0]:.2f}s, complete at {final[0]:.2f}s' if first and final else f'   {label}: {first} {final} {last}')
            if not legacy:
                ok(f'{mode}: streaming shows partial text BEFORE the answer is complete', first and final and first[0] < final[0]-0.6 and not first[1].rstrip().endswith('bodies.'), f'first={first and round(first[0],2)} final={final and round(final[0],2)}')
                ok(f'{mode}: final streamed text is complete, correct Unicode/spacing', final and final[1].startswith('Owls can rotate their heads about 270 degrees'), final and final[1][:80])
                st=stats(); ok(f'{mode}: ONE browser request and ONE upstream request for one message', len(st['browser'])==1 and len(st['upstream'])==1, json.dumps([len(st['browser']),len(st['upstream'])]))
            else:
                ok(f'{mode}: old (non-streaming) Worker still works via automatic fallback', final is not None, str(final and round(final[0],2)))
            ok(f'{mode}: no page errors', not pg.errs, str(pg.errs)); await b.close()
    # ---- errors, message mode ----
    b,pg=await mk(p,'message')
    for scen,expect in ([] if 'B' not in PART else [('quota','allowance'),('503-always','hiccup'),('429-short','Owls')]):
        setm(scenario=scen, legacy=False, first=200, chunk=80)
        t0=await send(pg,'tell me something amazing about owls'); await asyncio.sleep(0.2)
        deadline=time.time()+9; txt=''
        while time.time()<deadline:
            txt=await pg.evaluate('document.getElementById("subtitle").textContent')
            if txt and txt!='' and not txt.startswith('Good'): 
                if expect is None or expect in txt: break
            await asyncio.sleep(0.15)
        st=stats()
        if scen=='quota': ok('quota: friendly specific message (not "overloaded"), 1 upstream call (no retry)', 'allowance' in txt and 'overloaded' not in txt and len(st['upstream'])==1, txt[:90]+' | upstream=%d'%len(st['upstream']))
        if scen=='503-always': ok('persistent 503: "hiccup" message, bounded to 2 upstream calls, 1 browser request', 'hiccup' in txt and len(st['upstream'])==2 and len(st['browser'])==1, txt[:90]+' | upstream=%d browser=%d'%(len(st['upstream']),len(st['browser'])))
        if scen=='429-short': ok('429 + Retry-After:1: Worker waits, retries once, user gets the real answer', 'Owls' in txt and len(st['upstream'])==2, txt[:60]+' | upstream=%d'%len(st['upstream']))
        await pg.evaluate('DABSy.app.closeCommand&&DABSy.app.closeCommand()'); await pg.wait_for_timeout(400)
    await b.close()
    if 'B' in PART:
     pass
    if 'B' in PART:
        # ---- duplicate submit + retry cannot duplicate a task ----
        setm(scenario='503-once', legacy=False, first=300, chunk=100)
        b,pg=await mk(p,'message')
        before=await pg.evaluate('DABSy.tasks.list().length')
        t0=await send(pg,'I should pick up my laundry sometime')
        await pg.evaluate('document.getElementById("text-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))')   # a second Enter while busy
        await pg.wait_for_timeout(5500)
        after=await pg.evaluate('DABSy.tasks.list().filter(t=>/laundry/i.test(t.title)).length')
        st=stats()
        ok('transient 503 + double Enter: exactly ONE task created, 1 browser request, 2 upstream (1 retry)', after==1 and len(st['browser'])==1 and len(st['upstream'])==2, f'tasks={after} browser={len(st["browser"])} upstream={len(st["upstream"])}')
        await b.close()
        # ---- study mode streaming into the doc ----
        setm(scenario='ok', legacy=False, first=700, chunk=250)
        b,pg=await mk(p,'message')
        await pg.evaluate('DABSy.memory.saveSettings({speakReplies:false})')
        t0=time.time(); await pg.evaluate('DABSy.bus.emit("study:launch",{topic:"Newton second law"})')
        seen=None; done=None
        while time.time()-t0<10:
            n=await pg.evaluate('({d:!!document.querySelector(".study-doc"),h:!!document.querySelector(".study-h"),steps:document.querySelectorAll(".study-steps li").length,stream:document.getElementById("projection-content").classList.contains("streaming")})')
            if n['d'] and n['stream'] and seen is None: seen=time.time()-t0
            if n['d'] and not n['stream'] and done is None and seen: done=time.time()-t0; break
            await asyncio.sleep(0.05)
        ok('study: document appears while the answer is still streaming, then finalises', seen is not None and done is not None and seen < done-0.5, f'first draw {seen and round(seen,2)}s, final {done and round(done,2)}s')
        await pg.screenshot(path=SH+'t15_study.png'); await b.close()
    if 'C' in PART:
        # ---- long conversation: prompt size stays bounded ----
        setm(scenario='ok', legacy=False, first=100, chunk=30)
        b,pg=await mk(p,'message'); lens=[]
        for i in range(7):
            await send(pg,'tell me more about owls fact number %d with some extra words to make this message a bit longer than usual '%i*1)
            await pg.wait_for_timeout(1800)
        st=stats(); lens=[x['len'] for x in st['browser']]
        ok('long conversation: request size stops growing (bounded history)', len(lens)>=6 and max(lens[3:])<=lens[3]+400 and max(lens)<3200, str(lens))
        await b.close()
    if 'C' in PART:
        # ---- keyboard: moves immediately on focus (before any viewport resize) ----
        b,pg=await mk(p,'message')
        await pg.evaluate('DABSy.app.openCommand(true)'); await pg.wait_for_timeout(700)
        r=await pg.evaluate('''(async()=>{const i=document.getElementById("text-input");const t0=performance.now();i.focus();
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const c=document.getElementById("chat-area");return {ms:Math.round(performance.now()-t0),kbs:getComputedStyle(document.documentElement).getPropertyValue("--kbs"),kbopen:document.body.classList.contains("kb-open"),tr:getComputedStyle(c).transform,predicted:true}})()''')
        ok('keyboard: dock starts rising within 2 frames of focus (predicted height, no resize event yet)', r['kbopen'] and r['kbs'].strip() not in ('','0px'), json.dumps(r))
        await pg.wait_for_timeout(1100)
        ok('keyboard: prediction withdrawn after 0.7s if no keyboard actually appears', await pg.evaluate('!document.body.classList.contains("kb-open")'))
        await pg.evaluate('(()=>{window.__vv=300;Object.defineProperty(visualViewport,"height",{get:()=>innerHeight-window.__vv,configurable:true})})()')
        await pg.evaluate('document.getElementById("text-input").blur();document.getElementById("text-input").focus()'); await pg.wait_for_timeout(100)
        await pg.evaluate('visualViewport.dispatchEvent(new Event("resize"))'); await pg.wait_for_timeout(700)
        s=await pg.evaluate('({kb:getComputedStyle(document.documentElement).getPropertyValue("--kb"),kbs:getComputedStyle(document.documentElement).getPropertyValue("--kbs"),learned:localStorage.getItem("dabsy_kbh"),chatBottom:Math.round(document.getElementById("chat-area").getBoundingClientRect().bottom),vh:innerHeight})')
        ok('keyboard: real height replaces the prediction, is remembered, dock sits just above keyboard', s['kb']=='300px' and s['learned']=='300' and abs(s['chatBottom']-(s['vh']-300-8))<=3, json.dumps(s))
        await pg.screenshot(path=SH+'t15_kb.png'); await b.close()
asyncio.run(main()); print('SUMMARY',sum(r[1] for r in R),'/',len(R))
