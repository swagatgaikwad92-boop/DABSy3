import asyncio, json
from playwright.async_api import async_playwright
R={}
def rec(k,ok,info=''): R[k]=('PASS' if ok else 'FAIL', info); print(('PASS ' if ok else 'FAIL ')+k, info)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true,outcome:"skipped"}));localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}))')
        pg = await ctx.new_page(); cdp = await ctx.new_cdp_session(pg)
        errs=[]
        pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERR '+str(e)))
        await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(3200)
        snap=lambda: pg.evaluate('DABSy.world.snapshot()')
        async def rect(sel): return await pg.evaluate('(s)=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,l:r.left,t:r.top}}',sel)
        async def touch(x,y,hold=0):
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            await pg.wait_for_timeout(hold or 60)
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        # events log on bus
        await pg.evaluate('''window.__ev=[];["face:tap","face:tap-away","face:doubletap","face:longpress"].forEach(e=>DABSy.bus.on(e,d=>__ev.push(e+":"+(d&&d.region||""))))''')
        ev=lambda: pg.evaluate('__ev.splice(0)')
        # --- at home: eye tap opens chat once
        e=await rect('#eye-left'); await touch(e['x'],e['y']); await pg.wait_for_timeout(500)
        evs=await ev(); cmd=await pg.evaluate('document.body.classList.contains("cmd-open")')
        rec('home-eye-tap-opens-chat-once', evs==['face:tap:eyes'] and cmd, str(evs))
        s=await snap(); rec('chat-open-she-attends(INTERACTING, above chat)', s['attend'] and s['state']=='INTERACTING', f"state={s['state']} feetY={s['feet']['y']:.0f}")
        await pg.wait_for_timeout(900)
        ch=await pg.evaluate('document.getElementById("chat-area").getBoundingClientRect().top'); s=await snap()
        rec('attend-feet-above-chat-top', s['feet']['y']<=ch, f"feet={s['feet']['y']:.0f} chatTop={ch:.0f}")
        await pg.screenshot(path='/home/claude/shots/m2_chat.png')
        # close chat via eye tap (empty input)
        e=await rect('#eye-left'); await touch(e['x'],e['y']); await pg.wait_for_timeout(1500); await ev()
        s=await snap(); rec('chat-closed-she-returns-to-home', (not s['attend']) and s['spot']=='cushion', f"state={s['state']} spot={s['spot']}")
        # --- away: tap returns home, no chat
        await pg.evaluate('DABSy.world._goto("desk")'); await pg.wait_for_timeout(1700)
        s=await snap(); rec('goto-desk-away', s['away'] and s['spot']!='cushion' or s['state']=='IDLE_AT_DESTINATION', f"state={s['state']} away={s['away']}")
        await pg.screenshot(path='/home/claude/shots/m3_desk.png')
        e=await rect('#eye-left'); await touch(e['x'],e['y']); await pg.wait_for_timeout(400)
        evs=await ev(); cmd=await pg.evaluate('document.body.classList.contains("cmd-open")')
        s=await snap(); rec('away-tap-returns-home-not-chat', evs==['face:tap-away:eyes'] and not cmd and s['state']=='RETURNING_HOME', f"{evs} cmd={cmd} state={s['state']}")
        await pg.wait_for_timeout(2600); s=await snap()
        rec('arrives-home', s['state']=='IDLE_AT_HOME' and abs(s['feet']['y']-s['spots'][0]['fy'])<2, f"state={s['state']} feet=({s['feet']['x']:.0f},{s['feet']['y']:.0f}) home=({s['spots'][0]['fx']:.0f},{s['spots'][0]['fy']:.0f})")
        # --- at home now: tap opens chat (normal), then close
        e=await rect('#eye-left'); await touch(e['x'],e['y']); await pg.wait_for_timeout(500); evs=await ev()
        rec('after-return-tap-opens-chat', evs==['face:tap:eyes'], str(evs))
        await pg.keyboard.press('Escape'); await pg.evaluate('DABSy.app.closeCommand()'); await pg.wait_for_timeout(1500)
        # --- long press while at home: tasks, no tap
        e=await rect('#eye-right'); await touch(e['x'],e['y'],hold=700); await pg.wait_for_timeout(500); evs=await ev()
        sheet=await pg.evaluate('document.body.classList.contains("sheet-open")')
        rec('long-press-opens-tasks-no-tap', evs==['face:longpress:eyes'] and sheet, f"{evs} sheet={sheet}")
        await pg.evaluate('document.querySelector(".sheet-layer .icon-btn")&&document.querySelector(".sheet-layer .icon-btn").click()'); await pg.wait_for_timeout(700)
        # --- double tap bow: apps
        bw=await rect('#mw-bow'); await touch(bw['x'],bw['y']); await pg.wait_for_timeout(90); await touch(bw['x'],bw['y']); await pg.wait_for_timeout(700)
        evs=await ev(); eco=await pg.evaluate('document.body.classList.contains("eco-open")')
        rec('double-tap-bow-opens-apps', 'face:doubletap:tie' in evs and eco and 'face:tap:tie' not in evs, f"{evs} eco={eco}")
        apps=await pg.evaluate('[...document.querySelectorAll(".eco-bubble")].map(b=>b.getAttribute("aria-label"))'); print(apps)
        await pg.screenshot(path='/home/claude/shots/m4_eco.png')
        await pg.evaluate('DABSy.ecosystem.close()'); await pg.wait_for_timeout(600)
        # --- single bow tap -> tie region tap
        await touch(bw['x'],bw['y']); await pg.wait_for_timeout(500); evs=await ev(); rec('bow-single-tap-region-tie', evs==['face:tap:tie'], str(evs))
        await pg.wait_for_timeout(1200)
        # tap on background does nothing
        await touch(60,300); await pg.wait_for_timeout(500); evs=await ev(); rec('background-tap-ignored', evs==[], str(evs))
        # --- day/night
        li=await pg.evaluate('DABSy.world.lightInfo()'); rec('day-variant-honestly-absent', li['hasDay']==False and li['effective']=='night', json.dumps(li))
        await pg.evaluate('DABSy.world.setLight("day")'); await pg.wait_for_timeout(300); li=await pg.evaluate('DABSy.world.lightInfo()')
        persisted=await pg.evaluate('localStorage.getItem("dabsy_world_v1")'); rec('light-pref-persists+falls-back-to-night', li['effective']=='night' and '"day"' in persisted, persisted)
        await pg.evaluate('DABSy.world.setLight("auto")')
        # --- resize / orientation
        await pg.set_viewport_size({'width':844,'height':390}); await pg.wait_for_timeout(700); s=await snap()
        inside = 0<=s['feet']['x']<=844 and 0<=s['feet']['y']<=390
        rec('landscape-on-screen', inside, f"feet=({s['feet']['x']:.0f},{s['feet']['y']:.0f}) box={s['layout']['box']:.0f}")
        await pg.screenshot(path='/home/claude/shots/m5_landscape.png')
        await pg.set_viewport_size({'width':360,'height':740}); await pg.wait_for_timeout(700); s=await snap()
        rec('narrow-360x740-on-screen', 0<=s['feet']['x']<=360 and 0<=s['feet']['y']<=740, f"feet=({s['feet']['x']:.0f},{s['feet']['y']:.0f})")
        await pg.set_viewport_size({'width':412,'height':915}); await pg.wait_for_timeout(700); s=await snap()
        rec('tall-412x915-on-screen', 0<=s['feet']['x']<=412 and 0<=s['feet']['y']<=915, f"feet=({s['feet']['x']:.0f},{s['feet']['y']:.0f})")
        await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(500)
        # --- away + resize keeps her on screen and in a valid state
        await pg.evaluate('DABSy.world._goto("sill")'); await pg.wait_for_timeout(200)
        await pg.set_viewport_size({'width':844,'height':390}); await pg.wait_for_timeout(600); s=await snap()
        rec('resize-while-moving-lands-valid', s['state'] in ('IDLE_AT_DESTINATION','IDLE_AT_HOME') and 0<=s['feet']['x']<=844 and 0<=s['feet']['y']<=390, f"state={s['state']}")
        await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(500)
        print('console errors:', errs)
        rec('no-console-errors', len(errs)==0, str(errs[:3]))
        json.dump(R,open('/home/claude/shots/t2.json','w'),indent=1)
        await b.close()
asyncio.run(main())
