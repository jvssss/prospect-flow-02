"""
Monta a base de autoescolas (CNAE 8599-6/01) a partir dos dados abertos de CNPJ
da Receita Federal e grava um JSON por UF.

Uso: python -I build_rfb.py <mes AAAA-MM> <pasta_download> <pasta_saida>

Baixa um zip por vez, filtra, apaga o zip. Nao guarda os arquivos brutos.
"""
import csv, io, json, os, re, subprocess, sys, time, unicodedata, zipfile
from collections import defaultdict

MES, DL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
BASE = "https://arquivos.receitafederal.gov.br/public.php/webdav/" + MES + "/"
TOKEN = "YggdBLfdninEJX9:"
CNAE = "8599601"
SITUACOES = {"02", "03", "04"}  # ativa, suspensa, inapta (baixada fica de fora)

os.makedirs(DL, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
csv.field_size_limit(10**9)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def norm_cidade(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def baixar(nome):
    dest = os.path.join(DL, nome)
    for tent in range(1, 6):
        r = subprocess.run(
            ["curl", "-s", "-S", "-L", "-C", "-", "--retry", "3", "-u", TOKEN,
             "-o", dest, BASE + nome],
            capture_output=True, text=True)
        if r.returncode == 0 and zipfile.is_zipfile(dest):
            return dest
        log("falha ao baixar", nome, "tentativa", tent, r.stderr.strip()[:150])
        time.sleep(5 * tent)
    raise SystemExit("nao consegui baixar " + nome)


def linhas(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            with z.open(info) as f:
                txt = io.TextIOWrapper(f, encoding="latin-1", newline="")
                yield from csv.reader(txt, delimiter=";", quotechar='"')


def processar(nome, fn):
    p = baixar(nome)
    t0 = time.time()
    n = fn(linhas(p))
    os.remove(p)
    log(nome, "ok", n, "linhas lidas em", round(time.time() - t0), "s")


# ---------- tabelas de dominio ----------
mun, qual = {}, {}


def ler_dominio(nome, alvo):
    def f(rows):
        n = 0
        for r in rows:
            alvo[r[0]] = r[1]
            n += 1
        return n
    processar(nome, f)


ler_dominio("Municipios.zip", mun)
ler_dominio("Qualificacoes.zip", qual)

# ---------- estabelecimentos ----------
estab = {}  # cnpj completo -> dict


def f_estab(rows):
    n = 0
    for r in rows:
        n += 1
        if len(r) < 28 or r[11] != CNAE or r[5] not in SITUACOES:
            continue
        cnpj = r[0] + r[1] + r[2]
        ddd, tel = r[21].strip(), r[22].strip()
        estab[cnpj] = {
            "cnpj": cnpj,
            "basico": r[0],
            "matriz": r[3] == "1",
            "fantasia": r[4].strip() or None,
            "situacao": r[5],
            "abertura": (r[10][:4] + "-" + r[10][4:6] + "-" + r[10][6:8]) if len(r[10]) == 8 and r[10] != "00000000" else None,
            "bairro": r[17].strip() or None,
            "cep": r[18].strip() or None,
            "uf": r[19].strip() or None,
            "cidade": mun.get(r[20], "").strip() or None,
            "telefone": (ddd + tel) if ddd and tel else None,
            "email": r[27].strip().lower() or None,
        }
    return n


for i in range(10):
    processar(f"Estabelecimentos{i}.zip", f_estab)
log("autoescolas encontradas:", len(estab))

basicos = {e["basico"] for e in estab.values()}

# ---------- empresas (razao social, capital) ----------
emp = {}


def f_emp(rows):
    n = 0
    for r in rows:
        n += 1
        if r[0] in basicos:
            try:
                cap = float(r[4].replace(",", ".")) if r[4] else None
            except ValueError:
                cap = None
            emp[r[0]] = {"razao": r[1].strip() or None, "capital": cap}
    return n


for i in range(10):
    processar(f"Empresas{i}.zip", f_emp)

# ---------- socios ----------
soc = defaultdict(list)


def f_soc(rows):
    n = 0
    for r in rows:
        n += 1
        if r[0] in basicos:
            soc[r[0]].append({
                "nome": r[2].strip(),
                "tipo": {"1": "PJ", "2": "PF", "3": "EX"}.get(r[1], r[1]),
                "qualificacao": qual.get(r[4], r[4]),
                "desde": (r[5][:4] + "-" + r[5][4:6] + "-" + r[5][6:8]) if len(r[5]) == 8 else None,
            })
    return n


for i in range(10):
    processar(f"Socios{i}.zip", f_soc)

# ---------- saida por UF ----------
por_uf = defaultdict(lambda: defaultdict(list))
for e in estab.values():
    if not e["uf"] or not e["cidade"]:
        continue
    emp_e = emp.get(e["basico"], {})
    e["razao"] = emp_e.get("razao")
    e["capital"] = emp_e.get("capital")
    e["socios"] = soc.get(e["basico"], [])
    por_uf[e["uf"]][norm_cidade(e["cidade"])].append(e)

total = 0
for uf, cidades in sorted(por_uf.items()):
    dados = {"uf": uf, "fonte": "Receita Federal - dados abertos CNPJ", "mes": MES, "cnae": "8599-6/01", "cidades": cidades}
    caminho = os.path.join(OUT, uf + ".json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for v in cidades.values())
    total += n
    log(uf, n, "autoescolas", round(os.path.getsize(caminho) / 1e6, 2), "MB")

with open(os.path.join(OUT, "_index.json"), "w", encoding="utf-8") as f:
    json.dump({
        "mes": MES, "total": total,
        "ufs": {uf: sum(len(v) for v in c.values()) for uf, c in sorted(por_uf.items())},
    }, f, ensure_ascii=False)
log("FIM", total)
