import asyncio
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':360,'height':640},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    pg=await ctx.new_page(); cdp=await ctx.new_cdp_session(pg); await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(3000)
    r=lambda s: pg.evaluate('(s)=>{const r=document.querySelector(s).getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2),Math.round(r.top),Math.round(r.bottom)]}',s)
    async def touch(x,y):
        await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]}); await pg.wait_for_timeout(60); await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    x,y,_,_=await r('#eye-left'); await touch(x,y); await pg.wait_for_timeout(900)
    cmd=await pg.evaluate('document.body.classList.contains("cmd-open")'); face=await r('#face'); chat=await pg.evaluate('document.getElementById("chat-area").getBoundingClientRect().top')
    print('classic: eye tap opens chat',cmd,'face bottom',face[3],'chat top',round(chat),'-> no overlap',face[3]<=chat+2)
    await pg.screenshot(path='/home/claude/shots/classic_chat_360x640.png')
    await pg.set_viewport_size({'width':360,'height':400}); await pg.wait_for_timeout(800)   # keyboard-like height squeeze
    face=await r('#face'); print('squeezed 400px: face box',face, 'on screen',face[2]>=0 and face[3]<=400)
    await b.close()
asyncio.run(main())
