"""Run with the project virtual environment. Uses an isolated database."""
import io
import os
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfWriter

with TemporaryDirectory() as directory:
    os.environ["DATA_DIR"] = directory
    os.environ["DATABASE_URL"] = "sqlite:///" + directory.replace("\\", "/") + "/test.db"
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["SEARCH_API_KEY"] = ""
    from main import app, engine

    with TestClient(app) as client:
        def post(path, payload):
            response = client.post("/api/" + path, json=payload)
            assert response.is_success, response.text
            return response.json()

        with patch("workspace_accounts.secrets.choice",return_value="A"):
            challenge=client.get("/api/account/captcha").json()
        post("account/login",{"role":"admin","username":"admin","password":"123456","captcha_id":challenge["id"],"captcha":"AAAAA"})
        home = client.get("/")
        assert home.is_success and "冠英工作台" in home.text
        assert client.get(home.text.split('src="')[1].split('"')[0]).is_success
        assert client.get("/api/overview").json()["目录产品"] >= 1000
        for path in ("settings", "records/customer", "records/product", "records/term", "records/asset", "records/quote"):
            assert client.get("/api/" + path).is_success
        search = post("search", {"country":"德国","product":"商用车刹车片","target":"经销商"})
        lead = search["leads"][0]
        assert lead["origin"] == "演示"
        customer = post("records/customer", dict(lead,status="待跟进"))
        post("records/customer", dict(customer,status="已联系"))
        assert client.get("/api/records/customer").json()["rows"][0]["status"] == "已联系"
        post("records/term", {"term":"test lining","lang":"英语","meaning":"试验衬片"})
        parsed = post("communication", {"text":"WVA 19037, 1×2×3 in, 300 sets", "language":"Deutsch"})
        assert parsed["fields"]["尺寸毫米"] == [25.4,50.8,76.2]
        assert parsed["fields"]["编码"]["WVA"] == "19037"
        matched = post("match", {"text":"Need GYS-010 for SAF, 213×193×178 mm"})
        selected = matched["rows"][0]
        assert selected["model"] == "GYS-010" and selected["page"] == 6
        assert not post("match", {"text":"ZZZ-00000000"})["rows"]
        quote = post("quote", {"product_id":selected["id"],"quantity":300,"unit_price":80})
        assert quote["total"] == 24000
        imported = client.post("/api/upload",files={"file":("fixture.csv",b"model,vehicle\nTEST-9001,TestVehicle\n","text/csv")})
        assert imported.json()["count"] == 1
        assert post("match", {"text":"TEST-9001"})["rows"][0]["catalog"] == "fixture.csv"
        writer = PdfWriter()
        writer.add_blank_page(width=72,height=72)
        buffer = io.BytesIO()
        writer.write(buffer)
        pdf = client.post("/api/upload",files={"file":("fixture.pdf",buffer.getvalue(),"application/pdf")})
        assert pdf.json()["pages"] == 1
        assert client.get("/api/assets/" + str(pdf.json()["id"])).content == buffer.getvalue()
        assert client.post("/api/upload",files={"file":("bad.exe",b"x")}).status_code == 422
    engine.dispose()
    from customs import db as customs_db
    customs_db.dispose()
print("PASS: page/asset, overview, demo leads, CRM, terms, communication, fitment, quotation and uploads")
