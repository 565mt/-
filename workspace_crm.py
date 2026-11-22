import base64
import os
import re
import json
import hmac
from collections import Counter
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, UploadFile
from sqlalchemy import JSON, Column, MetaData, String, Table, insert, literal, select, text as sql_text, update
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

CUSTOMER_FIELDS = dict(name="客户名称",country="市场",category="类别",email="邮箱",linkedin="领英",buyer="采购负责人",status="状态",origin="来源类型",notes="备注")
SOURCES={"social","inquiry","customer"}

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def install_crm(app,engine,records,items,communication,photo,match,quote):
    router=APIRouter(prefix="/api/sales")
    meta=MetaData()
    chats=Table("sales_conversations",meta,Column("id",String(100),primary_key=True),Column("body",JSON,nullable=False))
    meta.create_all(engine)

    def read(con,key):
        row=con.execute(select(chats.c.body).where(chats.c.id==key)).scalar_one_or_none()
        if row is None: raise HTTPException(404,"会话不存在")
        return row

    def all_chats():
        with engine.connect() as con:return list(con.execute(select(chats.c.body)).scalars())

    def record(con,kind,key):
        return con.execute(select(records.c.body).where(records.c.kind==kind,records.c.id==key)).scalar_one_or_none()

    def write(con,key,old,new):
        result=con.execute(update(chats).where(chats.c.id==key,chats.c.body.cast(String)==literal(old,type_=JSON).cast(String)).values(body=new))
        if not result.rowcount:raise HTTPException(409,"会话已更新，请刷新后重试")
        return new

    @router.get("/conversations")
    def list_chats():
        return sorted(({k:v for k,v in r.items() if k!="turns"} for r in all_chats()),key=lambda r:r["updated"],reverse=True)

    @router.post("/conversations")
    def create(body:dict,request:Request):
        source=str(body.get("source") or "")
        external=str(body.get("external") or "")
        name=str(body.get("name") or "").strip()[:200]
        note=str(body.get("note") or "").strip()[:2000]
        initial=""
        profile={}
        customer_id=None
        if source in {"inquiry","customer"}:
            if not external.isdecimal():raise HTTPException(422,"来源编号无效")
            with engine.connect() as con:entry=record(con,source,int(external))
            if not entry:raise HTTPException(404,"来源记录不存在")
            name=entry.get("name") or entry.get("email") or "客户"
            note=note or ("网站历史询盘" if source=="inquiry" else "客户管理")
            initial=entry.get("notes","") if source=="inquiry" else ""
            customer_id=entry.get("customer_id") if source=="inquiry" else int(external)
            if source=="inquiry":
                profile={k:entry.get(k,"") for k in ("email","country")}
                profile["origin"]="网站询盘"
        if source=="social":
            with engine.connect() as con:
                stored=con.execute(sql_text("SELECT body FROM social_inbox WHERE id=:id"),{"id":external}).scalar_one_or_none()
            if not stored:raise HTTPException(404,"社媒线索不存在")
            entry=json.loads(stored) if isinstance(stored,str) else stored
            name,initial=entry["author"],entry["text"]
            note=entry["channel"]+" · "+entry["origin"]
            profile=dict(entry.get("contact") or {},origin=entry["channel"])
            if entry["channel"]=="全球搜索":initial=""
        if not name:raise HTTPException(422,"请输入客户名或公司")
        key=source+"-"+external if source in SOURCES and external else uuid4().hex
        row=dict(id=key,name=name,note=note,initial=initial or str(body.get("initial",""))[:10000],source=source or "AI 沟通",
                 customer_id=customer_id,profile=profile,turns=[],followups=[],updated=now(),owner=request.state.user["username"])
        try:
            with engine.begin() as con:con.execute(insert(chats).values(id=key,body=row))
        except IntegrityError:
            with engine.connect() as con:return read(con,key)
        return row

    @router.get("/conversations/{key}")
    def get(key:str):
        with engine.connect() as con:
            row=read(con,key)
            return dict(row,customer=record(con,"customer",row["customer_id"]) if row.get("customer_id") else None)

    @router.post("/conversations/{key}/turn")
    async def turn(key:str, request:Request, file:UploadFile|None=None):
        form=await request.form()
        text=str(form.get("text","")).strip()[:10000]
        language=str(form.get("language","English"))
        if language not in ("English","中文","Deutsch","Español","Français","Português"):language="English"
        with engine.connect() as con:row=read(con,key)
        observation=""
        image=None
        photo_rows=[]
        if file:
            raw=await file.read(3*1024*1024+1)
            if len(raw)>3*1024*1024:raise HTTPException(413,"图片最大 3 MB")
            await file.seek(0)
            from PIL import Image
            import io
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    mime={"JPEG":"image/jpeg","PNG":"image/png","WEBP":"image/webp"}.get(im.format)
                    if not mime or im.width*im.height>25000000:raise ValueError()
                    im.verify()
            except (ValueError,OSError,Image.DecompressionBombError):
                raise HTTPException(422,"请上传有效的 JPG、PNG 或 WebP") from None
            image="data:"+mime+";base64,"+base64.b64encode(raw).decode()
            result=await photo(file,vision=bool(os.getenv('SOCIAL_VISION_MODEL')))
            photo_rows=result["rows"]
            observation="样图候选 "+", ".join(r["model"] for r in photo_rows) if photo_rows else "暂无近似样图"
            if result.get("observation"):observation+=" · "+result["observation"]
        if not (text or image):raise HTTPException(422,"请输入客户原话或上传图片")
        prompt=text or ("Please help identify the brake part shown in the customer photo." if language!="中文" else "请帮客户核对图片中的制动部件。")
        history=[{"question":t["question"]} for t in row["turns"][-5:]]
        if not history and row.get("initial") and row["initial"]!=text:history=[{"question":row["initial"]}]
        answer=await run_in_threadpool(communication,{"text":prompt,"language":language,"history":history})
        insights=answer["insights"]
        scores={"明确采购":("强意向",90),"考虑采购":("有意向",65),"无购买意愿":("无意向",0),"待判断":("弱意向",15)}
        level,score=scores.get(insights["intent"],("待判断",15))
        follow_photo={
         "English":"Thank you for the photo. Please send a close-up of the part number and confirm the current axle, installation position and measured dimensions so we can verify fitment.",
         "中文":"感谢您发送照片。请补发原件编码的近照，并说明当前车桥、安装位置和实测尺寸，以便核对适配。",
         "Deutsch":"Danke für das Foto. Bitte senden Sie eine Nahaufnahme der Teilenummer sowie Achse, Einbauposition und Maße.",
         "Español":"Gracias por la foto. Envíe una imagen del número de pieza e indique el eje, la posición y las dimensiones.",
         "Français":"Merci pour la photo. Envoyez une image de la référence et indiquez l’essieu, la position et les dimensions.",
         "Português":"Obrigado pela foto. Envie uma imagem do código e informe o eixo, a posição e as dimensões."
        }
        reply=answer["reply"]
        if image:reply=(reply+"\n\n" if text else "")+follow_photo[language]
        turn=dict(id=uuid4().hex,question=text or "客户上传了图片",reply=reply,image=image,observation=observation,photo_rows=photo_rows,
                  insights=insights,language=language,quantity=answer["fields"].get("数量"),level=level,score=score,model=answer["reply_model"] if text else None,created=now())
        with engine.begin() as con:write(con,key,row,dict(row,turns=row["turns"]+[turn],updated=now()))
        return turn

    def quote_context(key,turn_id):
        with engine.connect() as con:
            row=read(con,key)
            customer=record(con,"customer",row["customer_id"]) if row.get("customer_id") else {}
        turn_index=next((i for i,t in enumerate(row["turns"]) if t["id"]==turn_id),None)
        if turn_index is None:raise HTTPException(404,"找不到本轮询盘")
        turn=row["turns"][turn_index]
        direct=match({"text":turn["question"]})
        if not direct["rows"] and not direct["fields"].get("型号") and not direct["fields"].get("编码"):
            previous=next((t["question"] for t in reversed(row["turns"][:turn_index]) if match({"text":t["question"]})["rows"]),row.get("initial") or "")
            if previous:direct=match({"text":turn["question"]+"\n"+previous})
        rows=direct["rows"][:5]
        catalog=items("product")
        cost_by_model={}
        for cost in items("cost"):
            cost_by_model.setdefault(cost["model"].casefold(),cost)
        candidates={r["id"]:r for r in catalog}
        selected={r["id"] for r in rows}
        for candidate in turn.get("insights",{}).get("recommendations",[]):
            record_id=candidate["id"]
            if record_id in candidates and record_id not in selected and len(rows)<5:
                r=candidates[record_id]
                rows.append(dict(r,cost=cost_by_model.get(str(r.get("model","")).casefold()),reasons=candidate.get("reasons",[])))
                selected.add(record_id)
        return {"name":row["name"],"email":(customer or {}).get("email") or row.get("profile",{}).get("email",""),
                "language":turn.get("language","English"),"question":turn["question"],
                "quantity":turn.get("quantity") or direct["fields"].get("数量"),"rows":rows}

    @router.get("/conversations/{key}/quote-context/{turn_id}")
    def get_quote_context(key:str,turn_id:str):
        return quote_context(key,turn_id)

    @router.post("/conversations/{key}/draft-quote")
    def draft_quote(key:str,body:dict):
        context=quote_context(key,str(body.get("turn","")))
        product=next((r for r in context["rows"] if r["id"]==body.get("product_id")),None)
        if not product:raise HTTPException(422,"请选择本轮候选型号")
        if not re.fullmatch(r"[A-Z]{3}",str(body.get("currency",""))):
            raise HTTPException(422,"请输入有效币种")
        saved=quote(dict(body,name=context["name"],conversation_id=key))
        english=context["language"]!="中文"
        labels=("Quotation","Part number","Quantity","Unit price","Subtotal","Please confirm fitment, freight and final terms.") if english else ("参考报价","型号","数量","单价","小计","适配性、运费和最终交易条款待确认。")
        title,part,qty,unit,total,end=labels
        message=f"{title}\n{part}: {saved['model']}\n{qty}: {saved['quantity']}\n{unit}: {saved['unit_price']:.6f}".rstrip("0").rstrip(".")
        message+=f" {saved['currency']}\n{total}: {saved['total']:.2f} {saved['currency']}\n\n{end}"
        with engine.begin() as con:
            old=record(con,"quote",saved["id"])
            con.execute(update(records).where(records.c.id==saved["id"],records.c.kind=="quote").values(body=dict(old,message=message,email=context["email"])))
        return {"id":saved["id"],"message":message,"email":context["email"]}

    @router.post("/conversations/{key}/attach-quote")
    def attach_quote(key:str,body:dict):
        with engine.begin() as con:
            row=read(con,key)
            saved=record(con,"quote",body.get("quote_id"))
            if not saved or saved.get("conversation_id")!=key or not saved.get("message"):
                raise HTTPException(404,"报价草稿不存在")
            drafts=row.get("quotes",[])
            if not any(d["id"]==body["quote_id"] for d in drafts):
                entry={"id":body["quote_id"],"model":saved["model"],"message":saved["message"],"email":saved.get("email",""),"created":now()}
                write(con,key,row,dict(row,quotes=drafts+[entry],updated=now()))
        return {"ok":True}

    @router.post("/conversations/{key}/customer")
    def customer(key:str,body:dict):
        fields={k:str(body.get(k) or "").strip()[:3000] for k in CUSTOMER_FIELDS}
        if not any(fields.values()):raise HTTPException(422,"请至少填写一项客户信息")
        with engine.begin() as con:
            old=read(con,key)
            current=record(con,"customer",old["customer_id"]) if old.get("customer_id") else None
            fields=dict(current or {},**fields)
            if current is None:
                customer_id=con.execute(insert(records).values(kind="customer",body=fields)).inserted_primary_key[0]
            else:
                customer_id=old["customer_id"]
                con.execute(update(records).where(records.c.id==customer_id,records.c.kind=="customer").values(body=fields))
            write(con,key,old,dict(old,customer_id=customer_id,updated=now()))
        return {"id":customer_id,**fields}

    @router.post("/conversations/{key}/followup")
    def followup(key:str,body:dict,request:Request):
        content=str(body.get("content","")).strip()[:4000]
        if not content:raise HTTPException(422,"请填写跟进内容")
        try:
            when=datetime.fromisoformat(str(body.get("when") or now())).isoformat()
        except ValueError:raise HTTPException(422,"跟进时间格式无效") from None
        entry=dict(owner=str(body.get("owner") or request.state.user["username"]).strip()[:120] or request.state.user["username"],recorded_by=request.state.user["username"],when=when,content=content)
        with engine.begin() as con:
            old=read(con,key)
            write(con,key,old,dict(old,followups=old["followups"]+[entry],updated=now()))
        return entry

    @router.get("/customers")
    def customers():
        linked={}
        for row in sorted(all_chats(),key=lambda r:r["updated"]):
            if row.get("customer_id"):linked[row["customer_id"]]=row["id"]
        return [dict(r,conversation=linked.get(r["id"])) for r in items("customer")]

    @router.post("/inquiries/intake")
    def intake(body:dict, request:Request):
        token=os.getenv("WEBSITE_INQUIRY_TOKEN")
        if not token or not hmac.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            raise HTTPException(403)
        message=str(body.get("text","")).strip()[:10000]
        if not message:raise HTTPException(422,"请填写询盘正文")
        fields=dict(name=str(body.get("name","")).strip()[:200] or "网站访客",
                    email=str(body.get("email","")).strip()[:200],country=str(body.get("country","")).strip()[:100],
                    notes=message,added_at=now(),origin="官网表单",source="官网表单")
        with engine.begin() as con:
            key=con.execute(insert(records).values(kind="inquiry",body=fields)).inserted_primary_key[0]
        return {"id":key}

    @router.get("/inquiries")
    def inquiries():
        linked={row["id"] for row in all_chats()}
        return [dict(r,conversation=("inquiry-"+str(r["id"]) if "inquiry-"+str(r["id"]) in linked else None)) for r in items("inquiry")]

    @router.get("/report")
    def report(request:Request):
        if request.state.user["role"]!="admin":raise HTTPException(403)
        data=all_chats()
        by_owner=Counter(r["owner"] for r in data)
        counts=Counter(x["recorded_by"] for r in data for x in r["followups"])
        with engine.connect() as con:
            social=list(con.exec_driver_sql("SELECT body FROM social_inbox").scalars())
        social=[json.loads(r) if isinstance(r,str) else r for r in social]
        return {"metrics":{"客户档案":len(items("customer")),"网站询盘":len(items("inquiry")),"社媒线索":len(social),"客户会话":len(data),"AI 回复":sum(len(r["turns"]) for r in data),"跟进记录":sum(counts.values()),"报价草稿":len(items("quote")),"已成交社媒":sum(r["stage"]=="已成交" for r in social)},"sales":[{"username":u,"conversations":by_owner[u],"followups":counts[u]} for u in sorted(by_owner.keys()|counts.keys())]}
    app.include_router(router)
