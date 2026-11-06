import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deck } from './content.ts';
const root=path.dirname(fileURLToPath(import.meta.url));
const entities: Record<string, string> = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc=(s: unknown)=>String(s).replace(/[&<>"']/g,c=>entities[c]);
const mmss=(s: number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
const actions=[
 '上台前打开封面，按 D 选择深浅色，按 F 隐藏底栏。开始讲述时看向听众，介绍两位成员。讲完按右方向键。',
 '保持整页显示，依次指向“需求说清楚”“匹配有依据”“联系有边界”。末句强调通过后的交接，再翻页。',
 '按表格从上往下概括，不逐字读完。重点停在“用户旅程”和“页面流程”两项，为后面的内容铺垫。',
 '从左向右讲三类信息问题，每一列停顿一下。说到“对应”时，把三个问题与下一步的服务设计连接起来。',
 '先指左侧 FireLink 内完成的工作，再指右侧已有渠道。用最后一句明确服务完成点，再翻页。',
 '依次介绍三类角色。指向末行的需求方，再回到组织者一行，说明需求经组织者转化为任务。',
 '沿五个阶段从左向右移动指针。每阶段只说一个行为和一个疑问，读到结果阶段后停顿两秒。',
 '先纵向介绍三层，再横向以“审核确认”这一列举例。讲完后指向底部服务证据链。',
 '先沿上方组织者路径讲一遍，再沿下方志愿者路径讲一遍。最后点出撤回、未通过和过期三个结果分支。',
 '按导航顺序概括五个入口。末句说“下面用实际界面看这些工作如何完成”，然后翻到截图部分。',
 '保持幻灯片视图。指向截图里的事件筛选、排序和草稿入口，随后指向右侧三条设计说明。无需打开工作台。',
 '指向两个事件及其关联任务，说明事件与任务的层级关系。地图作为位置背景简要带过。',
 '点击左侧截图放大。先指向通用资料分组，再指向“自定义资料”里的“可参与时段”和“相关支援经验”。说明这两个问题将在报名时填写，并留意右侧任务内容预览。按 Esc 返回后翻页。',
 '保持整页显示，按“工作内容—参与条件—行动边界”讲清任务文案如何支持判断。时间够时可点击截图查看全文，再按 Esc 返回。',
 '点击截图放大。先指左侧申请队列，再指右侧“可参与时段”和“相关支援经验”的答案，与第 13 页的两个问题对应。向下查看联系方式说明、回应、内部备注与“通过并通知”。按 Esc 返回后翻页。',
 '沿“联系方式”这一行从待审核讲到通过。重点指向“通过且具备访问权限”列，再点出底部授权要求锁定。',
 '先讲报名截止，再讲任务结束；刻意在两个词之间停顿。最后用“刚撤回却被旧页面通过”举例说明状态校验。',
 '从左向右展示任务、授权和结果三张客户端截图。保持整页即可，不切换应用。',
 '指向通知页，再看右侧三条说明。用“接下来沿用组织已有渠道”完成主流程讲解。',
 '指向色板、深色界面以及状态文字。说明组件、颜色和交互习惯的一致性即可，不在现场切换主题。',
 '从表格左列问题讲到中列改进，选“窄屏与大字号”作例子。右列只概括评价方法。',
 '自上而下指向三层结构。强调双端共享业务规则，不展开框架或数据库实现细节。',
 '先报 49 和 4 两项实际测试结果，再举自定义资料必填、答案快照和授权披露的例子。补充新版资料界面的桌面、手机与无障碍检查已通过。',
 '从左向右讲验证服务、优化任务表达和机构试点。始终围绕招募、匹配与联系交接展开。',
 '看向听众，慢一点讲总结。讲完按右方向键，进入 FireLink 结束页。',
 '停留在居中显示 FireLink 的结束页，致谢并等待提问。进入答辩时按 O 打开目录，选择对应备查页；右方向键在主体末页会停止。'
];
const cautions: Record<number, string>={
  3:'若被问及 UX Manual：目前能够提供的依据是课程简报和实现材料，尚未取得完整手册，因此不能宣称完成其全部条目的核对。',
  4:'这三类问题来自课程情境和双角色任务分析，是待验证的设计假设。没有正式访谈、问卷和用户实验结果时，不将其表述为已证实的用户痛点。',
  5:'若被问及现场调度：说明本次原型专注外围支援的招募、审核与授权联系，后续现场工作仍需专业组织和现有机制负责。',
  12:'事件、组织和人员均是合成演练数据，地理底图是位置说明，不对应真实灾情。',
  16:'技能、装备与身份资料辅助组织者判断，不能把系统中的审核通过说成专业资质认证或火场准入。',
  18:'这些移动端图像来自仓库已有演示场景；它们展示相同产品流程，与本轮组织者演练截图不是同一组事件数据。',
  19:'已通过者的安排变化由组织通过既有渠道确认。当前实现对待审核申请发送任务更新通知；不要说成所有后续变化都由系统触达已通过者。',
  21:'现有材料包括设计评审和工程检查，不包含正式的目标用户可用性实验。说明检查范围和局限即可。',
  23:'49 项对应 server/test/organizer.test.ts 与 api.test.ts 的相关测试；4 项对应 organizer/test/theme.test.ts。自定义资料的界面检查来自 organizer/test/ux-browser.ts。以上结果仅代表本地指定场景，不构成完整无障碍认证或真实灾害现场验证。',
  24:'试点、样本人数、机构合作与商业模式是下一步方案。没有真实合作与收入数据时，不增加客户、报价或效率提升百分比。'
};
let elapsed=0;
const main=deck.slides.slice(0,deck.mainCount).map((s,i)=>{
 const start=elapsed;elapsed+=s.time ?? 0;
 return `<section class="note" id="slide-${i+1}"><div class="note-top"><span>第 ${String(i+1).padStart(2,'0')} 页</span><span>${mmss(start)}–${mmss(elapsed)}　约 ${s.time} 秒</span></div><h2>${esc(s.title.zh).replaceAll('\n','')}</h2><div class="operation"><h3>操作</h3><p>${esc(actions[i])}</p></div><h3>讲述参考</h3><p class="speech">${esc(s.notes)}</p>${cautions[i+1]?`<details><summary>答辩时可补充</summary><p>${esc(cautions[i+1])}</p></details>`:''}</section>`;
}).join('');
const appendix=deck.slides.slice(deck.mainCount).map((s,i)=>`<section class="note appendix"><div class="note-top"><span>备查 A${i+1}　幻灯片第 ${i+deck.mainCount+1} 页</span><span>按需使用</span></div><h2>${esc(s.title.zh).replace('备查｜','')}</h2><div class="operation"><h3>操作</h3><p>按 O 打开目录，搜索“${esc(s.title.zh.replace('备查｜','').slice(0,6))}”或直接选备查 A${i+1}。关闭目录后讲解；需要回结论时再按 O，选择第 25 页。</p></div><h3>回答要点</h3><p class="speech">${esc(s.notes)}</p></section>`).join('');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FireLink 结题演讲稿与操作提示</title><style>
:root{color-scheme:light;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1a1b20;background:#f3f3fa}*{box-sizing:border-box}body{margin:0;line-height:1.8}.document{max-width:900px;margin:0 auto;padding:58px 48px}h1{font-size:38px;line-height:1.35;margin:15px 0 22px;letter-spacing:-.03em}h2{font-size:25px;line-height:1.4;margin:12px 0 22px}h3{font-size:16px;margin:0 0 8px;color:#2b4678}p{margin:0 0 15px}.identity{font-size:17px;color:#445e91}.intro{margin:28px 0 38px;padding:25px;background:#d8e2ff;border-radius:16px}.intro ul{margin:8px 0;padding-left:22px}.note{padding:32px 0;border-top:1px solid #c4c6d0;break-inside:avoid}.note-top{display:flex;justify-content:space-between;gap:20px;font-size:14px;color:#44474f;font-variant-numeric:tabular-nums}.operation{padding:18px 22px;border-radius:12px;background:#eeedf4;margin-bottom:24px}.operation p{margin:0;font-size:16px}.speech{font-size:18px;text-align:justify}details{margin-top:20px;font-size:14px;color:#44474f}summary{cursor:pointer;color:#445e91}details p{margin-top:12px}a{color:#445e91;text-underline-offset:3px}.toc{display:grid;grid-template-columns:1fr 1fr;gap:9px 20px;margin:24px 0 40px;font-size:14px}.section-title{font-size:30px;margin:48px 0 15px}.print{border:0;border-radius:999px;background:#445e91;color:white;padding:12px 22px;font:inherit;cursor:pointer}.metadata{font-size:14px;color:#44474f}.appendix{padding:25px 0}.appendix .speech{font-size:16px}@media(max-width:600px){.document{padding:30px 22px}h1{font-size:30px}.toc{grid-template-columns:1fr}.note-top{font-size:12px}.speech{font-size:17px}}@page{size:A4;margin:18mm 17mm}@media print{:root,html,body{background:white!important}.document{max-width:none;padding:0}.print{display:none}.toc{font-size:11px;gap:3px 12px;line-height:1.7}.note{padding:19px 0}.note-top{font-size:10px}h1{font-size:29px}h2{font-size:19px;margin:8px 0 14px}h3{font-size:12px}.speech{font-size:12.5px;line-height:1.9}.operation{padding:12px 15px;margin-bottom:14px}.operation p{font-size:11px;line-height:1.7}details{font-size:10px;line-height:1.6}details>summary{display:block}details>p{display:block!important}.intro{font-size:12px;padding:18px;margin:20px 0}.metadata{font-size:10px}.section-title{break-before:page}.appendix .speech{font-size:12px}.operation,.intro{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main class="document"><p class="identity">FireLink</p><h1>结题演讲稿<br>逐页话术与操作提示</h1><p>${esc(deck.authors)}</p><p class="metadata">对应 ${deck.mainCount} 页主体与 ${deck.slides.length-deck.mainCount} 页备查。主体建议 ${mmss(elapsed)}，预留 ${mmss(1200-elapsed)} 给停顿、放大截图和现场衔接。正文按中文口述编写，幻灯片可切换英文。</p><button class="print" onclick="window.print()">打印讲稿</button><div class="intro"><h2>上台前准备</h2><ul><li>双击打开同目录的 <strong>FireLink-结题汇报.html</strong>。默认中文，主体从第 1 页开始。</li><li>需要英文时按 <strong>L</strong> 切换。<strong>D</strong> 切换深浅色，<strong>F</strong> 隐藏或显示底栏，右下角按钮也可恢复底栏。右方向键翻到下一页，左方向键返回。</li><li>将本讲稿放在手机、纸质稿或另一块屏幕上。投影主屏保持幻灯片；N 键会在同一屏幕显示讲稿。</li><li>第 13、15 页安排了静态截图放大。点击截图后滚动查看，按 <strong>Esc</strong> 返回。无需运行应用或模拟器。</li><li>第 26 页是 FireLink 结束页。答辩时按 <strong>O</strong> 打开目录，直接选择备查页。若浏览器无法使用，打开对应语言的 PDF。</li></ul></div><h2>讲述节奏</h2><p>前 5 页交代问题与定位，第 6–9 页讲服务流程，第 10–19 页重点展示工作台及双端衔接，第 20–24 页讲设计、实现与深化方向，第 25 页收束，第 26 页停留致谢。表格用于辅助讲解，按下面的话术概括即可。</p><nav class="toc">${deck.slides.slice(0,deck.mainCount).map((s,i)=>`<a href="#slide-${i+1}">${String(i+1).padStart(2,'0')}　${esc(s.title.zh).replaceAll('\n','')}</a>`).join('')}</nav>${main}<h2 class="section-title">答辩备查话术</h2><p>以下页面按提问选择。先给结论，再指向页面上的实现依据或流程。</p>${appendix}<p class="metadata">生成于 2026-11-04。时长为排练参考，建议完整计时演练一次。成员分工、班级与指导教师信息可按实际情况补充。</p></main><script>addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(x=>x.open=true));</script></body></html>`;
await writeFile(path.join(root,'FireLink-演讲稿.html'),html);
const markdown=deck.slides.map(s=>`## ${s.title.zh.replaceAll('\n','').trim()}\n\n${s.notes.trim()}`).join('\n\n')+'\n';
await writeFile(path.join(root,'FireLink-演讲稿.md'),markdown);
console.log(`Created speaker script with ${deck.mainCount} spoken sections, ${deck.slides.length-deck.mainCount} appendix cues, ${mmss(elapsed)} planned runtime.`);
