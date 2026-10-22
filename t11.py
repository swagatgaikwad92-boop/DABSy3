import asyncio, json
from playwright.async_api import async_playwright
res=[]
def chk(n,ok,d=''): res.append((n,ok)); print(('PASS' if ok else 'FAIL'),n,d)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(2500)
    chk('butler loaded',await pg.evaluate('!!(window.DABSy&&DABSy.butler)'))
    # seed tasks
    ids=await pg.evaluate('''()=>{const T=DABSy.tasks;const a=T.add({title:"Maths homework",dueAt:new Date(Date.now()+864e5).toISOString(),durationMin:60});const b=T.add({title:"Chemistry notes",dueAt:new Date(Date.now()+2*864e5).toISOString(),durationMin:45});return [a.id,b.id]}''')
    say=lambda t:pg.evaluate('async(t)=>{const r=await DABSy.butler.handle(t);return r&&{text:r.text,ch:!!(r.opts&&r.opts.choices),ac:!!(r.opts&&r.opts.actions)}}',t)
    r=await say('make maths homework high priority'); pr=await pg.evaluate('(id)=>DABSy.tasks.get(id).priority',ids[0]); chk('priority verified',pr=='high',str(r))
    r=await say('rename chemistry notes to organic revision'); chk('rename',await pg.evaluate('(id)=>DABSy.tasks.get(id).title',ids[1])=='organic revision',str(r))
    r=await say('delete organic revision'); chk('delete asks first',r and r['ch'] and await pg.evaluate('(id)=>!!DABSy.tasks.get(id)',ids[1]),str(r))
    r=await say('keep it'); chk('keep leaves it',await pg.evaluate('(id)=>!!DABSy.tasks.get(id)',ids[1]),str(r))
    await say('delete organic revision'); r=await say('delete it'); chk('confirmed delete verified',not await pg.evaluate('(id)=>!!DABSy.tasks.get(id)',ids[1]),str(r))
    r=await say('mark maths homework done'); chk('complete',await pg.evaluate('(id)=>DABSy.tasks.get(id).status',ids[0])=='done',str(r))
    r=await say('delete unicorn parade'); chk('unknown not invented','couldn' in r['text'],str(r))
    r=await say('move maths homework to friday 6 pm'); print(r)
    r=await say('how busy am I today'); chk('overview answers',bool(r and r['text']),str(r))
    chk('hello not hijacked',await say('hello how are you')==None)
    # reply card UI
    await pg.evaluate('DABSy.app.say("Short answer.","HAPPY",{actions:[{label:"Explain more",primary:true,onClick(){}}]})'); await pg.wait_for_timeout(600)
    chk('action button renders',await pg.evaluate('!!document.querySelector("#subtitle .sub-actions button")'))
    await pg.evaluate('DABSy.app.say("Pick one","CURIOUS",{choices:{mode:"single",options:["A","B"]}})'); await pg.wait_for_timeout(400)
    chk('choices render',await pg.evaluate('document.querySelectorAll("#subtitle .sub-choices button").length')==2)
    await pg.screenshot(path='/home/claude/shots/v11_choices.png')
    chk('no page errors',not errs,str(errs[:2]))
    await b.close()
asyncio.run(main())
print(sum(o for _,o in res),'/',len(res))
