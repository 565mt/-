"""Local sparse TF-IDF vectors over catalog identifiers, vehicle names and dimensions."""
import math
import re
from collections import Counter
from functools import lru_cache

def tokens(text):
    result=[]
    for word in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+",text.casefold()):
        if re.search(r"[\u4e00-\u9fff]",word):
            result.extend(word[i:i+2] for i in range(max(1,len(word)-1)))
        else:
            result.append(word)
    return Counter(result)

@lru_cache(maxsize=1)
def index(documents):
    counts=[tokens(doc) for _,doc in documents]
    frequency=Counter(term for bag in counts for term in bag)
    weights={term:math.log((len(counts)+1)/(count+1))+1 for term,count in frequency.items()}
    def vector(bag):
        weighted={t:(1+math.log(n))*weights[t] for t,n in bag.items()}
        length=math.sqrt(sum(x*x for x in weighted.values())) or 1
        return {t:w/length for t,w in weighted.items()}
    return weights,[vector(bag) for bag in counts]

def recommend(rows,query,verified):
    documents=tuple((r["id"]," ".join(str(r.get(k) or "") for k in ("model","vehicle","axle","brand","wva","bfmc","fmsi","oe_numbers","dims_raw","series","type"))) for r in rows if r.get("model"))
    weights,vectors=index(documents)
    q={t:(1+math.log(n))*weights[t] for t,n in tokens(query).items() if t in weights}
    length=math.sqrt(sum(x*x for x in q.values())) or 1
    exact={r["id"]:r for r in verified}
    by_id={r["id"]:r for r in rows}
    scored=[]
    for (key,_),vec in zip(documents,vectors):
        common=q.keys() & vec.keys()
        score=sum(q[t]*vec[t] for t in common)/length
        if score>0 or key in exact:
            boost=exact.get(key,{}).get("score",0)/100
            scored.append((score+boost,key,score,sorted(common,key=lambda t:q[t]*vec[t],reverse=True)[:4]))
    seen=set()
    result=[]
    for _,key,score,terms in sorted(scored,reverse=True):
        row=by_id[key]
        if row["model"] in seen: continue
        seen.add(row["model"])
        result.append({k:row.get(k) for k in ("id","model","catalog","page","dims_raw","vehicle")} | {"similarity":round(score,3),"terms":terms,"reasons":exact.get(key,{}).get("reasons",[])})
        if len(result)==5:break
    return result
