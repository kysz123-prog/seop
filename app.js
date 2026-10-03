// ===== 설정 (여기만 고치면 됨) =====
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxT5-lAhEZetpBkVQdGbriYU2ClTeGtx9-WRPFuG13NzObmqOP5IzRPpEX0-KajcGU2TA/exec";                                // 구글 앱스 스크립트 웹앱 주소 (비워 두면 전송 안 함)
const MINUTES = { 100: 10, 300: 20, 500: 30 };         // 문항 수별 제한 시간(분)
const CHOICE_MIN = 5, CHOICE_MAX = 7;                  // 보기 개수 범위
const LEVEL_NAME = { basic: "기본형", adv: "심화형" };

// 불러오기 실패 때 쓰는 테스트용 샘플 5개
// (보통은 questions.js → questions.json 순으로 진짜 문항을 씀)
const SAMPLE = { basic: [
  { id: "s1", text: "1. 품사의 정의와 분류의 기준\n• 품사: 단어들을 {{blank}}이 공통된 것끼리 모아서 분류하여 놓은 {{blank}}", answers: ["성질", "갈래"] },
  { id: "s2", text: "(1) 격 조사: 앞말이 문장 안에서 일정한 자격을 가지도록 해 주는 조사\n종류\t기능\t예\n주격 조사\t앞말을 {{blank}}로 만들어 주는 조사\t이/가, 께서, 에서\n목적격 조사\t앞말을 {{blank}}로 만들어 주는 조사\t을/를", answers: ["주어", "목적어"] },
  { id: "s3", text: "1. 동음이의어\n• {{blank}}는 같으나 {{blank}}이 다른 단어. 단어들이 의미적으로 아무런 관련이 없다.", answers: ["소리", "뜻"] },
  { id: "s4", text: "1. 명사 vs 조사\n• 나도 참을 만큼 참았다. → '만큼'은 관형어 '참을'의 꾸밈을 받고, '참을' 없이 자립적으로 쓰일 수 없으므로 {{blank}}이다.", answers: ["의존 명사"] },
  { id: "s5", text: "(1) 단어의 {{blank}} 변화 여부에 따라\n- {{blank}}(형태가 변하지 않는 단어)와 가변어(형태가 변하는 단어)로 분류", answers: ["형태", "불변어"] }
] };
SAMPLE.adv = SAMPLE.basic;

// ===== 상태 =====
let DATA = null, level = null, count = null;
let quiz = [], idx = 0, bi = 0, answers = [], startedAt = 0, timerId = null, deadline = 0, finished = false;
const $ = id => document.getElementById(id);

// ===== 유틸 =====
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => s.replace(/\s+/g, "");
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const show = id => ["start", "quiz", "result"].forEach(v => $(v).hidden = v !== id);
// 문단 글 → HTML: \t 있는 줄은 표의 한 행(첫 행은 머리글), 소제목 줄은 굵게. {{blank}} 자리는 그대로 둠
const isHead = l => l.length < 40 && !l.includes("{{blank}}") && /^(\d+\.|\(\d+\)|[①-⑳])\s/.test(l);
function layout(t) {
  const out = []; let rows = [];
  const flush = () => {
    if (!rows.length) return;
    out.push("<table>" + rows.map((r, i) => "<tr>" + r.split("\t").map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join("") + "</tr>").join("") + "</table>");
    rows = [];
  };
  for (const l of esc(t).split("\n")) {
    if (l.includes("\t")) rows.push(l);
    else { flush(); out.push(`<p${isHead(l) ? ' class="h"' : ""}>${l}</p>`); }
  }
  flush();
  return out.join("");
}
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

