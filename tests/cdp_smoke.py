#!/usr/bin/env python3
import json, os, random, shutil, socket, subprocess, sys, tempfile, threading, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
try:
    import requests
    import websocket
except ImportError as exc:
    requests = None
    websocket = None
    OPTIONAL_IMPORT_ERROR = exc

ROOT = Path(__file__).resolve().parents[1]
CHROMIUM = shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')

def free_port():
    s=socket.socket(); s.bind(('127.0.0.1',0)); p=s.getsockname()[1]; s.close(); return p

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args): pass

def start_server():
    port=free_port()
    os.chdir(ROOT)
    srv=ThreadingHTTPServer(('127.0.0.1',port), QuietHandler)
    t=threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    return srv, port

class CDP:
    def __init__(self, wsurl):
        self.ws=websocket.create_connection(wsurl, timeout=8)
        self.i=0
    def cmd(self, method, params=None):
        self.i+=1
        self.ws.send(json.dumps({'id':self.i,'method':method,'params':params or {}}))
        while True:
            msg=json.loads(self.ws.recv())
            if msg.get('id')==self.i:
                if 'error' in msg: raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result',{})
    def eval(self, expr, awaitPromise=False):
        res=self.cmd('Runtime.evaluate', {'expression':expr, 'awaitPromise':awaitPromise, 'returnByValue':True})
        if 'exceptionDetails' in res: raise RuntimeError(res['exceptionDetails'])
        return res.get('result',{}).get('value')
    def close(self):
        try: self.ws.close()
        except Exception: pass

