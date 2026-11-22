import {useEffect,useState,type FormEvent} from 'react'
type Pair=[string,number]
type Result={total:number;market_count:number;buyer_count:number;months:Pair[];top:Pair[];markets:string[];sync_enabled:boolean;rows:Record<string,string>[]}
export default function CustomsDashboard(){
 const [result,R]=useState<Result>(),[filter,F]=useState(''),[revision,U]=useState(0),[message,M]=useState(''),[busy,B]=useState(false)
 useEffect(()=>{const controller=new AbortController()
   fetch('/api/customs/dashboard?'+filter,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.detail);R(data)}).catch(e=>{if(e.name!=='AbortError')M(e.message)})
   return ()=>controller.abort()
 },[filter,revision])
 async function action(path:string,body?:FormData){B(true);M('');try{
   const r=await fetch('/api/customs/'+path,{method:'POST',body});const data=await r.json()
   if(!r.ok)throw Error(data.detail)
   M('已入库 '+data.added+' 条，重复 '+data.duplicates+' 条');U(x=>x+1)
 }catch(e){M((e as Error).message)}finally{B(false)}}
 async function remove(id:string){
   if(!confirm('确认删除这条海关记录？'))return
   B(true);M('')
   try{const r=await fetch('/api/customs/records/'+id,{method:'DELETE'});if(!r.ok)throw Error('删除失败');U(x=>x+1);M('已删除')}
   catch(e){M((e as Error).message)}finally{B(false)}
 }
 function filterRows(e:FormEvent<HTMLFormElement>){e.preventDefault();M('');F(new URLSearchParams([...new FormData(e.currentTarget)].map(([k,v])=>[k,String(v)])).toString())}
 function bars(data:Pair[]){const max=Math.max(1,...data.map(([,n])=>n));return data.length?<div className="chart-bars">{data.map(([name,n])=><div key={name}><span>{name}</span><progress aria-label={name} value={n} max={max}/><strong>{n}</strong></div>)}</div>:<p>暂无符合条件的记录</p>}
 return <>
 <section><h2>海关数据接入</h2><form onSubmit={e=>{e.preventDefault();void action('import',new FormData(e.currentTarget))}}><input required name="file" type="file" accept=".csv,.xlsx" aria-label="海关导出文件"/><button disabled={busy}>导入海关数据</button>{result?.sync_enabled&&<button type="button" className="sub" disabled={busy} onClick={()=>void action('sync')}>同步授权接口</button>}</form><p>支持 CSV、XLSX。日期和目的市场为必填列。</p>{message&&<p role="status">{message}</p>}</section>
 <section><h2>筛选</h2><form onSubmit={filterRows}><select name="market" aria-label="目的市场"><option value="">所有市场</option>{result?.markets.map(m=><option key={m}>{m}</option>)}</select><input name="hs" placeholder="HS 编码" aria-label="HS 编码"/><input type="date" name="start" aria-label="开始日期"/><input type="date" name="end" aria-label="结束日期"/><button>应用筛选</button><button type="reset" className="sub" onClick={()=>{F('');M('')}}>重置</button></form></section>
 {result&&<><div className="metrics">{[['贸易记录',result.total],['目的市场',result.market_count],['采购商',result.buyer_count]].map(([label,n])=><article key={label}><span>{label}</span><strong>{n}</strong></article>)}</div>
 <div className="customs-charts"><section><h2>月度贸易记录</h2>{bars(result.months)}</section><section><h2>目的市场排名</h2>{bars(result.top)}</section></div>
 <section><h2>最近 25 条记录</h2><div className="overflow-x-auto"><table><thead><tr>{['日期','目的市场','HS 编码','采购商','商品','来源','操作'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{result.rows.map(r=><tr key={r.id}>{['date','market','hs','buyer','product','source'].map(k=><td key={k}>{r[k]||'—'}</td>)}<td><button className="danger" disabled={busy} onClick={()=>void remove(r.id)}>删除</button></td></tr>)}</tbody></table></div>{!result.rows.length&&<p>导入海关记录后显示明细与统计。</p>}</section></>}
 </>
}
