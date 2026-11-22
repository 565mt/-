import {useEffect,useState,type FormEvent} from 'react'
import {createRoot} from 'react-dom/client'
import './style.css'
import {Sidebar} from './Navigation'
import {AccountGate,ManagementShell,CustomerList,SalesDesk,type User} from './SalesDesk'
import QuoteFlow,{quoteContext} from './QuoteFlow'
import Social from './Social'

const titles=['数据总览','全球客户搜索','客户管理','AI 智能沟通','智能产品选型','多语言术语库','产品知识库','智能报价','系统设置','海关数据看板','历史询盘','OE 交叉参考','成本与价格','社媒线索','客户管理','网站询盘','管理报表']
const icons=['▦','◎','♙','◇','⊞','译','▤','¥','⚙','↗','✉','⇄','◈','◎','♙','✉','▦']
const descriptions=['查看海外业务数据与核心流程。','按市场和采购方类型发现潜在客户。','沉淀客户线索，记录销售进展。','按客户询盘检索企业目录和价格，生成可发给客户的回复。','核对候选型号，并生成可发送的选型说明。','管理行业术语与各语种对应表达。','检索企业产品目录与上传资料。','根据目录型号与人工核定单价生成报价草稿。','查看后端集成与运行状态。','按日期、目的市场和 HS 编码分析贸易记录。','查看企业历史询盘。','维护外部编码与目录型号的对应关系。','维护 FOB 底价、MOQ、包装及参考运费。','从客户原话判断采购角色，选型报价，跟进至 CRM。']
const paths=['/','/search','/legacy-customers','/communication','/fitment','/terms','/products','/quotes','/settings','/customs','/inquiries','/oe-reference','/pricing','/social','/customers','/web-inquiries','/admin']
const groups=[
 {name:'获客与跟进',views:[13,14,15]},
 {name:'即时销售',views:[3,4,7]},
 {name:'产品资料',views:[6,11,12]}
].map(group=>({name:group.name,items:group.views.map(view=>({view,name:titles[view],icon:icons[view]}))}))
const visibleViews=new Set([...groups.flatMap(group=>group.items.map(item=>item.view)),16])
function currentView(){
 const path=location.hash.slice(1).split('?')[0]||location.pathname
 const view=paths.indexOf(path)
 return visibleViews.has(view)?view:13
}
type Row=Record<string,any>
const kinds:Record<number,string>={6:'product',7:'quote',11:'oe',12:'cost'}
const label:Record<string,string>={name:'名称',country:'市场',category:'类别',status:'状态',origin:'来源类型',notes:'备注',demand:'需求',model:'型号',vehicle:'车型',dims_raw:'尺寸（mm）',catalog:'目录',page:'页码',term:'术语',lang:'语言',meaning:'中文含义',quantity:'数量',unit_price:'单价',total:'金额',currency:'币种',basis:'依据'}
Object.assign(label,{email:'邮箱',phone:'手机',linkedin:'领英',buyer:'采购负责人',contact_source:'联系来源',title:'询盘标题',added_at:'时间',source:'来源',reference:'OE / 对手型号',fob:'FOB 底价',customer_price:'对客参考单价',moq:'MOQ',packaging:'包装',freight:'参考运费',score:'匹配分',reasons:'匹配依据'})
const columns:Record<string,string[]>={customer:['name','country','category','email','linkedin','buyer','status','origin'],term:['term','lang','meaning'],product:['model','vehicle','dims_raw','catalog','page','origin'],quote:['name','model','quantity','unit_price','total','currency','basis'],asset:['name','model','origin','count'],inquiry:['name','title','notes','email','phone','country','added_at','source'],oe:['reference','model','source'],cost:['model','fob','customer_price','currency','moq','packaging','freight']}
async function api(path:string, body?:unknown){
 const res=await fetch('/api/'+path, body===undefined?undefined:{method:'POST',headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)})
 if(!res.ok){const err=await res.json().catch(()=>({}));throw Error(typeof err.detail==='string'?err.detail:'请求失败，请检查输入或服务状态')}
 return res.json()
}
function App({user,logout}:{user:User;logout:()=>void}){
 const [tab,setTab]=useState(()=>currentView()===16&&user.role!=='admin'?13:currentView()),[result,R]=useState<Row>({}),[rows,S]=useState<Row[]>([]),[total,T]=useState(0),[query,Q]=useState(''),[page,P]=useState(1),[assets,A]=useState(false),[text,X]=useState(''),[form,F]=useState<Row>({}),[product,V]=useState<Row|null>(null),[notice,N]=useState(''),[busy,B]=useState(false),[rev,U]=useState(0)
 const [replyLang,L]=useState('English'),[draftReply,DR]=useState('')
 useEffect(()=>{const read=()=>setTab(currentView()===16&&user.role!=='admin'?13:currentView());window.addEventListener('popstate',read);window.addEventListener('hashchange',read);return ()=>{window.removeEventListener('popstate',read);window.removeEventListener('hashchange',read)}},[])
 const kind=tab===6&&assets?'asset':kinds[tab]
 function go(next:number){const path=paths[next];if(path)history.pushState(null,'','#'+path);setTab(next);DR('');R({});S([]);Q('');P(1);F({});N('')}
 async function run(fn:()=>Promise<void>){B(true);N('');try{await fn()}catch(e){N((e as Error).message)}finally{B(false)}}
 useEffect(()=>{
   let live=true
   const path=kind?'records/'+kind+'?q='+encodeURIComponent(query)+'&page='+page:''
   if(path)api(path).then(data=>{if(live){S(data.rows);T(data.total)}}).catch(e=>{if(live)N(e.message)})
   return ()=>{live=false}
 },[tab,kind,query,page,rev])
 function remove(kind:string,r:Row){
   if(!confirm('确认删除「'+(r.name??r.model??r.term??'此记录')+'」？'))return
   void run(async()=>{const response=await fetch('/api/records/'+kind+'/'+r.id,{method:'DELETE'})
     if(!response.ok)throw Error('删除失败')
     if(product?.id===r.id)V(null)
     if(form.id===r.id)F({})
     if(rows.length===1&&page>1)P(page-1)
     U(x=>x+1);N('已删除')
   })
 }
 function submit(fn:(values:Row, data:FormData)=>Promise<void>){return (e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(()=>fn(Object.fromEntries(data),data))}}
 const input=(key:string,placeholder:string,value='',type='text')=><input required name={key} placeholder={placeholder} aria-label={placeholder} defaultValue={value} type={type} step={type==='number'?'any':undefined}/>
 function table(list:Row[],keys:string[],action?:(r:Row)=>React.ReactNode){return <div className="overflow-x-auto"><table><thead><tr>{keys.map(k=><th key={k}>{label[k]||k}</th>)}{action&&<th>操作</th>}</tr></thead><tbody>{list.map((r,i)=><tr key={r.id??i}>{keys.map(k=><td key={k}>{String(r[k]??'—')}</td>)}{action&&<td>{action(r)}</td>}</tr>)}</tbody></table>{!list.length&&<p className="empty">暂无记录</p>}</div>}
 const linkedQuote=quoteContext()
 const choose=(r:Row)=>{V(r);go(7)}
 return <div className="layout sales-shell"><aside><div className="brand"><b>K</b><div>冠英工作台<small>KOOYING / OVERSEAS</small></div></div><Sidebar groups={groups} current={tab} onSelect={go}/><footer>浙江冠英 · 海外业务</footer></aside>
 <main><div className="top"><span>业务工作台 / {titles[tab]}</span><div className="actions"><span className="pill">{user.username} · {user.role==='admin'?'管理员':'销售'}</span><button className="sub" onClick={logout}>退出</button></div></div><div className="content"><header><h1>{titles[tab]}</h1><p>{descriptions[tab]}</p></header>
 {notice&&<div role="status" className="notice">{notice}</div>}
 {tab===13&&<Social/>}
 {tab===3&&<SalesDesk user={user}/>}
 {tab===14&&<CustomerList key="customers"/>}
 {tab===15&&<CustomerList key="inquiries" inquiries/>}
 {tab===4&&linkedQuote.conversation&&linkedQuote.turn&&<QuoteFlow key={linkedQuote.conversation+linkedQuote.turn} {...linkedQuote}/>}
 {tab===4&&(!linkedQuote.conversation||!linkedQuote.turn)&&<><section><form onSubmit={submit(async v=>R(await api('match',v)))}><textarea name="text" aria-label="询盘原文" required value={text} onChange={e=>X(e.target.value)} placeholder="输入车型、车桥、编码或尺寸"/><select aria-label="回复语言" value={replyLang} onChange={e=>L(e.target.value)}>{['English','中文','Deutsch','Español','Français','Português'].map(x=><option key={x}>{x}</option>)}</select><button disabled={busy}>检索候选型号</button></form></section>{result.rows&&<section><h2>匹配结果</h2><p>{result.basis}</p>{table(result.rows,['model','score','reasons','catalog','page','origin'],r=><div className="row-actions"><button className="sub" onClick={()=>run(async()=>{const d=await api('customer-reply',{product_id:r.id,language:replyLang,quantity:result.fields?.数量});DR(d.reply)})}>生成选型说明</button><button onClick={()=>choose(r)}>生成报价</button></div>)}</section>}</>}
 {draftReply&&(tab===3||tab===4)&&<section><h2>可发送的选型说明</h2><p className="reply customer-copy">{draftReply}</p><button onClick={()=>run(async()=>{await navigator.clipboard.writeText(draftReply);N('已复制选型说明')})}>复制选型说明</button></section>}
 {(tab===11||tab===12)&&<section><h2>{form.id?'编辑记录':'新增记录'}</h2><form key={form.id??'new'} onSubmit={submit(async v=>{await api('records/'+kind,{...form,...v});F({});U(x=>x+1);N('已保存')})}>{input('model','目录型号',form.model)}{tab===11?<>{input('reference','OE / 对手型号',form.reference)}{input('source','来源或校验依据',form.source)}</>:<>{input('fob','FOB 底价',form.fob,'number')}<input name="customer_price" type="number" min="0.01" step="any" aria-label="对客参考单价" placeholder="对客参考单价（选填）" defaultValue={form.customer_price}/>{input('moq','MOQ',form.moq,'number')}{input('packaging','包装',form.packaging)}{input('freight','参考运费',form.freight,'number')}<select name="currency" aria-label="币种" defaultValue={form.currency}><option>CNY</option><option>USD</option><option>EUR</option></select></>}<button disabled={busy}>保存</button>{form.id&&<button className="sub" type="button" onClick={()=>F({})}>取消编辑</button>}</form></section>}
 {tab===6&&<section><h2>上传资料</h2><form onSubmit={submit(async(v,data)=>{const uploaded=await api('upload?model='+encodeURIComponent(v.model),data);Q('');P(1);A(uploaded.count===0);U(rev+1);N('上传完成 · 产品 '+uploaded.count+' 条 · PDF '+uploaded.pages+' 页')})}><input name="file" aria-label="资料文件" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.json,.jsonl" required/><input name="model" aria-label="关联型号" placeholder="关联型号（图片可选）"/><button disabled={busy}>上传</button></form><div className="actions"><button className={assets?'sub':''} onClick={()=>{A(false);Q('');P(1)}}>产品目录</button><button className={assets?'':'sub'} onClick={()=>{A(true);Q('');P(1)}}>资料文件</button></div></section>}
 {tab===7&&<section><h2>新建报价草稿</h2>{product?<><p>{product.model} · {product.catalog} · {product.origin}</p>{product.cost&&<p>FOB 底价 {product.cost.fob} {product.cost.currency} · MOQ {product.cost.moq} · 包装 {product.cost.packaging} · 参考运费 {product.cost.freight}</p>}<form onSubmit={submit(async v=>{const r=await api('quote',{...v,product_id:product.id,quantity:Number(v.quantity),unit_price:Number(v.unit_price)});U(rev+1);N('草稿已保存 · '+r.total+' '+r.currency)})}>{input('name','客户名称')}{input('quantity','数量',String(product.cost?.moq??300),'number')}{input('unit_price','人工核定单价',String(product.cost?.customer_price??''),'number')}<select name="currency" aria-label="币种" defaultValue={product.cost?.currency}><option>CNY</option><option>USD</option><option>EUR</option></select><button disabled={busy}>计算并保存</button><button type="button" className="sub" onClick={()=>go(6)}>更换型号</button></form></>:<button onClick={()=>go(6)}>从产品目录选择</button>}</section>}
 {kind&&<section><div className="listHead"><h2>{tab===7?'报价记录':assets?'资料文件':tab>=10?titles[tab]:'产品目录'}</h2><input aria-label="筛选记录" placeholder="筛选记录" value={query} onChange={e=>{Q(e.target.value);P(1)}}/></div>{table(rows,columns[kind],r=><div className="row-actions">{['oe','cost'].includes(kind)&&<button className="sub" onClick={()=>F(r)}>编辑</button>}{kind==='product'&&<button className="sub" onClick={()=>choose(r)}>报价</button>}{kind==='asset'&&<a href={'/api/assets/'+r.id}>下载</a>}{r.id&&<button disabled={busy} className="danger" onClick={()=>remove(kind,r)}>删除</button>}</div>)}<div className="pager"><button disabled={page<=1} className="sub" onClick={()=>P(page-1)}>上一页</button><span>第 {page} 页 · 共 {total} 条</span><button disabled={page*20>=total} className="sub" onClick={()=>P(page+1)}>下一页</button></div></section>}
 </div></main></div>
}
createRoot(document.getElementById('root')!).render(<AccountGate>{(user,logout)=>user.role==='admin'?<ManagementShell user={user} logout={logout}/>:<App user={user} logout={logout}/>}</AccountGate>)
