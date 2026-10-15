import asyncio
from playwright.async_api import async_playwright
RC='''(()=>{const ui=DABSy.ui;const sh=ui.sheet({title:"Recommended for 11th chemistry"});
const row=(on,t,m)=>`<div class="rc-row ${on?'on':''}"><label class="rc-incl"><input type="checkbox" ${on?'checked':''}>Plan · ${m} min</label><div class="rc-main"><div class="rc-meta"><span>Video</span><span>${m} min</span></div><h3>${t}</h3><div class="rc-source">Vedantu Maharashtra</div><div class="rc-why">Covers chemistry, 11th, 5.</div><div class="rc-acts"><button class="btn">Preview</button><button class="btn">Open in Study Space</button></div></div></div>`;
const d=document.createElement("div");d.className="rc-list";d.innerHTML=row(0,"Chemical Bonding Class 11 One Shot",55)+row(1,"Thermodynamics | CBSE Class 11 Chemistry",18)+row(1,"Hydrogen Bonding | Class 11th",26)+`<div class="plan-b cur"><div>Block 1 · Watch</div></div><div class="plan-b k-break"><div>Break · 5 min</div></div><div class="nc-item new"><div>Test tomorrow — Physics</div></div><div class="nc-item acted"><div>Done earlier</div></div>`;
(sh.body||document.querySelector(".sheet-body")).append(d);})()'''
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for theme in ('dark','light'):
      ctx=await b.new_context(viewport={'width':360,'height':740},device_scale_factor=2,has_touch=True,is_mobile=True,color_scheme='dark' if theme=='dark' else 'light')
      await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}));localStorage.setItem("dabsy_settings",JSON.stringify({theme:"%s"}))'%theme)
      pg=await ctx.new_page(); await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(2500)
      await pg.evaluate("DABSy.require(\"cards\")"); await pg.wait_for_timeout(600); await pg.evaluate(RC); await pg.wait_for_timeout(900); await pg.screenshot(path=f'/home/claude/shots/cards_{theme}.png')
      await pg.evaluate('document.querySelector(".sheet-layer .icon-btn")&&document.querySelector(".sheet-layer .icon-btn").click()'); await pg.wait_for_timeout(600)
      await pg.evaluate('DABSy.require("settings").then(s=>s.open())'); await pg.wait_for_timeout(1200); await pg.screenshot(path=f'/home/claude/shots/settings_{theme}.png')
      await ctx.close()
    await b.close()
asyncio.run(main())
