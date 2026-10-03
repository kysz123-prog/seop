"""다담 빈칸 HWPX + 정답 txt → questions.json / questions.js (원본은 읽기만 함).
빈칸 단어는 HWPX 안에서 특정 글자서식(charPrIDRef) run에 들어 있다. 그 서식을 정답 txt와 대조해 찾는다.
- 표는 한 행 = 한 줄(칸 사이 \\t)로 만들고, 문단을 묶을 때 표는 쪼개지 않는다.
- 이웃 줄을 MIN_LEN자 이상(최대 MAX_UNITS 덩어리)으로 묶고, 앞에 직전 소제목 2개를 붙인다.
- 묶음 안 빈칸이 PER_Q개를 넘으면 PER_Q개씩 끊어 문항을 나눈다(나머지 빈칸은 정답으로 채워 보여 줌).
문항 = {id, text(줄바꿈 \\n, 표 칸 \\t, 빈칸 '{{blank}}'), answers[빈칸 순서대로]}.
사용: python convert/hwpx_to_json.py   (웹앱 폴더에서 실행)
"""
import json, re, sys, zipfile, unicodedata
from pathlib import Path
from lxml import etree

SRC = Path(__file__).resolve().parents[2] / "pdf to hwpx" / "출력"
OUT = Path(__file__).resolve().parents[1]
FILES = {"basic": "다담빈칸_품사단어문장_v3_기본빈칸", "adv": "다담빈칸_품사단어문장_v3_심화빈칸"}
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
MIN_LEN, MAX_UNITS, PER_Q = 160, 7, 6
SEP = "SEP"   # 표 칸 구분 조각
nfc = lambda s: unicodedata.normalize("NFC", s)
ns = lambda s: re.sub(r"\s+", "", s)
sp = lambda s: re.sub(r" *\t *", "\t", re.sub(r"[^\S\t]+", " ", s)).strip()


def read_answers(txt):
    ans = []
    for ln in txt.read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"\s*(\d+)\.\s*(.*\S)\s*$", ln)
        if m:
            ans.append(nfc(m.group(2)))
    return ans


def run_segs(run):
    t = "".join(x.text or "" for x in run.findall(HP + "t"))
    return [(run.get("charPrIDRef"), nfc(t))] if t else []


def paragraphs(hwpx):
    """문서 순서대로 (조각들, 표번호|None). 조각 = (charPrIDRef, 글). 표는 행마다 한 줄."""
    with zipfile.ZipFile(hwpx) as z:
        root = etree.fromstring(z.read("Contents/section0.xml"))
    tid = 0
    for p in root.findall(HP + "p"):
        segs, tables = [], []
        for r in p.findall(HP + "run"):
            segs += run_segs(r)
            tables += r.findall(HP + "tbl")
        if segs:
            yield segs, None
        for tbl in tables:
            tid += 1
            for tr in tbl.findall(HP + "tr"):
                row = []
                for ci, tc in enumerate(tr.findall(HP + "tc")):
                    if ci:
                        row.append((SEP, "\t"))
                    for k, cp in enumerate(tc.iter(HP + "p")):
                        if k:
                            row.append(("_", " "))
                        for r in cp.findall(HP + "run"):
                            row += run_segs(r)
                if any(t.strip() for c, t in row if c != SEP):
                    yield row, tid


def find_blank_style(paras, answers):
    cands = {}
    for segs, _ in paras:
        for cid, t in segs:
            cands.setdefault(cid, []).append(t.strip())
    for cid, seq in cands.items():
        if seq == answers:
            return cid
    return max(cands, key=lambda c: sum(a == b for a, b in zip(cands[c], answers)))


def to_lines(paras, answers, cid):
    """→ [(parts, 표번호)]; parts=[('t',글)|('b',빈칸단어)]. 정답 txt와 순서·개수를 맞춘다."""
    lines, problems, k = [], [], 0
    for segs, tid in paras:
        parts, i = [], 0
        while i < len(segs):
            c, t = segs[i]
            if c != cid:
                parts.append(("t", t)); i += 1
                continue
            j, tgt = i + 1, ns(answers[min(k, len(answers) - 1)])
            if ns(t) != tgt:  # 연속한 빈칸 조각이 한 정답이면 합침
                acc = ns(t)
                for e in range(i + 1, len(segs)):
                    if segs[e][0] != cid:
                        break
                    acc += ns(segs[e][1])
                    if acc == tgt:
                        j = e + 1
                        break
            word = sp("".join(x for _, x in segs[i:j]))
            n = 1  # 이 빈칸이 정답 txt의 몇 줄에 해당하는지
            if k >= len(answers):
                problems.append((k + 1, word, None))
            elif ns(word) != ns(answers[k]):
                for m in (2, 3):
                    if ns("".join(answers[k:k + m])) == ns(word):
                        n = m
                        break
                else:
                    problems.append((k + 1, word, answers[k]))
            parts.append(("b", word)); k += n; i = j
        lines.append((parts, tid))
    return lines, problems


