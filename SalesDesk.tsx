import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react'
type Row=Record<string,any>
export type User={username:string;role:'admin'|'sales'}
export async function desk(path:string,body?:unknown){
 const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)})
 const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'请求失败');return data
}
const labels={name:'客户名称',country:'市场',category:'类别',email:'邮箱',linkedin:'领英',buyer:'采购负责人',status:'状态',origin:'来源类型',notes:'备注'}
const time=(v:string)=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}){
 return <dialog open className="crm-dialog" aria-label={title} onKeyDown={e=>{if(e.key==='Escape')close()}}><section><h2>{title}</h2>{children}</section></dialog>
}
function AuthLayout({children}:{children:ReactNode}){
 return <main className="access-page">
  <div className="access-brand"><span className="access-mark" aria-hidden="true">K</span><b>冠英工作台</b></div>
  <div className="access-promo" aria-hidden="true">
   <div className="access-monogram"><span/><span/></div>
  </div>
  <div className="access-panel"><section className="access-card">{children}</section></div>
 </main>
}
export function AccountGate({children}:{children:(user:User,logout:()=>void)=>ReactNode}){
 const [user,U]=useState<User|null>(null),[ready,R]=useState(false)
 const [mode,M]=useState<'login'|'register'|'recover'>('login'),[role,Role]=useState<User['role']>('sales')
 const [notice,N]=useState(''),[recovery,C]=useState(''),[busy,B]=useState(false)
 const [captcha,H]=useState<Row|null>(null),[answer,A]=useState('')
 const requestId=useRef(0)

 async function challenge(){
  const id=++requestId.current
  A('');H(null)
  try{const value=await desk('account/captcha');if(id===requestId.current)H(value)}
  catch{if(id===requestId.current)N('验证码加载失败，请点击重试。')}
 }
 useEffect(()=>{desk('account/state').then(x=>{U(x.user);if(!x.user)void challenge()}).catch(e=>N(e.message)).finally(()=>R(true))},[])
 const change=(next:typeof mode)=>{M(next);N('');A('');if(!captcha)void challenge()}
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault()
  if(!captcha||busy)return
  if(!/^[a-z0-9]{5}$/i.test(answer.trim())){N('请输入图片中的 5 位验证码。');return}
  B(true);N('')
  const f=new FormData(e.currentTarget)
  try{
   const x=await desk('account/'+mode,{...Object.fromEntries(f),role,captcha_id:captcha.id,captcha:answer.trim(),remember:f.has('remember')})
   if(x.user)U(x.user)
   if(x.recovery)C(x.recovery)
   M('login')
   if(!x.user)void challenge()
  }catch(e){N((e as Error).message);void challenge()}
  finally{B(false)}
 }
 if(recovery)return <AuthLayout><h1>{user?'销售账号注册成功':'密码已重设'}</h1><p>请保存这组恢复码，以便忘记密码时使用。</p><p className="access-recovery"><strong>{recovery}</strong></p><button className="access-primary" onClick={()=>C('')}>{user?'进入销售工作台':'返回登录'}</button></AuthLayout>
 if(user)return children(user,()=>{void desk('account/logout',{}).then(()=>{U(null);Role('sales');M('login');void challenge()}).catch(e=>N(e.message))})
 const title=mode==='register'?'注册销售账号':mode==='recover'?'找回密码':'欢迎登录'
 const needsNewPassword=mode!=='login'
 return <AuthLayout>
  <header className="access-heading"><h1>{title}</h1>{mode==='login'&&<div className="access-role" aria-label="切换登录身份">{(['sales','admin'] as const).map(x=><button type="button" key={x} aria-pressed={role===x} disabled={busy} onClick={()=>{Role(x);N('')}}>{x==='sales'?'销售员':'管理员'}</button>)}</div>}</header>
  {notice&&<p role="alert" className="access-error">{notice}</p>}
  {ready&&<form className="access-form" key={mode} onSubmit={submit}>
   <label>账号<input required name="username" placeholder="输入账号" minLength={mode==='register'?2:undefined} maxLength={80} autoComplete="username"/></label>
   {mode==='recover'&&<label>密码恢复码<input required name="code" autoComplete="off"/></label>}
   <label>{mode==='recover'?'新密码':'密码'}<input name="password" required type="password" placeholder={needsNewPassword?'设置至少 10 位密码':'输入密码'} minLength={needsNewPassword?10:undefined} maxLength={200} autoComplete={needsNewPassword?'new-password':'current-password'}/></label>
   <div className="access-challenge"><label>图形验证码<input required name="captcha" placeholder="大小写均可" autoComplete="off" spellCheck={false} maxLength={5} value={answer} onChange={e=>A(e.target.value)}/></label><button type="button" className="access-captcha" aria-label="更换验证码" title="点击更换验证码" disabled={busy} onClick={()=>void challenge()}>{captcha?<img src={captcha.image} alt="图形验证码"/>:'获取验证码'}</button></div>
   {mode==='login'&&<label className="access-check"><input type="checkbox" name="remember"/>记住登录</label>}
   <button className="access-primary" disabled={busy||!captcha}>{busy?'正在提交…':mode==='register'?'创建销售账号':mode==='recover'?'重设密码':'登录'}</button>
   <div className="access-links">{mode==='login'?<><button type="button" disabled={busy} onClick={()=>change('register')}>注册销售账号</button><button type="button" disabled={busy} onClick={()=>change('recover')}>忘记密码</button></>:<button type="button" disabled={busy} onClick={()=>change('login')}>返回登录</button>}</div>
  </form>}
 </AuthLayout>
}
export function mailDraft(email:string,subject:string,body:string){
 const address=/^[^\s@?#&:<>]+@[^\s@?#&:<>]+$/.test(email)?email:''
 return 'mailto:'+encodeURIComponent(address)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body)
}
export function openConversation(id:string){location.hash='/communication?conversation='+encodeURIComponent(id)}
export async function sourceConversation(source:string,external:string|number,extra:Row={}){
 const row=await desk('sales/conversations',{source,external,...extra});openConversation(row.id)
}
export function SalesDesk({user}:{user:User}){
 const current=()=>new URLSearchParams(location.hash.split('?')[1]??'').get('conversation')??''
 const [key,K]=useState(current),[list,L]=useState<Row[]>([]),[row,R]=useState<Row|null>(null),[dialog,D]=useState(''),[busy,B]=useState(false),[notice,N]=useState(''),[modalError,E]=useState(''),[draft,T]=useState(''),[language,G]=useState('English'),[photo,P]=useState<File|null>(null)
 const scroll=useRef<HTMLDivElement>(null)
 useEffect(()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight},[row?.turns.length,row?.quotes?.length,row?.id,busy])
 async function refresh(){L(await desk('sales/conversations'))}
 useEffect(()=>{const read=()=>K(current());window.addEventListener('hashchange',read);void refresh().catch(e=>N(e.message));return()=>window.removeEventListener('hashchange',read)},[])
 useEffect(()=>{let live=true;R(null);T('');P(null);if(key)desk('sales/conversations/'+encodeURIComponent(key)).then(v=>{if(live){R(v);T(!v.turns.length?v.initial??'':'')}}).catch(e=>{if(live)N(e.message)});return()=>{live=false}},[key])
 async function action(fn:()=>Promise<void>){B(true);N('');E('');try{await fn()}catch(e){(dialog?E:N)((e as Error).message)}finally{B(false)}}
 function submit(fn:(v:Row)=>Promise<void>){return (e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));void action(()=>fn(values))}}
 function send(){if(!row||busy||(!draft.trim()&&!photo))return
  const data=new FormData();data.set('text',draft);data.set('language',language);if(photo)data.set('file',photo)
  void action(async()=>{const t=await desk('sales/conversations/'+row.id+'/turn',data);R({...row,turns:[...row.turns,t]});T('');P(null);await refresh()})
 }
 const [customerTarget,CustomerTarget]=useState<Row|null>(null)
 const [inquiries,I]=useState<Row[]>([]),[inquiryQuery,IQ]=useState('')
 const latest=row?.turns.at(-1)
 function begin(name:string){E('');if(name==='customer')CustomerTarget(row);D(name)}
 function addInquiry(){IQ('');I([]);begin('inquiry');void desk('sales/inquiries').then(I).catch(e=>E(e.message))}
 function saveFromCard(id:string){void action(async()=>{CustomerTarget(row?.id===id?row:await desk('sales/conversations/'+encodeURIComponent(id)));E('');D('customer')})}
 return <div className="desk-grid"><section className="desk-list"><div className="listHead"><h2>客户对话</h2><button disabled={busy} onClick={()=>begin('new')}>＋ 新建对话</button><button className="sub" disabled={busy} onClick={addInquiry}>添加询盘客户</button></div>{list.map(x=><article className={'desk-thread '+(x.id===key?'selected':'')} key={x.id}><button className="desk-thread-main" onClick={()=>openConversation(x.id)} disabled={busy}><b>{x.name}</b>{x.note&&<span>{x.note}</span>}<small>{time(x.updated)}{x.customer_id?' · 已保存客户':''}</small></button><button className="sub desk-save" disabled={busy} onClick={()=>saveFromCard(x.id)}>{x.customer_id?'更新客户信息':'保存客户信息'}</button></article>)}</section>
 <section className="desk-chat">{notice&&<p role="status">{notice}</p>}{row?<><div className="desk-chat-head"><h2>{row.name}</h2>{row.customer_id&&<a className="pill" href="#/customers">已保存客户</a>}</div><div ref={scroll} className="desk-turns" aria-live="polite">{row.turns.map((t:Row)=><div className="desk-turn" key={t.id}><div className="desk-ask">{t.question}{t.image&&<img src={t.image} alt="客户上传的制动部件图片"/>}</div><div className="desk-answer"><div className="desk-intent"><strong>购买意愿 {t.level} {t.score} 分</strong>{['明确采购','考虑采购'].includes(t.insights.intent)&&<b>{t.insights.recommendations.length?'已触发召回':'已触发召回 · 暂无匹配'}</b>}</div>{t.insights.translation!=='翻译暂不可用'&&<p><b>中文译文</b> {t.insights.translation}</p>}<p className="customer-copy">{t.reply}</p><button className="sub" onClick={()=>void action(async()=>{await navigator.clipboard.writeText(t.reply);N('已复制回复')})}>复制回复</button><button className="sub" disabled={busy} onClick={()=>{location.hash='/fitment?'+new URLSearchParams({conversation:row.id,turn:t.id})}}>智能报价</button></div></div>)}{(row.quotes??[]).map((q:Row)=><div className="desk-answer" key={'quote-'+q.id}><strong>待发送报价 · {q.model}</strong><p className="customer-copy">{q.message}</p><div className="actions"><button className="sub" onClick={()=>void action(async()=>{await navigator.clipboard.writeText(q.message);N('已复制报价')})}>复制报价</button><a href={mailDraft(q.email,'Quotation — '+q.model,q.message)}>打开邮件草稿</a></div></div>)}{busy&&<p>正在处理…</p>}</div><div className="desk-compose"><textarea aria-label="客户消息" placeholder="粘贴客户原话，Enter 生成回复，Shift+Enter 换行" value={draft} onChange={e=>T(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/><div className="actions"><label className="desk-file">上传图片<input key={String(photo===null)} aria-label="客户图片" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>P(e.target.files?.[0]??null)}/></label>{photo&&<small>{photo.name} <button type="button" className="sub" onClick={()=>P(null)}>移除图片</button></small>}<select aria-label="回复语言" value={language} onChange={e=>G(e.target.value)}>{['English','中文','Deutsch','Español','Français','Português'].map(x=><option key={x}>{x}</option>)}</select><button disabled={busy||(!draft.trim()&&!photo)} onClick={send}>生成回复</button></div></div></>:<div className="desk-empty"><h2>选择或新建客户对话</h2><p>粘贴客户消息或添加零件照片，即可生成回复草稿。</p></div>}</section>
 <section className="desk-assist"><h2>销售辅助</h2>{row&&<><button disabled={busy} onClick={()=>begin('customer')}>保存客户信息</button><button className="sub" disabled={busy} onClick={()=>begin('follow')}>新增跟进</button>{latest&&<><h3>本轮判断</h3><p><b>{latest.level} · {latest.score} 分</b> {latest.insights.reason}</p>{latest.model&&<small>模型 {latest.model}</small>}<p>{latest.insights.supplement}</p>{latest.observation&&<p><b>图片比对</b> {latest.observation}</p>}{latest.insights.recommendations.map((x:Row)=><div className="suggestion" key={x.id}><b>{x.model}</b><p>{x.vehicle} {x.dims_raw}</p><small>{x.catalog} {x.page?('第 '+x.page+' 页'):''}</small></div>)}</>}<h3>跟进记录</h3>{row.followups.length===0&&<p>暂无跟进。</p>}{row.followups.slice().reverse().map((x:Row,i:number)=><div className="suggestion" key={i}><b>{x.owner}</b><small> · {time(x.when)}</small><p>{x.content}</p></div>)}</>}</section>
 {dialog==='inquiry'&&<Modal title="添加询盘客户" close={()=>D('')}><div className="inquiry-picker"><input autoFocus aria-label="搜索询盘客户" placeholder="按客户名、邮箱或询盘内容搜索" value={inquiryQuery} onChange={e=>IQ(e.target.value)}/>{modalError&&<p role="alert">{modalError}</p>}{inquiries.filter(x=>[x.name,x.email,x.notes].some(v=>String(v??'').toLowerCase().includes(inquiryQuery.trim().toLowerCase()))).map(x=><div className="inquiry-option" key={x.id}><div><b>{x.name||'网站访客'}</b><small>{[x.email,x.country].filter(Boolean).join(' · ')}</small><p>{x.notes}</p></div><button className="sub" disabled={busy} onClick={()=>void action(async()=>{await sourceConversation('inquiry',x.id);await refresh();D('')})}>{x.conversation?'打开对话':'添加并打开'}</button></div>)}</div><button className="sub" disabled={busy} onClick={()=>D('')}>关闭</button></Modal>}
 {dialog&&dialog!=='inquiry'&&<Modal title={dialog==='new'?'新建客户对话':dialog==='customer'?'保存客户信息':'新增销售跟进'} close={()=>D('')}><form className="desk-form" onSubmit={submit(async v=>{
  if(dialog==='new'){const x=await desk('sales/conversations',v);await refresh();openConversation(x.id)}
  else if(dialog==='customer'&&customerTarget){const c=await desk('sales/conversations/'+customerTarget.id+'/customer',v);if(row?.id===customerTarget.id)R({...row,customer:c,customer_id:c.id});await refresh()}
  else if(dialog==='follow'&&row){const f=await desk('sales/conversations/'+row.id+'/followup',{...v,when:v.when?new Date(v.when).toISOString():''});R({...row,followups:[...row.followups,f]});await refresh()}
  D('')
 })}>{dialog==='new'?<><label>客户名称或公司<input name="name" required autoFocus/></label><label>来源与背景备注<textarea name="note"/></label></>:dialog==='customer'?Object.entries(labels).map(([k,label])=><label key={k}>{label}<input name={k} defaultValue={customerTarget?.customer?.[k]??customerTarget?.profile?.[k]??(k==='name'?customerTarget?.name:k==='origin'?(customerTarget?.source==='social'?'社媒线索':customerTarget?.source==='inquiry'?'网站询盘':'AI 沟通'):'')}/></label>):<><label>跟进人<input required name="owner" defaultValue={user.username}/></label><label>跟进时间<input name="when" type="datetime-local"/></label><label>跟进内容与备注<textarea name="content" required/></label></>}{modalError&&<p role="alert">{modalError}</p>}<div className="actions"><button disabled={busy}>保存</button><button type="button" className="sub" onClick={()=>D('')}>取消</button></div></form></Modal>}
 </div>
}
export function CustomerList({inquiries=false}:{inquiries?:boolean}){
 const [rows,S]=useState<Row[]>([]),[q,Q]=useState(''),[notice,N]=useState(''),[active,A]=useState<Row|null>(null)
 useEffect(()=>{S([]);desk('sales/'+(inquiries?'inquiries':'customers')).then(S).catch(e=>N(e.message))},[inquiries])
 function enter(r:Row){if(r.conversation)openConversation(r.conversation);else void sourceConversation(inquiries?'inquiry':'customer',r.id).catch(e=>N(e.message))}
 return <section><div className="listHead"><h2>{inquiries?'网站询盘':'客户档案'} · {rows.length}</h2><input aria-label="筛选记录" placeholder="搜索客户、市场或邮件" value={q} onChange={e=>Q(e.target.value)}/></div>{notice&&<p role="alert">{notice}</p>}<div className="overflow-x-auto"><table><thead><tr>{(inquiries?['客户名称','市场','邮箱','询盘内容','操作']:['客户名称','市场','类别','邮箱','领英','采购负责人','状态','来源类型','操作']).map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q.toLowerCase())).map(r=><tr key={r.id}>{(inquiries?['name','country','email','notes']:['name','country','category','email','linkedin','buyer','status','origin']).map(k=><td key={k}>{k==='notes'?<button className="sub" onClick={()=>A(r)}>查看原文</button>:r[k]||'—'}</td>)}<td><button className="sub" onClick={()=>enter(r)}>{r.conversation?'对话':inquiries?'开始回复':'创建跟进对话'}</button></td></tr>)}</tbody></table></div>{active&&<Modal title={active.name||'询盘详情'} close={()=>A(null)}><p className="customer-copy">{active.notes}</p><button onClick={()=>enter(active)}>开始回复</button></Modal>}</section>
}
export function AdminDesk(){
 const [data,D]=useState<Row|null>(null),[users,U]=useState<Row[]>([]),[message,M]=useState(''),[code,C]=useState('')
 async function refresh(){const [r,u]=await Promise.all([desk('sales/report'),desk('account/users')]);D(r);U(u)}
 useEffect(()=>{void refresh().catch(e=>M(e.message))},[])
 async function create(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;try{const account=await desk('account/register',Object.fromEntries(new FormData(form)));C(account.recovery);form.reset();await refresh()}catch(e){M((e as Error).message)}}
 return <>{message&&<p role="status">{message}</p>}<div className="metrics">{Object.entries(data?.metrics??{}).map(([k,v])=><article key={k}><span>{k}</span><strong>{String(v)}</strong></article>)}</div><section><h2>销售团队报表</h2><table><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>创建会话</th><th>跟进记录</th><th>操作</th></tr></thead><tbody>{users.map(u=>{const s=data?.sales.find((x:Row)=>x.username===u.username);return <tr key={u.username}><td>{u.username}</td><td>{u.role==='admin'?'管理员':'销售'}</td><td>{u.active?'启用':'已停用'}</td><td>{s?.conversations??0}</td><td>{s?.followups??0}</td><td>{u.role==='sales'&&<button className="sub" onClick={()=>void desk('account/users/access',{username:u.username,active:!u.active}).then(refresh).catch(e=>M(e.message))}>{u.active?'停用':'启用'}</button>}</td></tr>})}</tbody></table></section><section><h2>新增销售账号</h2><form className="desk-form" onSubmit={create}><label>销售账号<input name="username" required/></label><label>初始密码<input name="password" type="password" minLength={10} required autoComplete="new-password"/></label><button>创建销售</button></form>{code&&<p>请将恢复码安全交给该销售 <strong>{code}</strong></p>}</section></>
}

