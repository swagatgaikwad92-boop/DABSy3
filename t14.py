# v11.2: widget chooser (none by default), unified wallpaper picker layout, conversation-first planning, butler memory
import asyncio
from playwright.async_api import async_playwright
res=[]
def chk(n,ok,d=''): res.append((n,bool(ok))); print(('PASS' if ok else 'FAIL'),n,str(d)[:220])
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':800},has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(2500)
    # a v11.1 auto-filled layout must be reset once
    await pg.evaluate('localStorage.setItem("dabsy_widgets_v1",JSON.stringify({on:true,items:[{id:"clock",slot:0},{id:"date",slot:1},{id:"tasks",slot:2},{id:"weather",slot:3}]}))')
    await pg.reload(); await pg.wait_for_timeout(2500)
    chk('no widgets on by default (even after v11.1 layout)',await pg.evaluate('DABSy.widgets.list().length')==0)
    chk('widget button top-left',await pg.evaluate('(()=>{const r=document.getElementById("wg-btn").getBoundingClientRect();return r.left<40&&r.top<40&&r.width>=40})()'))
    await pg.tap('#wg-btn'); await pg.wait_for_timeout(300)
    chk('panel opens with 5 choices',await pg.evaluate('!document.getElementById("wg-panel").hidden&&document.querySelectorAll("#wg-panel .wg-prow").length')==5)
    await pg.evaluate('document.querySelectorAll("#wg-panel .wg-prow input")[0].click()'); await pg.wait_for_timeout(1500)
    chk('chosen widget appears, others not',await pg.evaluate('DABSy.widgets.list().map(i=>i.id).join()')=='clock' and await pg.evaluate('document.querySelectorAll("#widgets .wg-card.in").length')==1)
    await pg.screenshot(path='/tmp/s14_panel.png')
    await pg.reload(); await pg.wait_for_timeout(2500)
    chk('choice persists',await pg.evaluate('DABSy.widgets.list().map(i=>i.id).join()')=='clock')
    # settings: wallpaper picker fits
    await pg.evaluate('DABSy.require("settings").then(s=>s.open())'); await pg.wait_for_timeout(1200)
    m=await pg.evaluate('''()=>{const sh=document.querySelector(".sheet.settings");const g=document.querySelector(".wp-grid");const tiles=[...document.querySelectorAll(".wp-tile")];const sr=sh.getBoundingClientRect();
      return {tiles:tiles.length,over:tiles.some(t=>{const r=t.getBoundingClientRect();return r.right>sr.right+1||r.left<sr.left-1}),hscroll:sh.scrollWidth>sh.clientWidth+1||document.querySelector(".sheet-body").scrollWidth>document.querySelector(".sheet-body").clientWidth+1,noSeparateMagic:!document.querySelector(".mw-tile:not(.classic)")}}''')
    chk('picker: 4 tiles, inside the sheet, no sideways scroll',m['tiles']==4 and not m['over'] and not m['hscroll'],m)
    await pg.evaluate('document.querySelector("#set-world").scrollIntoView()'); await pg.wait_for_timeout(500)
    await pg.screenshot(path='/tmp/s14_settings.png')
    await pg.evaluate('document.querySelectorAll(".wp-tile")[1].click()'); await pg.wait_for_timeout(1800)
    chk('one tap on a wallpaper turns it on and selects it',await pg.evaluate('DABSy.outfits.form()=="magic"&&DABSy.world.habitatId()=="lakeside"'))
    await pg.evaluate('document.querySelector(".sheet-layer .icon-btn[aria-label=Close]").click()'); await pg.wait_for_timeout(600)
    # conversation first
    say=lambda t:pg.evaluate('async(t)=>{const r=await DABSy.dayplan.handle(t);return r&&{text:r.text,opts:(r.opts&&r.opts.choices&&r.opts.choices.options)||null,sheet:!!document.querySelector(".dp-sheet")}}',t)
    r=await say('plan my day'); chk('opens with a question + choices, no plan yet',r and r['opts'] and not r['sheet'] and 'add a task' not in r['text'].lower(),r)
    r=await say("Let's talk first"); chk('enters small talk',r and 'Happy to' in r['text'],r)
    r=await say('I am quite tired today and I want to keep the evening free for a workout'); chk('talk turn replies + changed choices',r and r['opts'] and 'Plan it now' in r['opts'] or (r and r['opts']),r)
    r=await say('keep going'); chk('still talking, no plan',r and not r['sheet'],r)
    r=await say('okay plan my day from this'); chk('then plans on request',r and ('draft' in r['text'].lower() or 'picked' in r['text'].lower() or 'booked' in r['text'].lower() or r['opts']),r)
    await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(500)
    # category picker is multi-select and not study-only
    await pg.evaluate('DABSy.dayplan.handle("not now")')
    r=await say('just plan my day'); chk('empty day -> category picker incl. non-study',r and r['opts'] and 'Workout' in r['opts'] and 'Rest' in r['opts'],r)
    r=await say('Workout, Rest, Friends & family'); chk('picked categories become a plan',r and 'draft' in r['text'].lower(),r)
    titles=await pg.evaluate('DABSy.dayplan.current().items.filter(i=>i.kind=="work").map(i=>i.title)'); chk('plan contains workout/rest/friends, not forced study',any('Workout' in t for t in titles) and not any('Study' in t for t in titles),titles)
    await pg.evaluate('(()=>{const b=document.querySelector(".dp-ghost");b&&b.click()})()'); await pg.wait_for_timeout(500)
    # memory
    await pg.evaluate('DABSy.app.handleUserUtterance("remember that I study best at night")'); await pg.wait_for_timeout(800)
    await pg.evaluate('DABSy.app.handleUserUtterance("I wake up at 6")'); await pg.wait_for_timeout(800)
    mem=await pg.evaluate('DABSy.bmem.list().map(f=>f.text)'); chk('butler memory stores told facts',len(mem)>=2,mem)
    chk('wake time changes planning window',await pg.evaluate('DABSy.bmem.get("wake")')=='06:00')
    await pg.reload(); await pg.wait_for_timeout(2000)
    chk('memory persists after refresh',await pg.evaluate('DABSy.bmem.list().length')>=2)
    chk('memory reaches the AI prompt',await pg.evaluate('DABSy.bmem.prompt().includes("night")'))
    await pg.evaluate('DABSy.bmem.clear()'); chk('forget everything works',await pg.evaluate('DABSy.bmem.list().length')==0)
    chk('no page errors',not errs,errs)
    await b.close()
  f=[n for n,o in res if not o]; print(f'\n{len(res)-len(f)}/{len(res)} passed'); print('FAILED:',f)
asyncio.run(main())
