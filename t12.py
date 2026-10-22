import asyncio, json
from playwright.async_api import async_playwright
res=[]
def chk(n,ok,d=''): res.append(ok); print(('PASS' if ok else 'FAIL'),n,d)
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':390,'height':780},has_touch=True,is_mobile=True)
    await ctx.add_init_script('localStorage.setItem("dabsy_onboarding_v1",JSON.stringify({tutorialCompleted:true}))')
    calls=[]; mode={'m':'ok'}
    async def h(route):
        body=route.request.post_data or ''
        try: msg=json.loads(body).get('message','')
        except Exception: msg=''
        calls.append(msg)
        if mode['m']=='fail': await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({'reply':'Gemini request failed'}))
        else: await route.fulfill(status=200,content_type='application/json',headers={'access-control-allow-origin':'*'},body=json.dumps({'reply':'Photosynthesis is how plants turn sunlight, water and carbon dioxide into sugar and oxygen. '+('(more detail) ' if 'EXPAND' in msg.upper() or 'in more depth' in msg.lower() else '')}))
    await ctx.route('**/dabsy-brain.*/**',h); await ctx.route('**/workers.dev/**',h)
    pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto('http://localhost:8090/index.html'); await pg.wait_for_timeout(2500)
    ask=lambda t:pg.evaluate('(t)=>DABSy.app.handleUserUtterance(t)',t)
    await ask('what is photosynthesis'); await pg.wait_for_timeout(2500)
    txt=await pg.evaluate('document.querySelector("#subtitle .sub-text")?.textContent||""'); print('reply:',txt[:80],'| calls',len(calls))
    chk('plain question answered via AI',('Photosynthesis' in txt),txt[:60])
    chk('Explain more button offered',await pg.evaluate('!![...document.querySelectorAll("#subtitle .sub-actions button")].find(b=>/explain/i.test(b.textContent))'))
    n=len(calls); await pg.evaluate('[...document.querySelectorAll("#subtitle .sub-actions button")].find(b=>/explain/i.test(b.textContent)).click()'); await pg.wait_for_timeout(2500)
    chk('Explain more asks the model again',len(calls)>n,str(calls[-1][:80]) if calls else '')
    mode['m']='fail'; n=len(calls); await ask('why is the sky blue'); await pg.wait_for_timeout(3500)
    txt=await pg.evaluate('document.querySelector("#subtitle .sub-text")?.textContent||""')
    chk('provider failure text is NOT shown as DABSy speech','Gemini request failed' not in txt,txt[:90])
    chk('retry offered',await pg.evaluate('!![...document.querySelectorAll("#subtitle .sub-actions button")].find(b=>/retry|try again/i.test(b.textContent))'))
    chk('quiet auto-retry happened',len(calls)-n>=2,str(len(calls)-n))
    chk('no page errors',not errs,str(errs[:2]))
    await b.close()
asyncio.run(main()); print(sum(res),'/',len(res))
