import {useState,type FormEvent} from 'react'
import {desk} from './SalesDesk'

type Lead={name:string;country:string;category:string;demand:string;notes:string;url?:string;origin:string;email?:string;linkedin?:string}
type Results={keywords:string[];leads:Lead[]}
export default function GlobalLeadSearch({onAdded}:{onAdded:(id:string)=>Promise<void>}){
 const [results,R]=useState<Results|null>(null),[busy,B]=useState(false),[notice,N]=useState(''),[added,A]=useState<string[]>([])
 async function search(e:FormEvent<HTMLFormElement>){
  e.preventDefault();B(true);N('');R(null);A([])
  try{R(await desk('search',Object.fromEntries(new FormData(e.currentTarget))))}
  catch(e){N((e as Error).message)}finally{B(false)}
 }
 async function add(row:Lead,key:string){
  B(true);N('')
  try{const saved=await desk('social/inbox/search-result',row);await onAdded(saved.id);A(prev=>[...prev,key]);N('已加入线索收件箱')}
  catch(e){N((e as Error).message)}finally{B(false)}
 }
 return <details className="sales-intake global-lead-search">
  <summary>全球客户搜索</summary>
  <form onSubmit={search}><label>目标国家或地区<input name="country" required placeholder="例如德国、越南或巴西"/></label><label>产品<input name="product" required defaultValue="商用车刹车片"/></label><label>目标客户<input name="target" required defaultValue="车队采购"/></label><button disabled={busy}>{busy?'处理中…':'搜索潜在客户'}</button></form>
  {notice&&<p role="status">{notice}</p>}
  {results&&<><p>{results.leads.length} 条结果 · {results.keywords.join(' / ')}</p>{!results.leads.length&&<p>暂无匹配线索。</p>}{results.leads.map(row=>{
   const key=row.url||row.name
   return <article className="search-lead" key={key}><div><b>{row.name}</b><p>{row.country} · {row.category} · {row.origin}</p><p>{row.notes||row.demand}</p>{row.email&&<p>{row.email}</p>}{row.url&&<a href={row.url} target="_blank" rel="noreferrer">查看来源</a>}</div><button className="sub" disabled={busy||added.includes(key)} onClick={()=>void add(row,key)}>{added.includes(key)?'已加入':'加入收件箱'}</button></article>
  })}</>}
 </details>
}