// ===== 데이터 불러오기 =====
async function load() {
  if (window.QUESTIONS) { DATA = window.QUESTIONS; return retryPending(); }   // 더블클릭으로 열어도 동작
  try {
    const r = await fetch("questions.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    DATA = SAMPLE; failMsg = "문제 파일을 못 불러와 샘플로 실행 중입니다. ";
    refreshStart();
  }
  retryPending();
}

// ===== 시작 화면 =====
let failMsg = "";
function refreshStart() {
  $("info").textContent = failMsg + (count ? `빈칸 약 ${count}개 · 제한 ${MINUTES[count]}분` : "");
  $("go").disabled = !(level && count && $("name").value.trim());
}
function bindGroup(groupId, attr, setter) {
  $(groupId).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$(groupId).children].forEach(x => x.classList.toggle("on", x === b));
    setter(b.dataset[attr]); refreshStart();
  });
}
bindGroup("levelGroup", "level", v => level = v);
bindGroup("countGroup", "count", v => count = +v);
$("name").addEventListener("input", refreshStart);
$("go").addEventListener("click", startQuiz);
$("again").addEventListener("click", () => { show("start"); });

// ===== 출제 =====
// 같은 단원 오답: 문항은 원본 순서대로라 앞뒤 NEAR문단의 정답을 오답 후보로 씀(모자라면 범위를 넓힘)
const NEAR = 10;
function nearPool(all, qi, used) {
  for (let r = NEAR; ; r *= 2) {
    const seen = new Set(), pool = [];
    for (const x of all.slice(Math.max(0, qi - r), qi + r + 1))
      for (const w of x.answers) if (!used.has(norm(w)) && !seen.has(norm(w))) { seen.add(norm(w)); pool.push(w); }
    if (pool.length >= CHOICE_MAX * 2 || r >= all.length) return pool;
  }
}
function makeChoices(q, all) {        // 빈칸마다 보기 세트 하나
  const used = new Set(q.answers.map(norm));
  const pool = nearPool(all, all.indexOf(q), used);
  return q.answers.map(a => {
    const n = CHOICE_MIN + Math.floor(Math.random() * (CHOICE_MAX - CHOICE_MIN + 1));   // 5~7개
    const wrong = shuffle(pool).slice(0, n - 1);
    return shuffle([a, ...wrong]);
  });
}
function startQuiz() {
  const all = DATA[level];
  quiz = []; let sum = 0;                                       // 빈칸이 고른 개수 이상 될 때까지 문단을 랜덤으로 담음
  for (const q of shuffle(all)) { if (sum >= count) break; quiz.push({ q, choices: makeChoices(q, all) }); sum += q.answers.length; }
  idx = 0; bi = 0; answers = quiz.map(x => x.q.answers.map(() => null)); finished = false;
  startedAt = Date.now(); deadline = startedAt + (MINUTES[count] || 30) * 60000;
  show("quiz"); renderQ();
  clearInterval(timerId); timerId = setInterval(tick, 500); tick();
}
function tick() {
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $("timer").textContent = fmt(left);
  $("timer").classList.toggle("low", left <= 60);
  if (left <= 0) finish(true);
}
// 한 문단 그리기: 채운 빈칸은 고른 말, 지금 빈칸은 깜빡이는 칸, 빈 칸은 번호(①②…)
const NUM = "①②③④⑤⑥⑦⑧⑨⑩";
function renderQ() {
  const { q, choices } = quiz[idx], picks = answers[idx];
  $("progress").textContent = `${idx + 1} / ${quiz.length}`;
  $("bar").style.width = `${(idx / quiz.length) * 100}%`;
  let n = 0;
  $("hint").textContent = `${NUM[bi] || bi + 1} 빈칸에 들어갈 말`;
  $("sentence").innerHTML = layout(q.text).replace(/\{\{blank\}\}/g, () => {
    const i = n++, p = picks[i];
    return `<span class="blank${p !== null ? " done" : ""}${i === bi ? " now" : ""}" data-i="${i}">${p !== null ? esc(p) : NUM[i] || i + 1}</span>`;
  });
  const box = $("choices"); box.innerHTML = "";
  choices[bi].forEach(c => {
    const b = document.createElement("button"); b.textContent = c;
    if (c === picks[bi]) b.className = "sel";
    b.addEventListener("click", () => choose(c)); box.appendChild(b);
  });
  $("next").disabled = picks.includes(null);
  $("next").textContent = idx + 1 >= quiz.length ? "제출" : "다음";
}
function choose(c) {                  // 같은 보기를 다시 누르면 취소
  if (finished) return;
  const picks = answers[idx];
  if (picks[bi] === c) picks[bi] = null;
  else {
    picks[bi] = c;
    const nx = picks.findIndex((p, i) => p === null && i > bi), any = picks.indexOf(null);
    bi = nx >= 0 ? nx : any >= 0 ? any : bi;   // 다음 빈 빈칸으로 이동
  }
  renderQ();
}
$("sentence").addEventListener("click", e => {   // 빈칸을 누르면 그 빈칸 선택, 채운 빈칸을 다시 누르면 취소
  const s = e.target.closest(".blank"); if (!s || finished) return;
  const i = +s.dataset.i;
  if (i === bi && answers[idx][i] !== null) answers[idx][i] = null; else bi = i;
  renderQ();
});
$("next").addEventListener("click", () => {
  if (idx + 1 >= quiz.length) return finish(false);
  idx++; bi = 0; renderQ(); window.scrollTo(0, 0);
});

