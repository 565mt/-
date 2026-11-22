import {useEffect,useState,type FormEvent} from 'react'
import {desk,openConversation,mailDraft} from './SalesDesk'
type Row=Record<string,any>

export function quoteContext(){
 const p=new URLSearchParams(location.hash.split('?')[1]??'')
 return {conversation:p.get('conversation')??'',turn:p.get('turn')??''}
}
export default function QuoteFlow({conversation,turn}:{conversation:string;turn:string}){
 const [data,D]=useState<Row|null>(null),[selected,S]=useState(''),[saved,Q]=useState<Row|null>(null),[busy,B]=useState(false),[notice,N]=useState('')
 const path='sales/conversations/'+encodeURIComponent(conversation)
 useEffect(()=>{let live=true;desk(path+'/quote-context/'+encodeURIComponent(turn)).then(x=>{if(live){D(x);S(String(x.rows[0]?.id??''))}}).catch(e=>{if(live)N(e.message)});return()=>{live=false}},[path,turn])
 const row=data?.rows.find((r:Row)=>String(r.id)===selected)
 async function run(fn:()=>Promise<void>){B(true);N('');try{await fn()}catch(e){N((e as Error).message)}finally{B(false)}}
 function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!row)return;const v=Object.fromEntries(new FormData(e.currentTarget))
  void run(async()=>Q(await desk(path+'/draft-quote',{...v,turn,product_id:row.id,quantity:Number(v.quantity),unit_price:Number(v.unit_price)})))
 }
 return <><section><div className="listHead"><h2>对话选型与报价</h2><button className="sub" onClick={()=>openConversation(conversation)}>返回原对话</button></div>{notice&&<p role="alert">{notice}</p>}{data&&<><p><b>{data.name}</b> · {data.question}</p>{data.rows.length?<label>目录候选 <select aria-label="目录候选" value={selected} disabled={busy} onChange={e=>{S(e.target.value);Q(null)}}>{data.rows.map((r:Row)=><option key={r.id} value={r.id}>{r.model} · {r.catalog}{r.page?' · 第 '+r.page+' 页':''}</option>)}</select></label>:<p>暂无可报价的目录型号，可回到对话补充车桥、原件编号和尺寸。</p>}</>}</section>
 {row&&data&&<section><h2>{row.model}</h2><p>{[row.vehicle,row.dims_raw,row.catalog].filter(Boolean).join(' · ')}</p><p>{(row.reasons??[]).join(' · ')}</p>{row.cost?<p>对客参考单价 <b>{row.cost.customer_price||'待确认'} {row.cost.currency}</b> · MOQ {row.cost.moq} · 包装 {row.cost.packaging||'待确认'}</p>:<p>目录中暂无该型号的对客价格，请录入核准单价。</p>}
 {data.quantity&&row.cost&&data.quantity<row.cost.moq&&<p role="status">询盘数量低于 MOQ，请核对后再生成报价。</p>}
 <form key={row.id} onSubmit={save} onChange={()=>Q(null)}><label>数量（套） <input aria-label="报价数量" name="quantity" required type="number" min="1" max="10000000" defaultValue={data.quantity??''}/></label><label>对客单价 <input aria-label="对客单价" name="unit_price" required type="number" step="any" min=".000001" max="10000000" defaultValue={row.cost?.customer_price??''}/></label><label>币种 <select aria-label="报价币种" name="currency" defaultValue={row.cost?.currency??'USD'}>{Array.from(new Set(['USD','EUR','CNY',row.cost?.currency].filter(Boolean))).map(x=><option key={x}>{x}</option>)}</select></label><button disabled={busy}>生成报价草稿</button></form></section>}
 {saved&&<section><h2>对客报价草稿</h2><p className="reply customer-copy">{saved.message}</p><div className="actions"><button disabled={busy} onClick={()=>void run(async()=>{await desk(path+'/attach-quote',{quote_id:saved.id});openConversation(conversation)})}>带回原对话</button><a href={mailDraft(saved.email,'Quotation — '+row?.model,saved.message)}>打开邮件草稿</a><button className="sub" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(saved.message);N('已复制报价')})}>复制报价</button></div></section>}</>
}
