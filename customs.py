import csv
import hashlib
import io
import json
import os
from collections import Counter
from datetime import date, datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, UploadFile
from openpyxl import load_workbook
from sqlalchemy import JSON, Column, MetaData, String, Table, create_engine, select
from sqlalchemy.exc import IntegrityError

router = APIRouter(prefix="/api/customs")
metadata = MetaData()
shipments = Table("customs_shipments", metadata,
    Column("id", String(64), primary_key=True),
    Column("date", String(10), nullable=False, index=True),
    Column("market", String(200), nullable=False),
    Column("hs", String(32), nullable=False),
    Column("body", JSON, nullable=False))
db = None
ALIASES = {
    "date": ("date", "日期", "交易日期", "提单日期", "申报日期"),
    "market": ("market", "country", "国家", "进口国", "进口国家", "目的国", "目的国家"),
    "hs": ("hs", "hs_code", "hs编码", "海关编码", "商品编码"),
    "buyer": ("buyer", "importer", "采购商", "进口商", "收货人"),
    "product": ("product", "description", "品名", "商品名称", "商品描述"),
    "reference": ("reference", "id", "提单号", "记录编号"),
}

def setup(data_dir):
    global db
    db = create_engine(os.getenv("CUSTOMS_DATABASE_URL") or f"sqlite:///{data_dir / 'customs.db'}")
    metadata.create_all(db)

def normalize(raw):
    attrs = {str(key).strip().casefold(): value for key, value in raw.items()}
    row = {}
    for field, keys in ALIASES.items():
        value = next((attrs[k] for k in keys if attrs.get(k) not in (None, "")), "")
        row[field] = str(value).strip()
        if field == "date" and isinstance(value, (date, datetime)):
            row[field] = value.strftime("%Y-%m-%d")
    value = row["date"].split(" ")[0].replace("/", "-").replace(".", "-")
    parts = value.split("-")
    if len(parts) != 3:
        raise ValueError("日期须使用 YYYY-MM-DD")
    row["date"] = date(int(parts[0]), int(parts[1]), int(parts[2])).isoformat()
    if not row["market"] or len(row["market"]) > 200 or len(row["hs"]) > 32:
        raise ValueError("目的市场必填，市场及 HS 编码长度超限")
    return row

def ingest(rows, source, channel):
    if not isinstance(rows,list) or not rows or len(rows)>50000:
        raise HTTPException(422,"每批须包含 1 至 50,000 行")
    valid = []
    for i, raw in enumerate(rows, 2):
        try:
            row = normalize(raw)
        except (AttributeError, TypeError, ValueError, OverflowError):
            raise HTTPException(422,f"第 {i} 行无效，请检查日期和目的市场") from None
        digest = hashlib.sha256(json.dumps([channel,row],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        valid.append(dict(id=digest,date=row["date"],market=row["market"],hs=row["hs"],body=dict(row,source=source)))
    added = 0
    with db.begin() as conn:
        for item in valid:
            try:
                with conn.begin_nested():
                    conn.execute(shipments.insert().values(**item))
                added += 1
            except IntegrityError:
                continue
    return {"added":added,"duplicates":len(valid)-added}

@router.post("/import")
async def import_file(file: UploadFile):
    name = Path(file.filename or "").name
    raw = await file.read(15*1024*1024+1)
    if not raw or len(raw)>15*1024*1024:
        raise HTTPException(413,"请选择 15 MB 以内的文件")
    try:
        if name.lower().endswith(".xlsx"):
            workbook = load_workbook(io.BytesIO(raw),read_only=True,data_only=True)
            try:
                values = workbook.active.values
                headers = next(values)
                rows = [dict(zip(headers,row)) for row in values if any(v is not None for v in row)]
            finally:
                workbook.close()
        elif name.lower().endswith(".csv"):
            try:
                decoded = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                decoded = raw.decode("gb18030")
            rows = list(csv.DictReader(io.StringIO(decoded)))
        else:
            raise ValueError()
    except Exception:
        raise HTTPException(422,"文件无法读取，请提供 CSV 或 XLSX") from None
    return ingest(rows,name,"customs")

@router.post("/sync")
def sync():
    url = os.getenv("CUSTOMS_API_URL")
    if not url:
        raise HTTPException(409,"尚未配置授权海关接口，请使用导出的 CSV 或 XLSX")
    token = os.getenv("CUSTOMS_API_TOKEN")
    try:
        response = httpx.get(url,headers={"Authorization":f"Bearer {token}"} if token else {},timeout=25)
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("records") if isinstance(payload,dict) else payload
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502,"授权数据接口请求失败") from None
    return ingest(rows,"授权接口","customs")

@router.get("/dashboard")
def dashboard(market: str="", hs: str="", start: str="", end: str=""):
    for value in (start,end):
        if value:
            try:
                if date.fromisoformat(value).isoformat()!=value:
                    raise ValueError()
            except ValueError:
                raise HTTPException(422,"日期格式应为 YYYY-MM-DD") from None
    if start and end and start>end:
        raise HTTPException(422,"开始日期不能晚于结束日期")
    query = select(shipments.c.id, shipments.c.body).order_by(shipments.c.date.desc(),shipments.c.id)
    if market:
        query = query.where(shipments.c.market == market)
    if hs:
        query = query.where(shipments.c.hs == hs)
    if start:
        query = query.where(shipments.c.date >= start)
    if end:
        query = query.where(shipments.c.date <= end)
    with db.connect() as conn:
        rows = [dict(row.body,id=row.id) for row in conn.execute(query)]
        markets = conn.execute(select(shipments.c.market).distinct().order_by(shipments.c.market)).scalars().all()
    monthly = Counter(r["date"][:7] for r in rows)
    return {"total":len(rows),"market_count":len({r["market"] for r in rows}),
        "buyer_count":len({r["buyer"].casefold() for r in rows if r["buyer"]}),
        "months":sorted(monthly.items()),"top":Counter(r["market"] for r in rows).most_common(10),
        "markets":markets,"rows":rows[:25],"sync_enabled":bool(os.getenv("CUSTOMS_API_URL"))}

@router.delete("/records/{key}", status_code=204)
def remove_record(key: str):
    with db.begin() as conn:
        if not conn.execute(shipments.delete().where(shipments.c.id==key)).rowcount:
            raise HTTPException(404,"记录不存在")
