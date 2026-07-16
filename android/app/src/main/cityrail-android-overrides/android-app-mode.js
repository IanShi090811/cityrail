(function(){
  'use strict';
  var W=window,D=document;
  var bridge=W.CityRailAndroid||null;
  var state=null,timer=null,overlay=null,toast=null;
  var COPY=[
    [/进入游戏/g,'开始使用'],
    [/游戏初始化失败/g,'模拟器初始化失败'],
    [/游戏主程序/g,'模拟器主程序'],
    [/玩家/g,'用户'],
    [/游玩/g,'使用'],
    [/已付费用户/g,'专业版用户'],
    [/新玩家/g,'新用户'],
    [/完整版游戏/g,'专业版授权'],
    [/完整版本/g,'专业版授权'],
    [/创意工坊/g,'方案库']
  ];
  function parseState(){
    try{ state=bridge&&JSON.parse(bridge.getLicenseState&&bridge.getLicenseState()); }
    catch(e){ state=null; }
    return state||{professional:false,trialRemainingMs:30*60*1000,productName:'CityRail 轨道交通模拟器'};
  }
  function textReplace(root){
    var walker=D.createTreeWalker(root||D.body,W.NodeFilter.SHOW_TEXT,{
      acceptNode:function(node){
        var p=node&&node.parentNode;
        var tag=p&&p.tagName&&p.tagName.toLowerCase();
        return /^(script|style|noscript|textarea)$/i.test(tag||'')?W.NodeFilter.FILTER_REJECT:W.NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes=[],n;
    while((n=walker.nextNode())) nodes.push(n);
    nodes.forEach(function(node){
      var text=node.nodeValue,next=text;
      COPY.forEach(function(pair){ next=next.replace(pair[0],pair[1]); });
      if(next!==text) node.nodeValue=next;
    });
  }
  function injectStyle(){
    if(D.getElementById('cityrail-android-app-style')) return;
    var st=D.createElement('style');
    st.id='cityrail-android-app-style';
    st.textContent=[
      'html.cityrail-android-app #workshop-screen,html.cityrail-android-app .auth-btn-workshop{display:none!important;}',
      'html.cityrail-android-app #cityrail-android-license{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:2147483200;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(8,15,26,.86);color:rgba(245,250,255,.92);font:600 12px/1.35 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 12px 34px rgba(0,0,0,.28);}',
      '#cityrail-android-license button,#cityrail-android-pay button{border:0;border-radius:11px;background:#0a84ff;color:#fff;font-weight:800;height:34px;padding:0 12px;}',
      '#cityrail-android-pay{position:fixed;inset:0;z-index:2147483300;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(1,6,15,.78);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;}',
      '#cityrail-android-pay.visible{display:flex;}',
      '#cityrail-android-pay .card{max-width:420px;width:100%;border-radius:22px;padding:24px;background:#091421;border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 80px rgba(0,0,0,.48);}',
      '#cityrail-android-pay h2{margin:0 0 10px;font-size:22px;letter-spacing:0;}',
      '#cityrail-android-pay p{margin:0 0 16px;color:rgba(255,255,255,.72);line-height:1.65;}',
      '#cityrail-android-toast{position:fixed;left:18px;right:18px;bottom:92px;z-index:2147483400;display:none;padding:12px 14px;border-radius:13px;background:rgba(0,0,0,.78);color:#fff;text-align:center;font:600 13px/1.45 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;}',
      '#cityrail-android-toast.visible{display:block;}'
    ].join('');
    D.head.appendChild(st);
  }
  function formatRemain(ms){
    if(ms===Number.MAX_SAFE_INTEGER||ms>365*24*60*60*1000) return '专业版已解锁';
    var m=Math.max(0,Math.ceil(ms/60000));
    return m>0?'试用剩余 '+m+' 分钟':'试用额度已用完';
  }
  function ensureBanner(){
    var s=parseState();
    var bar=D.getElementById('cityrail-android-license');
    if(!bar){
      bar=D.createElement('div');
      bar.id='cityrail-android-license';
      bar.innerHTML='<span></span><button type="button">专业版</button>';
      bar.querySelector('button').onclick=requestPurchase;
      D.body.appendChild(bar);
    }
    bar.querySelector('span').textContent=s.professional?'专业版授权已激活':formatRemain(Number(s.trialRemainingMs||0));
    bar.style.display=s.professional?'none':'flex';
  }
  function ensureOverlay(){
    if(overlay) return overlay;
    overlay=D.createElement('div');
    overlay.id='cityrail-android-pay';
    overlay.innerHTML='<div class="card"><h2>解锁专业版授权</h2><p>试用额度已用完。解锁后可继续使用完整规模的轨道交通规划、客流仿真和调度模拟功能。</p><button type="button">解锁专业版</button></div>';
    overlay.querySelector('button').onclick=requestPurchase;
    D.body.appendChild(overlay);
    return overlay;
  }
  function ensureToast(){
    if(toast) return toast;
    toast=D.createElement('div');
    toast.id='cityrail-android-toast';
    D.body.appendChild(toast);
    return toast;
  }
  function showToast(msg){
    var t=ensureToast();
    t.textContent=msg||'暂时无法完成授权';
    t.classList.add('visible');
    setTimeout(function(){ t.classList.remove('visible'); },3200);
  }
  function requestPurchase(){
    try{ bridge&&bridge.requestProfessionalLicense&&bridge.requestProfessionalLicense(); }
    catch(e){ showToast('当前渠道支付尚未完成配置'); }
  }
  function hideEntryScreens(){
    ['splash-screen','auth-screen','invite-code-screen','register-screen','login-screen','payment-screen','payment-success-screen','workshop-screen'].forEach(function(id){
      var el=D.getElementById(id);
      if(!el) return;
      el.classList.remove('visible');
      el.classList.add('fade-out');
      el.style.display='none';
      el.style.pointerEvents='none';
    });
  }
  function enterSimulator(evt){
    if(evt&&evt.preventDefault) evt.preventDefault();
    if(evt&&evt.stopImmediatePropagation) evt.stopImmediatePropagation();
    try{ W.__CITYRAIL_SPLASH_STOP_REQUESTED__=true; }catch(e){}
    try{ if(typeof W.cityrailStopSplashAnimation==='function') W.cityrailStopSplashAnimation(); }catch(e){}
    hideEntryScreens();
    if(typeof W.cityrailShowCitySelectScreen==='function'){
      W.cityrailShowCitySelectScreen(0);
      return false;
    }
    var city=D.getElementById('city-select-screen');
    if(city){
      city.style.display='';
      city.classList.remove('fade-out','loading');
      city.classList.add('visible');
    }
    if(typeof W.initCitySelect==='function'){
      try{ W.initCitySelect(); }catch(e){}
    }
    return false;
  }
  function installLocalEntry(){
    W.handleSplashContinue=enterSimulator;
    var btn=D.getElementById('splash-continue-btn');
    if(btn&&!btn.dataset.cityrailAndroidEntry){
      btn.dataset.cityrailAndroidEntry='1';
      btn.onclick=enterSimulator;
      btn.addEventListener('click',enterSimulator,true);
    }
  }
  function tick(){
    var s=parseState();
    ensureBanner();
    var expired=!s.professional && Number(s.trialRemainingMs||0)<=0;
    ensureOverlay().classList.toggle('visible',expired);
  }
  function boot(){
    injectStyle();
    D.title='CityRail 轨道交通模拟器';
    textReplace(D.body);
    installLocalEntry();
    var attempts=0;
    var entryTimer=setInterval(function(){
      installLocalEntry();
      attempts++;
      if(attempts>80) clearInterval(entryTimer);
    },100);
    tick();
    timer=setInterval(tick,15000);
    if(W.MutationObserver){
      new MutationObserver(function(){ textReplace(D.body); }).observe(D.body,{childList:true,subtree:true});
    }
  }
  W.CityRailAndroidApp={
    onLicenseState:function(next){ state=next; tick(); },
    onPaymentMessage:showToast
  };
  if(D.readyState==='loading') D.addEventListener('DOMContentLoaded',boot); else boot();
})();