def plain(parts):
    return sp("".join(x for _, x in parts))


def has_blank(parts):
    return any(p[0] == "b" for p in parts)


def is_heading(unit):
    if len(unit) != 1 or unit[0][1] is not None:
        return False
    parts = unit[0][0]; t = plain(parts)
    return len(t) < 40 and not has_blank(parts) and re.match(r"^(\d+\.|\(\d+\)|[①-⑳])\s", t) is not None


def head_level(unit):
    t = plain(unit[0][0])
    return 1 if re.match(r"^\d+\.", t) else 2 if t.startswith("(") else 3


def units_of(lines):
    """덩어리: 일반 줄 1개 또는 표 하나 전체."""
    out = []
    for ln in lines:
        if ln[1] is not None and out and out[-1][0][1] == ln[1]:
            out[-1].append(ln)
        else:
            out.append([ln])
    return out


def build(lines, kind):
    units = [u for u in units_of(lines) if any(plain(p) for p, _ in u)]
    items, heads, i = [], [], 0
    while i < len(units):
        j, total, nb = i, 0, 0
        while j < len(units) and j - i < MAX_UNITS and total < MIN_LEN:
            ub = sum(x[0] == "b" for p, _ in units[j] for x in p)
            if j > i and nb + ub > PER_Q:  # 빈칸이 PER_Q개를 넘기 전에 끊음(나눠진 문항끼리 답이 보이지 않게)
                break
            total += sum(len(plain(p)) for p, _ in units[j]); nb += ub; j += 1
        while j - i > 1 and is_heading(units[j - 1]):  # 다음 절 제목이 끝에 붙지 않게
            j -= 1
        win = units[i:j]; i = j
        pre = [h for h in heads[-2:] if h not in win] if not is_heading(win[0]) else []
        for u in win:  # 소제목 단계: 1. > (1) > ①  — 같거나 낮은 단계는 새 제목으로 교체
            if is_heading(u):
                lv = head_level(u)
                heads = [h for h in heads if head_level(h) < lv] + [u]
        win_lines = [ln for u in pre + win for ln in u]
        nb = sum(has_blank(p) and sum(x[0] == "b" for x in p) for p, _ in win_lines)
        for s in range(0, nb, PER_Q):
            ask, seen, words, out = range(s, s + PER_Q), 0, [], []
            for parts, _ in win_lines:
                buf = ""
                for kd, x in parts:
                    if kd == "b":
                        if seen in ask:
                            buf += "{{blank}}"; words.append(x)
                        else:
                            buf += x
                        seen += 1
                    else:
                        buf += x
                out.append(sp(buf))
            if words:
                items.append({"id": f"{kind[0]}{len(items) + 1:04d}", "text": "\n".join(out), "answers": words})
    return items


def main():
    data = {}
    for kind in FILES:
        base = SRC / FILES[kind]
        answers = read_answers(Path(str(base) + "_정답.txt"))
        paras = list(paragraphs(Path(str(base) + ".hwpx")))
        cid = find_blank_style(paras, answers)
        lines, problems = to_lines(paras, answers, cid)
        items = build(lines, kind)
        data[kind] = items
        nbl = sum(len(q["answers"]) for q in items)
        print(f"[{kind}] 서식={cid} 문항={len(items)} 빈칸합={nbl} 정답txt={len(answers)} 불일치={len(problems)}")
        for pr in problems[:10]:
            print("   불일치(번호, hwpx, txt):", pr)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (OUT / "questions.json").write_text(js, encoding="utf-8")
    (OUT / "questions.js").write_text("window.QUESTIONS=" + js + ";", encoding="utf-8")  # 더블클릭으로 열 때용
    print("저장:", OUT / "questions.json", "+ questions.js")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
