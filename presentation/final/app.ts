import { deck } from './content.ts';
import type { Items, Language, LocalizedText, Slide, TableSlide } from './types.ts';

declare global {
  interface Window {
    FIRELINK_ASSETS?: Record<string, string>;
    FIRELINK_PRESENTATION: {
      go: (index: number) => void;
      setLanguage: (value: string) => void;
      preparePrint: () => void;
      getState: () => { current: number; lang: Language; expanded: boolean; total: number };
    };
  }
}

(() => {
  'use strict';
  const $ = <T extends HTMLElement = HTMLElement>(q: string): T => {
    const element = document.querySelector<T>(q);
    if (!element) throw new Error(`Missing presentation element: ${q}`);
    return element;
  };
  const entities: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => entities[c]);
  const params = new URLSearchParams(location.search);
  let lang: Language = params.get('lang') === 'en' ? 'en' : 'zh';
  let current = Math.max(0, deck.slides.findIndex(s => s.id === location.hash.slice(1)));
  let expanded = current >= deck.mainCount || params.get('scope') === 'all';
  let timerStart = 0, timerAccumulated = 0;
  const t = (value?: LocalizedText) => typeof value === 'object' && value !== null ? (value[lang] ?? value.zh ?? '') : (value ?? '');
  const tr = (zh: string,en: string) => lang === 'zh' ? zh : en;
  const assetBase = new URL('.', (document.currentScript as HTMLScriptElement | null)?.src || location.href);
  const src = (name: string) => window.FIRELINK_ASSETS?.[name] || new URL(`assets/${name}`, assetBase).href;
  const material = (online: string, offline: string) => new URL(assetBase.pathname === '/pre/final/' ? online : offline, assetBase).href;
  const count = () => expanded ? deck.slides.length : deck.mainCount;
  const paths: Record<string, string> = {
    left:'m15 18-6-6 6-6',right:'m9 18 6-6-6-6',close:'m6 6 12 12M6 18 18 6',
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    book:'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',
    hideToolbar:'M4 3h16v18H4zM4 15h16m-11 3 3 2 3-2',
    showToolbar:'M4 3h16v18H4zM4 15h16m-11-4 3-3 3 3',
    language:'M4 5h12M10 3v2M6 5c0 7 8 10 8 10M14 5c0 7-10 11-10 11M14 21l4-10 4 10M16 17h4',
    moon:'M20 13a8 8 0 0 1-9-9A8 8 0 1 0 20 13Z',
    print:'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z',
    help:'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
    plus:'M12 5v14M5 12h14',play:'m7 4 14 8-14 8Z',pause:'M8 4v16M16 4v16',
    reset:'M3 10a9 9 0 1 1 2 8M3 4v6h6'
  };
  const icon = (name: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.right}"/></svg>`;
  const button = (id: string,name: string,label: string,extra='') => `<button type="button" class="control ${extra}" data-action="${id}" title="${esc(label)}" aria-label="${esc(label)}">${icon(name)}<span class="control-label optional">${esc(label)}</span></button>`;
  const items = (list: Items) => `<div class="items">${list.map(([title,text])=>`<div class="item"><h2>${esc(t(title))}</h2><p>${esc(t(text))}</p></div>`).join('')}</div>`;
  const capture = (image: string, title: LocalizedText, cover=false, position='top left') => `<figure class="capture"><button type="button" class="capture-button" data-image="${esc(image)}" data-image-title="${esc(t(title))}" aria-label="${esc(tr('放大界面：','Enlarge interface: ')+t(title))}"><img src="${esc(src(image))}" alt="${esc(t(title))}" style="object-position:${esc(position)}" loading="eager" decoding="async"></button><figcaption>${cover?'FireLink　'+tr('组织者工作台','Organizer workspace'):tr('演练界面　点击查看完整截图','Drill interface　Select to view full capture')}</figcaption></figure>`;
  function table(s: TableSlide) {
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(t(s.title))}"><table class="data-table ${s.layout==='table'&&(s.rows.length>=5||s.headers.length>3)?'dense':''}"><thead><tr>${s.headers.map(h=>`<th scope="col">${esc(t(h))}</th>`).join('')}</tr></thead><tbody>${s.rows.map(row=>`<tr>${row.map((v,i)=>`<${i===0?'th scope="row"':'td'}>${esc(t(v))}</${i===0?'th':'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function body(s: Slide) {
    let out='';
    switch(s.layout) {
      case 'cover':
        out=`<div class="cover-copy"><h1>${esc(t(s.title))}</h1><p class="cover-lead">${esc(t(s.lead))}</p><p class="cover-subtitle">${esc(t(s.subtitle))}</p><p class="authors">${esc(deck.authors)}<br>${deck.date}</p></div>${capture(s.image,s.title,true)}`;break;
      case 'table': case 'journey': case 'blueprint': out=table(s);break;
      case 'screen': out=capture(s.image,s.title,false,s.imagePosition)+items(s.items);break;
      case 'flow':
        out=s.lanes.map(l=>`<div class="flow-lane"><h2 class="flow-label">${esc(t(l.label))}</h2><div class="flow-nodes">${l.nodes.map(n=>`<div class="flow-node">${esc(t(n))}</div>`).join('')}</div></div>`).join('')+`<div class="flow-handoff">${s.branches.map(b=>`<span>${esc(t(b))}</span>`).join('')}</div>`;break;
      case 'phones':
        out=s.phones.map(p=>`<figure class="phone-story"><button type="button" class="phone-shot" data-image="${esc(p.image)}" data-image-title="${esc(t(p.title))}" aria-label="${esc(tr('放大：','Enlarge: ')+t(p.title))}"><img src="${esc(src(p.image))}" alt="${esc(t(p.title))}"></button><figcaption><h2>${esc(t(p.title))}</h2><p>${esc(t(p.text))}</p></figcaption></figure>`).join('');break;
      case 'design':
        out=`<div class="design-copy">${items(s.items)}<div class="swatches">${[['#445E91','Primary'],['#D8E2FF','Selected'],['#F3F3FA','Surface'],['#1A1B20','Text']].map(([color,label])=>`<div class="swatch"><div class="swatch-color" style="background:${color}"></div>${label}<br>${color}</div>`).join('')}</div></div>${capture(s.image,s.title)}`;break;
      case 'architecture':out=s.layers.map(l=>`<div class="architecture-layer"><h2>${esc(t(l.title))}</h2><p>${esc(t(l.text))}</p></div>`).join('');break;
      case 'evidence':out=`<div class="metrics">${s.metrics.map(m=>`<div class="metric"><strong>${m.n}</strong><p>${esc(t(m.label))}</p></div>`).join('')}</div>${items(s.items)}`;break;
      case 'brand-end':break;
      default:out=items(s.items);
    }
    return out+(s.callout?`<p class="callout">${esc(t(s.callout))}</p>`:'');
  }
  function renderSlide(s: Slide,index: number,printing=false) {
    if(s.layout==='brand-end')return `<article class="slide brand-end ${printing?'':'running'}" data-slide="${index}" aria-label="${esc(t(s.title))}"><h1 class="brand-name">${esc(t(s.title))}</h1></article>`;
    const number=index<deck.mainCount?`${String(index+1).padStart(2,'0')} / ${deck.mainCount}`:`A${index-deck.mainCount+1} / ${deck.slides.length-deck.mainCount}`;
    return `<article class="slide ${s.layout} ${printing?'':'running'}" data-slide="${index}" aria-label="${esc(t(s.title))}"><header class="running-head"><span class="wordmark">FireLink</span><span class="section-name">${esc(t(deck.sections[s.section]))}</span></header><div class="slide-header"><h1>${esc(t(s.title))}</h1>${s.lead?`<p class="lead">${esc(t(s.lead))}</p>`:''}</div><div class="slide-body">${body(s)}</div><footer class="slide-footer"><span class="slide-source">${esc(t(s.source))}</span><span class="slide-number">${number}</span></footer></article>`;
  }
  function resize() {
    if(innerWidth<=700)return;
    const stage=$('#stage'),slide=stage.querySelector<HTMLElement>('.slide');
    if(slide)slide.style.transform=`scale(${Math.min(stage.clientWidth/1600,stage.clientHeight/900)})`;
  }
  function render() {
    document.documentElement.lang=lang==='zh'?'zh-CN':'en';
    document.title=t(deck.title);
    $('#stage').innerHTML=renderSlide(deck.slides[current],current);
    $('#stage').setAttribute('aria-label',tr('幻灯片','Presentation slide'));
    $('#controls').setAttribute('aria-label',tr('演示控制','Presentation controls'));
    $('#controls').innerHTML=`<div class="deck-progress" aria-hidden="true"><span style="width:${(current+1)/count()*100}%"></span></div><div class="control-group">${button('prev','left',tr('上一页','Previous'),'outlined')}<span class="page-count">${current+1} / ${count()}</span>${button('next','right',tr('下一页','Next'),'primary')}</div><div class="control-group tools">${button('overview','grid',tr('目录','Contents'))}${button('language','language',lang==='zh'?'English':'中文')}${button('appendix','plus',tr('备查页','Appendix'),expanded?'active':'')}${button('notes','book',tr('讲稿','Notes'))}${button('theme','moon',tr('主题','Theme'))}${button('print','print',tr('打印','Print'))}${button('toolbar','hideToolbar',tr('隐藏底栏','Hide toolbar'))}${button('help','help',tr('帮助','Help'))}</div>`;
    $<HTMLButtonElement>('[data-action="prev"]').disabled=current===0;
    $<HTMLButtonElement>('[data-action="next"]').disabled=current===count()-1;
    $('[data-action="appendix"]').setAttribute('aria-pressed',String(expanded));
    $('[data-action="theme"]').setAttribute('aria-pressed',String(document.body.classList.contains('dark')));
    $('[data-action="theme"]').setAttribute('aria-keyshortcuts','d');
    $('[data-action="theme"]').title=tr('切换深浅色（D）','Toggle light / dark (D)');
    const toolbarButton=$('#controls [data-action="toolbar"]');
    toolbarButton.setAttribute('aria-controls','controls');
    toolbarButton.setAttribute('aria-keyshortcuts','f');
    toolbarButton.title=tr('隐藏底栏（F）','Hide toolbar (F)');
    const restoreButton=$('#restore-controls');
    restoreButton.innerHTML=icon('showToolbar');
    restoreButton.title=tr('显示底栏（F）','Show toolbar (F)');
    restoreButton.setAttribute('aria-label',restoreButton.title);
    $('.skip').textContent=tr('跳到幻灯片','Skip to slide');
    try{history.replaceState(null,'',`#${deck.slides[current].id}`);}catch{/* file readers may restrict history */}
    $('#announcement').textContent=`${current+1} / ${count()}　${t(deck.slides[current].title).replaceAll('\n',' ')}`;
    resize();
  }
  function go(index: number) {
    current=Math.max(0,Math.min(index,count()-1));
    const wasNotes=$<HTMLDialogElement>('#notes').open;
    render();
    if(wasNotes)renderNotes();
    if(innerWidth<=700)window.scrollTo({top:0,behavior:'instant'});
  }
  function dialogHead(id: string,title: string) {return `<div class="dialog-head"><h2 id="${id}">${esc(title)}</h2>${button('close','close',tr('关闭','Close'))}</div>`;}
  function showOverview() {
    $<HTMLDialogElement>('#overview').innerHTML=dialogHead('overview-title',tr('汇报目录','Presentation contents'))+`<input class="overview-search" type="search" placeholder="${tr('搜索页面标题','Search slide titles')}" aria-label="${tr('搜索页面标题','Search slide titles')}">`+deck.sections.map((section,n)=>`<section class="overview-section"><h3>${esc(t(section))}</h3><div class="overview-grid">${deck.slides.map((s,i)=>s.section===n?`<button type="button" class="overview-item" data-goto="${i}" aria-current="${i===current}"><span class="overview-index">${i<deck.mainCount?String(i+1).padStart(2,'0'):'A'+(i-deck.mainCount+1)}</span><span>${esc(t(s.title)).replaceAll('\n',' ')}</span></button>`:'').join('')}</div></section>`).join('')+`<p id="search-empty" hidden>${tr('没有找到匹配页面。','No matching slides.')}</p>`;
    $<HTMLDialogElement>('#overview').showModal();
    $('.overview-search').focus();
  }
  function elapsed() {return timerAccumulated+(timerStart?Date.now()-timerStart:0);}
  function timerText() {const sec=Math.floor(elapsed()/1000);return `${Math.floor(sec/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;}
  function renderNotes() {
    const s=deck.slides[current], next=deck.slides[current+1];
    const cumulative=deck.slides.slice(0,current+1).reduce((sum,s)=>sum+(s.time||0),0);
    $<HTMLDialogElement>('#notes').innerHTML=dialogHead('notes-title',tr('讲稿与操作','Speaker notes & controls'))+`<h3 class="notes-title">${current+1}. ${esc(t(s.title)).replaceAll('\n',' ')}</h3><p class="notes-copy" lang="zh-CN">${esc(s.notes)}</p><div class="notes-meta"><span>${s.time?tr(`本页约 ${s.time} 秒　累计 ${Math.floor(cumulative/60)} 分 ${cumulative%60} 秒`,`Suggested ${s.time}s　Cumulative ${Math.floor(cumulative/60)}m ${cumulative%60}s`):tr('答辩备查页','Appendix for discussion')}</span><span class="timer" id="timer-value">${timerText()}</span></div><div class="notes-actions"><div class="control-group">${button('timer',timerStart?'pause':'play',timerStart?tr('暂停计时','Pause timer'):tr('开始计时','Start timer'),'outlined')}${button('reset-timer','reset',tr('重置','Reset'))}</div><div class="control-group">${button('prev','left',tr('上一页','Previous'),'outlined')}${button('next','right',tr('下一页','Next'),'primary')}</div></div>${next?`<p class="notes-meta">${tr('接下来：','Next: ')}${esc(t(next.title)).replaceAll('\n',' ')}</p>`:''}`;
  }
  function preparePrint() {
    $('#print-deck').innerHTML=deck.slides.map((s,i)=>renderSlide(s,i,true)).join('');
    $('#print-deck').setAttribute('aria-hidden',String(!document.body.classList.contains('print-mode')));
  }
  async function doPrint() {
    preparePrint();
    await Promise.all([...$('#print-deck').querySelectorAll('img')].map(img=>img.decode().catch(()=>{})));
    window.print();
  }
  async function action(name: string) {
    if(name==='prev')go(current-1);
    else if(name==='next')go(current+1);
    else if(name==='overview')showOverview();
    else if(name==='language'){lang=lang==='zh'?'en':'zh';render();}
    else if(name==='appendix'){expanded=!expanded;if(!expanded&&current>=deck.mainCount)current=deck.mainCount-1;render();if(expanded)showOverview();}
    else if(name==='notes'){renderNotes();$<HTMLDialogElement>('#notes').showModal();}
    else if(name==='theme'){document.body.classList.toggle('dark');render();}
    else if(name==='print')await doPrint();
    else if(name==='toolbar'){
      const hidden=document.body.classList.toggle('toolbar-hidden');
      $('#restore-controls').hidden=!hidden;
      $('#stage').focus({preventScroll:true});
      resize();
      $('#announcement').textContent=hidden?tr('底栏已隐藏，按 F 或点击右下角按钮恢复。','Toolbar hidden. Press F or use the bottom-right button to restore it.'):tr('底栏已显示。','Toolbar shown.');
    }
    else if(name==='help'){
      const rows=[['← / →',tr('上一页 / 下一页','Previous / next')],['Home / End',tr('首尾页','First / last')],['O',tr('目录与搜索','Contents and search')],['L',tr('切换中文 / English','Switch language')],['N',tr('打开中文讲稿','Open Chinese speaker notes')],['F',tr('隐藏 / 显示底栏','Hide / show toolbar')],['D',tr('切换深浅色','Toggle light / dark')],['B',tr('黑屏 / 恢复','Blank / restore')],['Esc',tr('关闭弹窗','Close dialog')],['P',tr(`打印全部 ${deck.slides.length} 页`,`Print all ${deck.slides.length} slides`)]];
      $<HTMLDialogElement>('#help').innerHTML=dialogHead('help-title',tr('播放帮助','Presentation help'))+`<table class="help-table">${rows.map(([key,label])=>`<tr><td><kbd>${key}</kbd></td><td>${label}</td></tr>`).join('')}</table><p style="margin-top:20px">${tr(`默认播放 ${deck.mainCount} 页主体。目录可直接跳转 ${deck.slides.length-deck.mainCount} 页备查。点击界面截图可放大查看。`,`The default route has ${deck.mainCount} main slides. Use Contents for the ${deck.slides.length-deck.mainCount} appendix slides. Select any screenshot to enlarge it.`)}</p><p class="material-links"><a href="${esc(material('script','FireLink-演讲稿.html'))}" target="_blank" rel="noopener">${tr('独立演讲稿','Speaker script (Chinese)')}</a><a href="${esc(material('script.pdf','FireLink-演讲稿.pdf'))}" target="_blank" rel="noopener">${tr('讲稿 PDF','Script PDF (Chinese)')}</a></p>`;
      $<HTMLDialogElement>('#help').showModal();
    }
    else if(name==='timer'){if(timerStart){timerAccumulated+=Date.now()-timerStart;timerStart=0;}else timerStart=Date.now();renderNotes();}
    else if(name==='reset-timer'){timerStart=0;timerAccumulated=0;renderNotes();}
  }
  document.addEventListener('click',event=>{
    if(document.body.classList.contains('blanked')){document.body.classList.remove('blanked');return;}
    const target=event.target instanceof Element ? event.target.closest('button') : null;if(!target)return;
    if(target.dataset.action==='close'){target.closest('dialog')?.close();return;}
    if(target.dataset.goto!==undefined){current=Number(target.dataset.goto);if(current>=deck.mainCount)expanded=true;$<HTMLDialogElement>('#overview').close();render();return;}
    if(target.dataset.image){$<HTMLDialogElement>('#lightbox').innerHTML=dialogHead('lightbox-title',target.dataset.imageTitle ?? '')+`<img src="${esc(src(target.dataset.image))}" alt="${esc(target.dataset.imageTitle)}">`;$<HTMLDialogElement>('#lightbox').showModal();return;}
    if(target.dataset.action)void action(target.dataset.action);
  });
  document.addEventListener('input',event=>{
    if(!(event.target instanceof HTMLInputElement)||!event.target.matches('.overview-search'))return;
    const q=event.target.value.toLocaleLowerCase().trim();
    for(const item of document.querySelectorAll<HTMLElement>('.overview-item'))item.hidden=!(item.textContent ?? '').toLocaleLowerCase().includes(q);
    for(const section of document.querySelectorAll<HTMLElement>('.overview-section'))section.hidden=![...section.querySelectorAll<HTMLElement>('.overview-item')].some(e=>!e.hidden);
    $('#search-empty').hidden=[...document.querySelectorAll<HTMLElement>('.overview-item')].some(e=>!e.hidden);
  });
  document.addEventListener('keydown',event=>{
    if(event.metaKey||event.ctrlKey||event.altKey||!(event.target instanceof Element))return;
    if(document.body.classList.contains('blanked')){event.preventDefault();document.body.classList.remove('blanked');return;}
    if(event.key==='Escape'&&document.querySelector<HTMLDialogElement>('dialog[open]')){event.preventDefault();document.querySelector<HTMLDialogElement>('dialog[open]')?.close();$('#stage').focus({preventScroll:true});return;}
    if(document.querySelector<HTMLDialogElement>('dialog[open]')||event.target.matches('input,textarea,select'))return;
    if(event.target.closest('button')&&(event.key===' '||event.key==='Enter'))return;
    if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();go(current+1);}
    else if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();go(current-1);}
    else if(event.key==='Home'){event.preventDefault();go(0);}
    else if(event.key==='End'){event.preventDefault();go(count()-1);}
    else {const shortcuts: Record<string, string>={o:'overview',l:'language',n:'notes',f:'toolbar',d:'theme',p:'print',h:'help','?':'help'};const name=shortcuts[event.key.toLowerCase()];if(name){event.preventDefault();void action(name);}else if(event.key.toLowerCase()==='b'){document.body.classList.add('blanked');}}
  });
  let touchStart: { x: number; y: number; target: Element | null } | null=null;
  $('#stage').addEventListener('touchstart',event=>{const p=event.touches[0];touchStart={x:p.clientX,y:p.clientY,target:event.target instanceof Element ? event.target : null};},{passive:true});
  $('#stage').addEventListener('touchend',event=>{
    if(!touchStart||touchStart.target?.closest('button,.table-wrap,.flow-nodes'))return;
    const p=event.changedTouches[0],dx=p.clientX-touchStart.x,dy=p.clientY-touchStart.y;
    if(Math.abs(dx)>90&&Math.abs(dx)>Math.abs(dy)*2)go(current+(dx<0?1:-1));touchStart=null;
  },{passive:true});
  window.addEventListener('resize',resize);
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>$('#stage').focus({preventScroll:true}));
  window.addEventListener('hashchange',()=>{const index=deck.slides.findIndex(s=>s.id===location.hash.slice(1));if(index>=0){if(index>=deck.mainCount)expanded=true;go(index);}});
  window.addEventListener('beforeprint',preparePrint);
  setInterval(()=>{const timer=document.querySelector('#timer-value');if(timer&&timerStart)timer.textContent=timerText();},1000);
  render();
  if(params.has('print')){document.body.classList.add('print-mode');preparePrint();}
  window.FIRELINK_PRESENTATION={go, setLanguage(value){lang=value==='en'?'en':'zh';render();},preparePrint,getState:()=>({current,lang,expanded,total:count()})};
})();