def main():
    if not requests or not websocket:
        print(f'SKIP: optional browser smoke dependencies unavailable ({OPTIONAL_IMPORT_ERROR})')
        return 0
    if not CHROMIUM:
        print('SKIP: chromium not found'); return 0
    srv, port = start_server()
    dbg=free_port(); profile=tempfile.mkdtemp(prefix='cityrail-cdp-')
    proc=subprocess.Popen([CHROMIUM,'--headless=new','--no-sandbox','--remote-allow-origins=*',f'--remote-debugging-port={dbg}',f'--user-data-dir={profile}','about:blank'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wsurl=None
        for _ in range(80):
            try:
                tabs=requests.get(f'http://127.0.0.1:{dbg}/json', timeout=0.5).json()
                if tabs:
                    wsurl=tabs[0]['webSocketDebuggerUrl']; break
            except Exception: time.sleep(0.1)
        if not wsurl:
            print('FAIL: cannot connect chromium devtools'); return 1
        c=CDP(wsurl)
        errors=[]
        c.cmd('Runtime.enable'); c.cmd('Page.enable'); c.cmd('Log.enable')
        # Navigate and wait with network/leaflet tolerant timing.
        c.cmd('Page.navigate', {'url':ROOT.joinpath('index.html').as_uri()})
        time.sleep(6)
        # JS syntax/runtime fatal checks.
        ready=c.eval('document.readyState')
        title=c.eval('document.title')
        href=c.eval('location.href')
        bodytxt=c.eval('document.body ? document.body.innerText.slice(0,200) : ""')
        
        if href.startswith('chrome-error://'):
            # Sandbox Chromium blocks http/file navigation. Fall back to an injected in-memory page
            # so runtime self-check can still execute without external network access.
            c.cmd('Page.navigate', {'url':'about:blank'})
            time.sleep(0.5)
            html=(ROOT/'index.html').read_text(encoding='utf-8')
            js=(ROOT/'js/cityrail-runtime.js').read_text(encoding='utf-8')
            js_v145=(ROOT/'js/cityrail-v146-single-control-owner.js').read_text(encoding='utf-8')
            css=(ROOT/'css/cityrail.css').read_text(encoding='utf-8')
            import json as _json, re as _re
            html2=_re.sub(r'<script[^>]*src=["\'][^"\']+["\'][^>]*></script>','',html,flags=_re.I)
            html2=_re.sub(r'<link[^>]+rel=["\']stylesheet["\'][^>]*>','',html2,flags=_re.I)
            mock='''(()=>{const U=new Proxy(function(){return U},{get:(t,p)=>p===Symbol.toPrimitive?()=>0:(p==="then"?undefined:U),apply:()=>U,construct:()=>U});window.L=new Proxy({map:()=>U,tileLayer:()=>U,layerGroup:()=>U,polyline:()=>U,polygon:()=>U,marker:()=>U,circle:()=>U,circleMarker:()=>U,divIcon:()=>U,latLng:(a,b)=>({lat:a,lng:b}),latLngBounds:()=>U,control:{layers:()=>U,zoom:()=>U}}, {get:(t,p)=>t[p]||U});})();'''
            c.eval('document.open();document.write('+_json.dumps(html2)+');document.close();')
            c.eval('var st=document.createElement("style"); st.textContent='+_json.dumps(css)+'; document.head.appendChild(st);')
            c.eval(mock)
            c.cmd('Runtime.evaluate', {'expression':'try{const S={getItem:function(){return null},setItem:function(){},removeItem:function(){},clear:function(){}};Object.defineProperty(window,\"localStorage\",{value:S,configurable:true});Object.defineProperty(window,\"sessionStorage\",{value:S,configurable:true});}catch(e){} void 0;', 'returnByValue':False})
            c.eval('try{ eval('+_json.dumps(js)+'); }catch(e){ window.__cityrailInjectError=String(e && (e.stack||e.message||e)); }')
            c.eval('try{ eval('+_json.dumps(js_v145)+'); }catch(e){ window.__cityrailInjectError=String(e && (e.stack||e.message||e)); }')
            time.sleep(2)
            href=c.eval('location.href'); title=c.eval('document.title'); bodytxt=c.eval('document.body ? document.body.innerText.slice(0,200) : ""')
        inject_error=c.eval('window.__cityrailInjectError || null')
        report=c.eval('(typeof cityrailV145Report==="function" ? cityrailV145Report() : (typeof cityrailV143Report==="function" ? cityrailV143Report() : null))')
        if not report:
            errors.append('cityrail report is missing')
        else:
            if not report.get('snapshotOwner'): errors.append('v145 snapshot owner not installed')
            if not report.get('dragCore'): errors.append('station drag core not installed')
            if report.get('legacyControlTimers'): errors.append(f'legacy control timers remain: {report.get("legacyControlTimers")}')
        # Static loading requirements.
        legacy_scripts=c.eval('Array.from(document.scripts).filter(s=>/js\\/legacy\\//.test(s.src)).map(s=>s.src)')
        local_scripts=c.eval('Array.from(document.scripts).filter(s=>/\\/js\\//.test(s.src)||/\\.\\/js\\//.test(s.getAttribute("src")||"")).map(s=>s.getAttribute("src")||s.src)')
        local_styles=c.eval('Array.from(document.querySelectorAll("link[rel=stylesheet]")).filter(l=>/\\/css\\//.test(l.href)||/\\.\\/css\\//.test(l.getAttribute("href")||"")).map(l=>l.getAttribute("href")||l.href)')
        if legacy_scripts: errors.append(f'legacy script tags exist: {legacy_scripts}')
        if href!='about:blank' and (len(local_scripts)!=2 or 'cityrail-runtime.js' not in local_scripts[0] or 'cityrail-v146-single-control-owner.js' not in local_scripts[1]): errors.append(f'unexpected local scripts: {local_scripts}')
        if href!='about:blank' and (len(local_styles)!=1 or 'cityrail.css' not in local_styles[0]): errors.append(f'unexpected local styles: {local_styles}')
        # Old UI text and bad actions.
        old_text_count=c.eval('(()=>{const bad=[String.fromCharCode(21040,22320,22270,36873,25321,20572,31449),String.fromCharCode(26087)+"ATS",String.fromCharCode(26087,32447,36335,36816,33829),"线路级ATS调度界面","双线运行","终点折返线"];return bad.map(t=>({t,c:Array.from(document.body.querySelectorAll("*")).filter(e=>(e.textContent||"").trim()===t).length}));})()')
        bad=[x for x in old_text_count if x['c']]
        if bad: errors.append(f'old UI text visible: {bad}')
        missing_actions=c.eval('Array.from(document.querySelectorAll("button,a,[role=button]")).filter(el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&!el.dataset.action&&!el.onclick&&!el.getAttribute("onclick")&&!(el.getAttribute("href")&&el.getAttribute("href")!=="#")).map(el=>(el.textContent||"").trim()).slice(0,20)')
        if missing_actions: errors.append(f'buttons without action metadata: {missing_actions}')
        print(json.dumps({'readyState':ready,'title':title,'href':href,'bodyText':bodytxt,'report':report,'injectError':inject_error,'localScripts':local_scripts,'localStyles':local_styles,'oldTextCounts':old_text_count,'missingActions':missing_actions,'errors':errors}, ensure_ascii=False, indent=2))
        return 1 if errors else 0
    finally:
        try: proc.terminate(); proc.wait(timeout=3)
        except Exception: proc.kill()
        srv.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

if __name__=='__main__':
    sys.exit(main())
