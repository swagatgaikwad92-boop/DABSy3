import asyncio, json, time
from playwright.async_api import async_playwright
R={}
def rec(k,ok,info=''): R[k]=('PASS' if ok else 'FAIL',info); print(('PASS ' if ok else 'FAIL ')+k, info)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    ctx=await b.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
    await ctx.add_init_script('''if(location.pathname.endsWith("index.html")||location.pathname=="/"){localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_core_connections_v1",JSON.stringify({calendar:{enabled:true,level:"automatic"}}))}''')
    A=await ctx.new_page(); await A.goto('http://localhost:8090/index.html'); await A.wait_for_timeout(3000)
    say=lambda t: A.evaluate('(t)=>DABSy.app.handleUserUtterance(t)',t)
    ev=lambda pg=A: pg.evaluate('(JSON.parse(localStorage.getItem("ghibliforest_v1")||"{}").events||[]).map(e=>({id:e.id,t:e.title,d:e.date,c:e.category,s:e.startTime,n:e.notes}))')
    sub=lambda: A.evaluate('document.getElementById("subtitle").textContent')
    # TEST 1
    await say("I have a physics test tomorrow."); await A.wait_for_timeout(3000)
    e=await ev(); print(e, '|', await sub())
    rec('T1 physics test: category+date+saved', len(e)==1 and e[0]['c']=='important' and e[0]['t']=='Physics test', json.dumps(e))
    import datetime; tom=(datetime.date.today()+datetime.timedelta(days=1)).isoformat()
    rec('T1 date = tomorrow in local tz', e and e[0]['d']==tom, f"{e[0]['d'] if e else None} vs {tom}")
    # TEST 2
    await say("Remind me to finish maths homework tonight."); await A.wait_for_timeout(3000)
    e=await ev(); print(e,'|',await sub())
    h=[x for x in e if x['c']=='homework']
    rec('T2 homework recognised+saved', len(h)==1 and h[0]['d']==datetime.date.today().isoformat() and h[0]['s'] is None, json.dumps(h))
    # time-based personal reminder
    await say("Remind me to call my friend at 6 PM."); await A.wait_for_timeout(2500)
    e=await ev(); print(e,'|',await sub()); print(len(e))
    # TEST 7 duplicate
    n0=len(await ev())
    await say("I have a physics test tomorrow."); await A.wait_for_timeout(2500)
    e=await ev(); rec('T7 repeating the same sentence adds no duplicate', len(e)==n0, f"{n0}->{len(e)} | {await sub()}")
    r=await A.evaluate('(()=>{const a=DABSyCore.saveEvent({title:"Physics test",date:"%s",category:"important"}),b=DABSyCore.saveEvent({title:"physics TEST",date:"%s",category:"important"});return [a.created,b.created,b.duplicate]})()'%(tom,tom))
    rec('T7 saveEvent retry returns duplicate', r==[False,False,True], str(r))
    # clarification
    await say("I have a meeting on Wednesday"); await A.wait_for_timeout(1500); print(await sub())
    # TEST 3: Ghibli open already
    B=await ctx.new_page(); await B.goto('http://localhost:8090/tests/ghibli-standin.html'); await B.wait_for_timeout(800)
    pre=await B.evaluate('document.querySelectorAll("li").length')
    await A.bring_to_front()
    t0=time.time(); await say("My college event is on Friday."); 
    ok=False
    for i in range(60):
        n=await B.evaluate('document.querySelectorAll("li").length')
        if n==pre+1: ok=True; break
        await B.wait_for_timeout(50)
    dt=time.time()-t0
    await A.wait_for_timeout(2800)
    msg=await sub()
    rec('T3 open Ghibli updates without reload', ok, f"{dt*1000:.0f}ms incl. DABSy parse; subtitle={msg!r}")
    rec('T3 DABSy told the user it is showing (ack)', 'showing in Ghibli Calendar now' in msg, msg)
    # TEST 4 open afterwards
    C=await ctx.new_page(); await C.goto('http://localhost:8090/tests/ghibli-standin.html'); await C.wait_for_timeout(500)
    li=await C.evaluate('[...document.querySelectorAll("li")].map(x=>x.textContent)'); print(li)
    rec('T4 Ghibli opened afterwards contains all entries', any('College event' in x for x in li) and any('Physics test' in x for x in li) and any('maths homework' in x for x in li), str(li))
    # stale-tab + Ghibli save must not wipe DABSy entry
    await B.evaluate('LF.addEvent({title:"Ghibli own",date:"2026-10-20",category:"personal",startTime:null,endTime:null,notes:""})')
    e=await ev(); rec('Ghibli save keeps DABSy entries', any(x['t']=='College event' for x in e) and any(x['t']=='Ghibli own' for x in e), str(len(e)))
    # frozen tab path
    cdp=await ctx.new_cdp_session(B)
    await B.evaluate('window.__n=document.querySelectorAll("li").length')
    await cdp.send('Page.enable')
    try:
        await cdp.send('Page.setWebLifecycleState',{'state':'frozen'})
        frozen=True
    except Exception as ex: frozen=False; print('freeze unsupported',ex)
    await A.bring_to_front(); await say("I have to submit my practical journal next Monday."); await A.wait_for_timeout(1500)
    await cdp.send('Page.setWebLifecycleState',{'state':'active'}); 
    await B.evaluate('document.dispatchEvent(new Event("visibilitychange"))'); await B.wait_for_timeout(400)
    li=await B.evaluate('[...document.querySelectorAll("li")].map(x=>x.textContent)')
    rec('Frozen->resumed Ghibli shows new entry', any('practical journal' in x.lower() for x in li), f"frozen_api={frozen} {li[-2:]}")
    # delete sync
    ids=await A.evaluate('DABSyCore.getCalendarEvents().find(e=>/College event/.test(e.title)).id')
    await A.evaluate('(i)=>DABSyCore.deleteCalendarEvent(i)',ids); await B.wait_for_timeout(500)
    li=await B.evaluate('[...document.querySelectorAll("li")].map(x=>x.textContent)')
    rec('Delete in DABSy removes it in open Ghibli', not any('College event' in x for x in li), str(len(li)))
    # TEST 8 failure
    await A.evaluate('''window.__orig=Storage.prototype.setItem;window.__ls=localStorage;Storage.prototype.setItem=function(k,v){if(k==="ghibliforest_v1"){const e=new Error("full");e.name="QuotaExceededError";throw e}return window.__orig.call(window.__ls,k,v)}''')
    n0=len(await ev()); await say("I have a chemistry test on 30 oct"); await A.wait_for_timeout(2500)
    m=await sub(); e=await ev()
    rec('T8 failed save reported honestly, nothing saved', len(e)==n0 and ("couldn't save" in m.lower()) and 'full' in m.lower(), m)
    await A.evaluate('(()=>{Storage.prototype.setItem=window.__orig;return 1})()')
    await say("I have a chemistry test on 30 oct"); await A.wait_for_timeout(2500)
    e=await ev(); rec('T8 recovers after storage returns', len(e)==n0+1 and e[-1]['d'].endswith('10-30'), await sub())
    json.dump(R,open('/home/claude/shots/t3.json','w'),indent=1)
    await b.close()
asyncio.run(main())