export function ManagementShell({user,logout}:{user:User;logout:()=>void}){
 const [view,V]=useState('report'),[message,M]=useState(''),[code,C]=useState('')
 async function change(e:FormEvent<HTMLFormElement>){
  e.preventDefault();M('');const f=e.currentTarget
  try{C((await desk('account/password',Object.fromEntries(new FormData(f)))).recovery);f.reset()}catch(e){M((e as Error).message)}
 }
 return <div className="layout admin-shell"><aside><div className="brand"><b>冠英管理后台</b></div><nav aria-label="管理导航"><button className={view==='report'?'active':''} onClick={()=>V('report')}>团队报表与账号</button><button className={view==='security'?'active':''} onClick={()=>V('security')}>安全设置</button></nav></aside><main><div className="top"><b>{view==='report'?'团队报表与账号':'安全设置'}</b><div className="actions"><span className="pill">{user.username} · 管理员</span><button className="sub" onClick={logout}>退出</button></div></div><div className="content">{view==='report'?<AdminDesk/>:<section><h2>修改管理员密码</h2><form className="desk-form" onSubmit={change}><label>当前密码<input type="password" name="current" autoComplete="current-password" required/></label><label>新密码<input type="password" name="password" minLength={10} autoComplete="new-password" required/></label><button>保存密码</button></form>{message&&<p role="alert">{message}</p>}{code&&<p>请保存新的密码恢复码 <strong>{code}</strong></p>}</section>}</div></main></div>
}
