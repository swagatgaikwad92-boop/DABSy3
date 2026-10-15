import asyncio
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_wardrobe_v1",JSON.stringify({form:"magic",formChosen:true}))')
    pg=await ctx.new_page(); await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(3500)
    print(await pg.evaluate('''(()=>{const e=document.querySelector("#eye-left .eye-shape");const c=getComputedStyle(e);return {bg:c.backgroundImage.slice(0,60),mask:(c.maskImage||c.webkitMaskImage||"").slice(0,40),var:getComputedStyle(document.documentElement).getPropertyValue("--mw-eye-l").slice(0,40),cls:document.getElementById("eye-left").className}})()'''))
    for i in range(3):
        await pg.wait_for_timeout(1200); await pg.screenshot(path=f'/home/claude/shots/mw_eyes{i}.png',clip={'x':100,'y':600,'width':190,'height':220})
    await b.close()
asyncio.run(main())
