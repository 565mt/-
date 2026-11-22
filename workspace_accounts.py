import base64
import hashlib
import io
import hmac
import secrets
import sqlite3
import time
from contextlib import closing

from PIL import Image, ImageDraw, ImageFont
from fastapi import APIRouter, HTTPException, Request, Response


def install_accounts(app, folder):
    router = APIRouter(prefix="/api/account")
    path = folder / "accounts.sqlite3"
    cookie = "guanying_session"

    def db():
        connection = sqlite3.connect(path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    with closing(db()) as con, con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY, password TEXT NOT NULL, recovery TEXT NOT NULL,
          role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, username TEXT NOT NULL, expiry INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS challenges (
          id TEXT PRIMARY KEY, answer TEXT NOT NULL, expiry INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_meta (key TEXT PRIMARY KEY);
        """)

    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def crypt(value, salt=None):
        salt = salt or secrets.token_hex(16)
        return salt + ":" + hashlib.scrypt(value.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1,dklen=32).hex()

    with closing(db()) as con, con:
        con.execute("BEGIN IMMEDIATE")
        if con.execute("INSERT OR IGNORE INTO account_meta VALUES ('default_admin_v1')").rowcount:
            con.execute("INSERT INTO users(username,password,recovery,role,active) VALUES ('admin',?,?,'admin',1) "
                        "ON CONFLICT(username) DO UPDATE SET password=excluded.password,recovery=excluded.recovery,role='admin',active=1",
                        (crypt("123456"),digest(secrets.token_urlsafe(32))))
            con.execute("DELETE FROM sessions WHERE username='admin'")

    def local(request):
        return request.client and request.client.host in ("127.0.0.1","::1","testclient")

    @router.get("/captcha")
    def captcha(response:Response):
        code="".join(secrets.choice("23456789ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(5))
        key=secrets.token_urlsafe(18)
        with closing(db()) as con, con:
            t=int(time.time())
            con.execute("DELETE FROM challenges WHERE expiry<?",(t,))
            con.execute("INSERT INTO challenges VALUES(?,?,?)",(key,digest(key+code),t+180))
        image=Image.new("RGB",(166,54),"#e7f3ff")
        draw=ImageDraw.Draw(image)
        rand=secrets.SystemRandom()
        for _ in range(12):
            draw.line((rand.randrange(166),rand.randrange(54),rand.randrange(166),rand.randrange(54)),fill="#bfd6ee",width=1)
        font=ImageFont.load_default(size=29)
        for i,char in enumerate(code):
            draw.text((15+i*27,rand.randrange(6,15)),char,fill="#163e72",font=font)
        buffer=io.BytesIO()
        image.save(buffer,format="PNG")
        response.headers["Cache-Control"]="no-store"
        return {"id":key,"image":"data:image/png;base64,"+base64.b64encode(buffer.getvalue()).decode("ascii")}

    def require_captcha(body):
        key=str(body.get("captcha_id",""))[:100]
        code=str(body.get("captcha","")).strip().upper()[:30]
        with closing(db()) as con, con:
            con.execute("BEGIN IMMEDIATE")
            row=con.execute("SELECT answer,expiry FROM challenges WHERE id=?",(key,)).fetchone()
            con.execute("DELETE FROM challenges WHERE id=?",(key,))
        if not row or row["expiry"]<int(time.time()) or not hmac.compare_digest(row["answer"],digest(key+code)):
            raise HTTPException(422,"验证码无效或已过期，请重试")

    def identity(request):
        token = request.cookies.get(cookie)
        if token:
            with closing(db()) as con:
                row=con.execute("SELECT u.username,u.role FROM users u JOIN sessions s USING(username) WHERE s.token=? AND s.expiry>? AND u.active=1",(digest(token),int(time.time()))).fetchone()
                if row: return dict(row)
        return None

    @app.middleware("http")
    async def guard(request, call_next):
        path = request.url.path
        if path.startswith("/api/"):
            if request.method not in ("GET","HEAD","OPTIONS") and request.headers.get("sec-fetch-site") == "cross-site":
                return Response(status_code=403)
            user=identity(request)
            request.state.user=user
            public=path in {"/api/account/state","/api/account/captcha","/api/account/login","/api/account/register","/api/account/recover","/api/social/events","/api/social/facebook","/api/sales/inquiries/intake"}
            if not user and not public:
                return Response('{"detail":"请先登录"}',status_code=401,media_type="application/json")
        return await call_next(request)

    def session(response,user,remember=False,secure=False):
        token=secrets.token_urlsafe(32)
        ttl=30*86400 if remember else 86400
        with closing(db()) as con, con:
            con.execute("DELETE FROM sessions WHERE expiry<=?",(int(time.time()),))
            con.execute("INSERT INTO sessions VALUES(?,?,?)",(digest(token),user,int(time.time())+ttl))
        response.set_cookie(cookie,token,max_age=ttl if remember else None,httponly=True,samesite="strict",secure=secure)

    @router.get("/state")
    def state(request:Request):
        return {"user":request.state.user}

    @router.post("/register")
    def register(body:dict,request:Request,response:Response):
        if request.state.user and request.state.user["role"]!="admin":
            raise HTTPException(403,"请退出后再注册其他销售账号")
        if not request.state.user:
            if not local(request):raise HTTPException(403,"请在本机注册，或联系管理员创建销售账号")
            require_captcha(body)
        username=str(body.get("username","")).strip().casefold()
        password=str(body.get("password",""))
        if not 2<=len(username)<=80 or not 10<=len(password)<=200:
            raise HTTPException(422,"账号须 2–80 字，密码须 10–200 字")
        recovery=secrets.token_urlsafe(20)
        hashed=crypt(password)
        with closing(db()) as con, con:
            con.execute("BEGIN IMMEDIATE")
            role="sales"
            try:
                con.execute("INSERT INTO users(username,password,recovery,role) VALUES(?,?,?,?)",(username,hashed,digest(recovery),role))
            except sqlite3.IntegrityError:
                raise HTTPException(409,"账号已存在") from None
        if not request.state.user:
            session(response,username,secure=request.url.scheme=="https")
        return {"user":{"username":username,"role":role},"recovery":recovery}

    @router.post("/login")
    def login(body:dict,request:Request,response:Response):
        require_captcha(body)
        username=str(body.get("username","")).strip().casefold()
        password=str(body.get("password",""))
        with closing(db()) as con:
            row=con.execute("SELECT * FROM users WHERE username=? AND active=1",(username,)).fetchone()
        expected=row["password"] if row else "0"*32+":"+"0"*64
        valid=len(password)<=200 and hmac.compare_digest(crypt(password,expected.split(":")[0]),expected)
        if not row or not valid:raise HTTPException(401,"账号或密码不正确")
        if body.get("role")!=row["role"]:raise HTTPException(401,"请选择与账号相符的登录入口")
        if username=="admin" and password=="123456" and not local(request):raise HTTPException(403,"请在本机登录并修改初始密码")
        session(response,username,body.get("remember") is True,request.url.scheme=="https")
        return {"user":{"username":username,"role":row["role"]}}

    @router.post("/recover")
    def recover(body:dict):
        require_captcha(body)
        user=str(body.get("username","")).strip().casefold()
        password=str(body.get("password",""))
        code=str(body.get("code",""))
        if not 10<=len(password)<=200:raise HTTPException(422,"新密码须 10–200 字")
        replacement=secrets.token_urlsafe(20)
        with closing(db()) as con, con:
            result=con.execute("UPDATE users SET password=?, recovery=? WHERE username=? AND recovery=? AND active=1",(crypt(password),digest(replacement),user,digest(code)))
            if not result.rowcount:raise HTTPException(400,"账号或恢复码无效")
            con.execute("DELETE FROM sessions WHERE username=?",(user,))
        return {"recovery":replacement}

    @router.post("/password")
    def password(body:dict,request:Request):
        username=request.state.user["username"]
        previous=str(body.get("current",""))
        replacement=str(body.get("password",""))
        if not 10<=len(replacement)<=200:raise HTTPException(422,"新密码须 10–200 字")
        code=secrets.token_urlsafe(20)
        with closing(db()) as con, con:
            row=con.execute("SELECT password FROM users WHERE username=?",(username,)).fetchone()
            expected=row["password"]
            if len(previous)>200 or not hmac.compare_digest(crypt(previous,expected.split(":")[0]),expected):
                raise HTTPException(401,"当前密码不正确")
            con.execute("UPDATE users SET password=?,recovery=? WHERE username=?",(crypt(replacement),digest(code),username))
            con.execute("DELETE FROM sessions WHERE username=? AND token<>?",(username,digest(request.cookies.get(cookie,""))))
        return {"recovery":code}

    @router.post("/logout")
    def logout(request:Request,response:Response):
        with closing(db()) as con, con:
            con.execute("DELETE FROM sessions WHERE token=?",(digest(request.cookies.get(cookie,"")),))
        response.delete_cookie(cookie)
        return {"ok":True}

    @router.get("/users")
    def users(request:Request):
        if request.state.user["role"]!="admin":raise HTTPException(403)
        with closing(db()) as con:
            return [dict(r) for r in con.execute("SELECT username,role,active FROM users ORDER BY username")]

    @router.post("/users/access")
    def access(body:dict,request:Request):
        if request.state.user["role"]!="admin":raise HTTPException(403)
        name=str(body.get("username",""))
        with closing(db()) as con, con:
            if not con.execute("UPDATE users SET active=? WHERE username=? AND role='sales'",(int(body.get("active") is True),name)).rowcount:raise HTTPException(404)
            con.execute("DELETE FROM sessions WHERE username=?",(name,))
        return {"ok":True}
    app.include_router(router)
