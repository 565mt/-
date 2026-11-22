export type NavItem={name:string;icon:string;view:number}
export type NavGroup={name:string;items:NavItem[]}
export function Sidebar({groups,current,onSelect}:{groups:NavGroup[];current:number;onSelect:(view:number)=>void}){
 return <nav aria-label="工作台导航">{groups.map(group=><div className="nav-group" key={group.name}><div className="nav-group-label">{group.name}</div>{group.items.map(item=><div key={item.view} className="nav-node"><button aria-current={current===item.view?'page':undefined} className={current===item.view?'active':''} onClick={()=>onSelect(item.view)}><span aria-hidden="true">{item.icon}</span>{item.name}</button></div>)}</div>)}</nav>
}
