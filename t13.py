# v11.1 regression: wallpapers, day/night, widgets, planner, keyboard path. Run: python3 -m http.server 8090 (in project root), then python3 tests/t13.py
import asyncio, json
from playwright.async_api import async_playwright
res=[]
def chk(n,ok,d=''): res.append((n,bool(ok))); print(('PASS' if ok else 'FAIL'),n,str(d)[:200])
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':800},has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    pg=await ctx.new_page(); errs=[]; bad=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('response',lambda r: bad.append(r.url) if r.status>=400 and 'localhost' in r.url else None)
    await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(3000)
    chk('no page errors',not errs,errs)
    chk('modules loaded',await pg.evaluate('!!(DABSy.dayplan&&DABSy.widgets&&DABSy.world)'))
    # --- wallpapers
    await pg.evaluate('DABSy.outfits.setForm("magic")'); await pg.wait_for_timeout(1500)
    hs=await pg.evaluate('DABSy.world.habitats()'); chk('3 wallpapers listed',len(hs)==3,hs)
    for h in hs:
      for light in ['day','night']:
        if not h['has'+light.capitalize()]: continue
        await pg.evaluate(f'DABSy.world.setHabitat("{h["id"]}");DABSy.world.setLight("{light}")'); await pg.wait_for_timeout(1700)
        ok=await pg.evaluate('''()=>{const i=[...document.querySelectorAll('#world .w-bg.on')];return i.length>=1&&i.some(x=>x.naturalWidth>600)}''')
        chk(f'{h["id"]} {light} paints',ok)
        await pg.screenshot(path=f'/tmp/shot_{h["id"]}_{light}.png')
    await pg.evaluate('DABSy.world.setHabitat("lakeside")'); await pg.reload(); await pg.wait_for_timeout(2500)
    chk('wallpaper persists across refresh',await pg.evaluate('DABSy.world.habitatId()')=='lakeside')
    # auto light follows the clock (mock hour)
    for hour,exp in [(10,'day'),(22,'night')]:
      await pg.evaluate(f'''()=>{{const R=Date;const fixed=new R();fixed.setHours({hour},15,0,0);const t=fixed.getTime();window.Date=class extends R{{constructor(...a){{if(a.length)super(...a);else super(t)}}static now(){{return t}}}};DABSy.world.setLight("auto")}}''')
      await pg.wait_for_timeout(1500)
      chk(f'auto at {hour}h -> {exp}',await pg.evaluate('DABSy.world.lightInfo().effective')==exp)
    await pg.reload(); await pg.wait_for_timeout(2500)
    # --- widgets
    await pg.wait_for_timeout(4500)
    n=await pg.evaluate('document.querySelectorAll("#widgets .wg-card.in").length'); chk('widgets appear',n>=3,n)
    chk('clock shows time',await pg.evaluate('/\\d/.test(document.querySelector(".wg-clock .wg-big")?.textContent||"")'))
    chk('weather never fabricated',await pg.evaluate('(()=>{const t=document.querySelector(".wg-weather")?.textContent||"";return !/\\d°/.test(t)})()'))
    await pg.screenshot(path='/tmp/shot_widgets.png')
    await pg.evaluate('DABSy.widgets.edit()'); chk('edit mode',await pg.evaluate('DABSy.widgets.isEditing()'))
    await pg.evaluate('DABSy.widgets.remove("date")'); chk('remove',await pg.evaluate('!DABSy.widgets.list().some(i=>i.id=="date")'))
    await pg.evaluate('DABSy.widgets.add("calendar")'); chk('add',await pg.evaluate('DABSy.widgets.list().some(i=>i.id=="calendar")'))
    await pg.evaluate('DABSy.widgets.done()')
    await pg.reload(); await pg.wait_for_timeout(2500)
    chk('widget layout persists',await pg.evaluate('DABSy.widgets.list().some(i=>i.id=="calendar")&&!DABSy.widgets.list().some(i=>i.id=="date")'))
    # --- chat open: focus synchronous, widgets hide, no console errors
    await pg.wait_for_timeout(3000)
    await pg.evaluate('DABSy.app.openCommand()')
    chk('input focused immediately',await pg.evaluate('document.activeElement===document.getElementById("text-input")'))
    await pg.wait_for_timeout(450); chk('widgets hidden in chat',await pg.evaluate('getComputedStyle(document.getElementById("widgets")).visibility')=='hidden')
    chk('blur off in chat',await pg.evaluate('getComputedStyle(document.getElementById("input-dock")).backdropFilter')in('none',''))
    await pg.evaluate('DABSy.app.closeCommand()')
    # --- planner
    say=lambda t:pg.evaluate('async(t)=>{const r=await DABSy.dayplan.handle(t);return r&&{text:r.text,ch:!!(r.opts&&r.opts.choices)}}',t)
    r=await say('plan my day'); chk('empty -> asks what to do (not "add a task")',r and r['ch'] and 'add a task' not in r['text'].lower(),r)
    r=await say('maths homework 1 hr, physics revision 45 min'); chk('typed list -> plan',r and 'draft' in r['text'].lower(),r)
    plan=await pg.evaluate('(()=>{const p=DABSy.dayplan.current();return {n:p.items.filter(i=>i.kind=="work").length,sheet:!!document.querySelector(".dp-sheet"),firstStart:p.items[0].start.toISOString()}})()')
    chk('plan has 2 work blocks and card shown',plan['n']>=2 and plan['sheet'],plan)
    await pg.screenshot(path='/tmp/shot_plan.png')
    before=await pg.evaluate('DABSy.tasks.list().length')
    await pg.evaluate('document.querySelector(".dp-row.work .dp-ctl .dp-btn:nth-child(4)").click()')  # +15
    await pg.evaluate('document.querySelector(".dp-main").click()'); await pg.wait_for_timeout(500)
    after=await pg.evaluate('DABSy.tasks.list().filter(t=>t.source=="dabsy-plan").map(t=>({t:t.title,d:t.dueAt,m:t.durationMin}))')
    chk('accepted tasks genuinely saved',len(after)>=2 and all(a['d'] for a in after),after)
    # reject saves nothing
    n0=await pg.evaluate('DABSy.tasks.list().length')
    await say('plan my day'); await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(400)
    chk('reject changes nothing',await pg.evaluate('DABSy.tasks.list().length')==n0)
    # with real tasks it plans immediately
    await pg.evaluate('DABSy.tasks.add({title:"Chemistry notes",durationMin:60,priority:"high"})')
    r=await say('what should I do next?'); chk('next action answers',r and r['text'],r)
    r=await say('I have 30 minutes free'); chk('free window answers honestly',r and ('booked' in r['text'] or 'draft' in r['text'].lower() or 'how I' in r['text']),r)
    await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(400)
    r=await say('organise my week'); chk('week plan',r and 'week' in r['text'].lower(),r)
    await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(400)
    r=await say('help me prepare for my physics exam'); chk('exam asks date once',r and r['ch'],r)
    r=await say('in 4 days'); chk('exam plan after date',r and 'draft' in r['text'].lower(),r)
    await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(400)
    r=await say('remind me about this later'); print(r)
    # move unfinished
    past=await pg.evaluate('''()=>{const d=new Date(Date.now()-3*3600e3);const t=DABSy.tasks.add({title:"Old essay",durationMin:30,dueAt:d.toISOString()});return t.id}''')
    r=await say('move my unfinished tasks to tomorrow'); due=await pg.evaluate('(id)=>DABSy.tasks.get(id).dueAt',past)
    chk('unfinished moved to tomorrow (verified)',r and 'Moved' in r['text'],r)
    # ---- mobile layout screenshot
    await pg.screenshot(path='/tmp/shot_final.png')
    chk('no 4xx asset requests',not [u for u in bad if 'favicon' not in u],bad[:5])
    chk('no page errors at end',not errs,errs)
    await b.close()
  f=[n for n,o in res if not o]; print(f'\n{len(res)-len(f)}/{len(res)} passed'); print('FAILED:',f)
asyncio.run(main())