// ===== 결과 =====
function finish(timedOut) {
  if (finished) return; finished = true; clearInterval(timerId);
  // 점수는 빈칸 하나가 1점
  let right = 0, solved = 0, total = 0;
  const wrong = [];
  quiz.forEach(({ q }, i) => {
    const picks = answers[i];
    total += q.answers.length; solved += picks.filter(p => p !== null).length;
    const ok = q.answers.map((a, b) => picks[b] !== null && norm(picks[b]) === norm(a));
    right += ok.filter(Boolean).length;
    if (picks.some((p, b) => p !== null && !ok[b])) wrong.push({ q, ok, picks });
  });
  const sec = Math.round((Date.now() - startedAt) / 1000);
  $("score").innerHTML = `<div>${right}<small>/ ${total}</small></div>`;
  $("ring").style.setProperty("--p", total ? Math.round((right / total) * 100) : 0);
  $("wrongTitle").hidden = !wrong.length;
  $("sub").textContent = `${LEVEL_NAME[level]} · ${fmt(sec)}` + (timedOut ? ` · 시간 종료 (미응시 ${total - solved})` : "");
  $("wrongList").innerHTML = wrong.length
    ? wrong.map(({ q, ok, picks }) => {
        let n = 0;
        const t = layout(q.text).replace(/\{\{blank\}\}/g, () => { const b = n++; return `<b class="${ok[b] ? "good" : "ans"}">${esc(q.answers[b])}</b>`; });
        return `<div class="card passage">${t}</div>`;
      }).join("")
    : '<p class="note">틀린 문제가 없습니다.</p>';
  show("result"); window.scrollTo(0, 0);
  sendResult({
    time: new Date().toLocaleString("ko-KR"), name: $("name").value.trim(), level: LEVEL_NAME[level],
    total, score: right, solved, wrong: wrong.map(w => w.q.id).join(","), seconds: sec, timedOut: timedOut ? "Y" : "N"
  });
}

// ===== 스프레드시트 전송 (실패하면 기기에 보관했다가 다음 접속 때 다시 보냄) =====
const post = r => fetch(SHEET_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(r) });
const pending = () => { try { return JSON.parse(localStorage.getItem("pending") || "[]"); } catch (e) { return []; } };
const savePending = a => { try { localStorage.setItem("pending", JSON.stringify(a)); } catch (e) {} };
async function sendResult(r) {
  if (!SHEET_URL) return;
  try { await post(r); } catch (e) { savePending([...pending(), r]); }
}
async function retryPending() {
  if (!SHEET_URL) return;
  const keep = [];
  for (const r of pending()) { try { await post(r); } catch (e) { keep.push(r); } }
  savePending(keep);
}

load();
