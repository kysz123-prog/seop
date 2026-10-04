// ===== 설정 (여기만 고치면 됨) =====
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxT5-lAhEZetpBkVQdGbriYU2ClTeGtx9-WRPFuG13NzObmqOP5IzRPpEX0-KajcGU2TA/exec";                                // 구글 앱스 스크립트 웹앱 주소 (비워 두면 전송 안 함)
const MINUTES = { 50: 17, 100: 25, 200: 50, 300: 75 };        // 50개 17분, 100개당 25분 (난이도 상향)
const PASS = { basic: 80, adv: 80 };                   // 통과 점수(100점 만점) - 80점으로 엄격화
const IMG = { pass: "img/pass.webp", fail: "img/fail.webp" };
Object.values(IMG).forEach(s => { new Image().src = s; });   // 결과 사진 미리 불러오기
const CHOICE_MIN = 6, CHOICE_MAX = 8;                  // 보기 개수 6~8개로 확대 (난이도 상향)
const LEVEL_NAME = { basic: "기본형", adv: "심화형" };

// 불러오기 실패 때 쓰는 테스트용 샘플 5개
const SAMPLE = { basic: [
  { id: "s1", text: "1. 품사의 정의와 분류의 기준\n• 품사: 단어들을 {{blank}}이 공통된 것끼리 모아서 분류하여 놓은 {{blank}}", answers: ["성질", "갈래"] },
  { id: "s2", text: "(1) 격 조사: 앞말이 문장 안에서 일정한 자격을 가지도록 해 주는 조사\n종류\t기능\t예\n주격 조사\t앞말을 {{blank}}로 만들어 주는 조사\t이/가, 께서, 에서\n목적격 조사\t앞말을 {{blank}}로 만들어 주는 조사\t을/를", answers: ["주어", "목적어"] },
  { id: "s3", text: "1. 동음이의어\n• {{blank}}는 같으나 {{blank}}이 다른 단어. 단어들이 의미적으로 아무런 관련이 없다.", answers: ["소리", "뜻"] },
  { id: "s4", text: "1. 명사 vs 조사\n• 나도 참을 만큼 참았다. → '만큼'은 관형어 '참을'의 꾸밈을 받고, '참을' 없이 자립적으로 쓰일 수 없으므로 {{blank}}이다.", answers: ["의존 명사"] },
  { id: "s5", text: "(1) 단어의 {{blank}} 변화 여부에 따라\n- {{blank}}(형태가 변하지 않는 단어)와 가변어(형태가 변하는 단어)로 분류", answers: ["형태", "불변어"] }
] };
SAMPLE.adv = SAMPLE.basic;

// ===== 상태 =====
let DATA = null, level = "basic", count = 50;
let quiz = [], idx = 0, bi = 0, answers = [], startedAt = 0, timerId = null, deadline = 0, finished = false;
const $ = id => document.getElementById(id);

// ===== 유틸 =====
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => s.replace(/\s+/g, "");
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const show = id => ["start", "quiz", "result", "notes"].forEach(v => $(v).hidden = v !== id);
// 문단 글 → HTML: \t 있는 줄은 표의 한 행(첫 행은 머리글), 소제목 줄은 굵게. 세로(^)·가로(<) 병합 지원.
const isHead = l => l.length < 40 && !l.includes("{{blank}}") && /^(\d+\.|\(\d+\)|[①-⑳])\s/.test(l);
function layout(t) {
  const out = []; let rows = [];
  const flush = () => {
    if (!rows.length) return;
    const grid = rows.map(r => r.split("\t").map(c => ({ text: c, rowspan: 1, colspan: 1, skip: false })));
    const R = grid.length;
    for (let r = 0; r < R; r++) {
      const C = grid[r].length;
      for (let c = 0; c < C; c++) {
        const val = grid[r][c].text.trim();
        if (val === "^") {
          grid[r][c].skip = true;
          for (let pr = r - 1; pr >= 0; pr--) {
            if (!grid[pr][c].skip) {
              grid[pr][c].rowspan += 1;
              break;
            }
          }
        } else if (val === "<") {
          grid[r][c].skip = true;
          for (let pc = c - 1; pc >= 0; pc--) {
            if (!grid[r][pc].skip) {
              grid[r][pc].colspan += 1;
              break;
            }
          }
        }
      }
    }
    let html = "<table>";
    for (let r = 0; r < R; r++) {
      html += "<tr>";
      const tag = r === 0 ? "th" : "td";
      for (let c = 0; c < grid[r].length; c++) {
        const cell = grid[r][c];
        if (cell.skip) continue;
        const attr = (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "") +
                     (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : "");
        const formatted = cell.text.replace(/(.)\s*•\s*/g, "$1<br>• ");
        const alignStyle = cell.text.includes("•") ? ' style="text-align:left; padding-left:10px;"' : '';
        html += `<${tag}${attr}${alignStyle}>${formatted}</${tag}>`;
      }
      html += "</tr>";
    }
    html += "</table>";
    out.push(html);
    rows = [];
  };
  for (const l of esc(t).split("\n")) {
    if (l.includes("\t")) rows.push(l);
    else { flush(); out.push(`<p${isHead(l) ? ' class="h"' : ""}>${l.replace(/(.)\s*•\s*/g, "$1<br>• ")}</p>`); }
  }
  flush();
  return out.join("");
}
const p2 = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const fmt = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

// ===== 데이터 불러오기 =====
async function load() {
  if (window.QUESTIONS) { DATA = window.QUESTIONS; checkResume(); return retryPending(); }
  try {
    const r = await fetch("questions.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    DATA = SAMPLE; failMsg = "문제 파일을 못 불러와 샘플로 실행 중입니다. ";
    refreshStart();
  }
  checkResume();
  retryPending();
}

// ===== 시작 화면 =====
let failMsg = "";
function refreshStart() {
  $("info").textContent = failMsg + (count ? `${LEVEL_NAME[level]}: 빈칸 약 ${count}개 · 제한 ${MINUTES[count] || 25}분` : "");
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
$("again").addEventListener("click", () => { show("start"); checkResume(); });

// 초기 선택값 반영
setTimeout(() => {
  const lb = $("levelGroup").querySelector(`button[data-level="${level}"]`);
  if (lb) lb.classList.add("on");
  const cb = $("countGroup").querySelector(`button[data-count="${count}"]`);
  if (cb) cb.classList.add("on");
  refreshStart();
}, 0);

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

// 같은 범주 묶음: 국어 문법 개념어 대폭 확장 (헷갈리는 선택지 배치로 난이도 극대화)
const GROUPS = [
  // 1. 품사 분류 체계
  { words: ["명사", "대명사", "수사", "동사", "형용사", "관형사", "부사", "조사", "감탄사"] },
  { words: ["체언", "용언", "수식언", "관계언", "독립언"] },
  { words: ["불변어", "가변어"] },

  // 2. 체언 세부
  { words: ["고유 명사", "보통 명사"] },
  { words: ["자립 명사", "의존 명사"] },
  { words: ["인칭 대명사", "지시 대명사"] },
  { words: ["양수사", "서수사"] },

  // 3. 관계언(조사) 세부
  { words: ["격 조사", "보조사", "접속 조사"] },
  { words: ["주격 조사", "서술격 조사", "목적격 조사", "보격 조사", "관형격 조사", "부사격 조사", "호격 조사"] },
  { words: ["주격", "서술격", "목적격", "보격", "관형격", "부사격", "호격"] },

  // 4. 용언 및 어간/어미
  { words: ["본용언", "보조 용언"] },
  { words: ["어간", "어미"] },
  { words: ["선어말 어미", "어말 어미"] },
  { words: ["종결 어미", "연결 어미", "전성 어미"] },
  { words: ["명사형 전성 어미", "관형사형 전성 어미", "부사형 전성 어미"] },
  { words: ["대등적 연결 어미", "종속적 연결 어미", "보조적 연결 어미"] },
  { words: ["규칙 활용", "불규칙 활용"] },

  // 5. 형태소 및 단어 형성
  { words: ["자립 형태소", "의존 형태소"] },
  { words: ["실질 형태소", "형식 형태소"] },
  { words: ["자립", "의존"] },
  { words: ["실질", "형식"] },
  { words: ["어근", "접사"] },
  { words: ["접두사", "접미사"] },
  { words: ["단일어", "복합어"] },
  { words: ["합성어", "파생어"] },
  { words: ["단일어", "합성어", "파생어"] },
  { words: ["통사적 합성어", "비통사적 합성어"] },
  { words: ["통사적", "비통사적"] },
  { words: ["대등 합성어", "종속 합성어", "융합 합성어"] },
  { words: ["대등", "종속", "융합"] },

  // 6. 문장 성분
  { words: ["주어", "서술어", "목적어", "보어", "관형어", "부사어", "독립어"] },
  { words: ["주성분", "부속 성분", "독립 성분"] },
  { words: ["필수적 부사어", "수의적 부사어"] },
  { words: ["관형사", "관형어"] },
  { words: ["관형사", "형용사의 관형사형", "동사의 관형사형", "용언의 관형사형"] },
  { words: ["부사", "부사어"] },
  { words: ["보어", "목적어"] },

  // 7. 문장의 짜임
  { words: ["홑문장", "겹문장"] },
  { words: ["이어진문장", "안은문장"] },
  { words: ["이어진 문장", "안은문장"] },
  { words: ["대등하게 이어진 문장", "종속적으로 이어진 문장"] },
  { words: ["대등", "종속"] },
  { words: ["명사절", "관형사절", "부사절", "서술절", "인용절"] },
  { words: ["직접 인용", "간접 인용"] },
  { words: ["라고", "고"] },

  // 8. 문법 요소: 높임법
  { words: ["주체 높임법", "객체 높임법", "상대 높임법"] },
  { words: ["주체 높임", "객체 높임", "상대 높임"] },
  { words: ["직접 높임", "간접 높임"] },
  { words: ["격식체", "비격식체"] },
  { words: ["하십시오체", "하오체", "하게체", "해라체"] },
  { words: ["해요체", "해체"] },

  // 9. 문법 요소: 피동 / 사동
  { words: ["능동", "피동"] },
  { words: ["주동", "사동"] },
  { words: ["능동문", "피동문"] },
  { words: ["주동문", "사동문"] },
  { words: ["파생적 피동", "통사적 피동"] },
  { words: ["파생적 사동", "통사적 사동"] },
  { words: ["직접 사동", "간접 사동"] },

  // 10. 문법 요소: 시제 / 동작상
  { words: ["과거 시제", "현재 시제", "미래 시제"] },
  { words: ["과거", "현재", "미래"] },
  { words: ["진행상", "완료상"] },
  { words: ["진행", "완료"] },

  // 11. 문법 요소: 부정 표현 & 종결 표현
  { words: ["평서문", "의문문", "명령문", "청유문", "감탄문"] },
  { words: ["판정 의문문", "설명 의문문", "수사 의문문"] },
  { words: ["안 부정문", "못 부정문"] },
  { words: ["짧은 부정문", "긴 부정문"] },
  { words: ["의지 부정", "능력 부정"] },

  // 12. 음운 변동
  { words: ["교체", "탈락", "첨가", "축약"] },
  { words: ["음절의 끝소리 규칙", "비음화", "유음화", "구개음화", "된소리되기"] },
  { words: ["자음군 단순화", "두음 법칙", "모음 탈락", "'ㄹ' 탈락", "'ㅎ' 탈락"] },
  { words: ["ㄴ 첨가", "반모음 첨가"] },
  { words: ["거센소리되기", "자음 축약", "모음 축약"] },

  // 13. 의미 관계
  { words: ["동음이의어", "다의어"] },
  { words: ["동음이의 관계", "다의 관계"] },
  { words: ["유의 관계", "반의 관계", "상하 관계"] },
  { words: ["유의어", "반의어", "상위어", "하위어"] }
];

function groupMates(a, q) {
  const g = GROUPS.find(g => g.words.some(w => norm(w) === norm(a)) && (!g.when || g.when.test(q.text)));
  return g ? g.words.filter(w => norm(w) !== norm(a)) : [];
}

function makeChoices(q, all) {        // 빈칸마다 헷갈리는 보기 세트 생성 (6~8지선다)
  const used = new Set(q.answers.map(norm));
  const pool = nearPool(all, all.indexOf(q), used);
  return q.answers.map(a => {
    const n = CHOICE_MIN + Math.floor(Math.random() * (CHOICE_MAX - CHOICE_MIN + 1));   // 6~8개
    const mates = shuffle(groupMates(a, q)).slice(0, n - 1), have = new Set(mates.map(norm));
    const wrong = [...mates, ...shuffle(pool).filter(w => !have.has(norm(w))).slice(0, n - 1 - mates.length)];
    return shuffle([a, ...wrong]);
  });
}

function startQuiz() {
  const all = (DATA && DATA[level]) || (level === "basic" ? SAMPLE.basic : SAMPLE.adv || SAMPLE.basic);
  quiz = []; let sum = 0;
  for (const q of shuffle(all)) {
    if (sum >= count) break;
    quiz.push({ q, choices: makeChoices(q, all) });
    sum += q.answers.length;
  }
  clearTimeout(autoId); idx = 0; bi = 0; answers = quiz.map(x => x.q.answers.map(() => null)); finished = false;
  startedAt = Date.now(); deadline = startedAt + (MINUTES[count] || 25) * 60000;
  enterQuiz();
}

function enterQuiz() {
  show("quiz"); renderQ();
  clearInterval(timerId); timerId = setInterval(tick, 500); tick();
  saveSession();
  history.pushState({ quiz: 1 }, "");
  keepAwake();
}

function tick() {
  const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  $("timer").textContent = fmt(left);
  $("timer").classList.toggle("low", left <= 60);
  if (left <= 0) finish(true);
}

// 한 문단 그리기
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
  $("prev").disabled = idx === 0;
  const last = idx + 1 >= quiz.length;
  $("next").hidden = !last && picks.includes(null);
  $("next").disabled = picks.includes(null);
  $("next").textContent = idx + 1 >= quiz.length ? "제출" : "다음";
}

function choose(c) {
  if (finished) return;
  const picks = answers[idx];
  if (picks[bi] === c) picks[bi] = null;
  else {
    picks[bi] = c;
    const nx = picks.findIndex((p, i) => p === null && i > bi), any = picks.indexOf(null);
    bi = nx >= 0 ? nx : any >= 0 ? any : bi;
  }
  saveSession();
  renderQ();
  clearTimeout(autoId);
  if (!picks.includes(null) && idx + 1 < quiz.length) {
    $("next").hidden = true; const at = idx;
    autoId = setTimeout(() => { if (idx === at && !finished) go(1); }, 400);
  }
}

let autoId = null;
function go(d) {
  clearTimeout(autoId);
  idx += d; const e = answers[idx].indexOf(null); bi = e >= 0 ? e : 0;
  saveSession();
  renderQ(); window.scrollTo(0, 0);
}

$("sentence").addEventListener("click", e => {
  const s = e.target.closest(".blank"); if (!s || finished) return;
  const i = +s.dataset.i;
  if (i === bi && answers[idx][i] !== null) answers[idx][i] = null; else bi = i;
  saveSession();
  renderQ();
});

$("next").addEventListener("click", () => {
  if (idx + 1 >= quiz.length) return finish(false);
  go(1);
});
$("prev").addEventListener("click", () => { if (idx > 0 && !finished) go(-1); });

// 두 빈칸 i, j가 문항 q 내에서 대등한 관계인지 판별 (순서 바뀌어도 정답 처리)
function areEquivBlanks(q, i, j) {
  if (i === j) return false;
  const a1 = q.answers[i], a2 = q.answers[j];
  if (!a1 || !a2) return false;

  // 1. 같은 GROUPS 범주에 속해야 함
  const inSameGroup = GROUPS.some(g =>
    g.words.some(w => norm(w) === norm(a1)) &&
    g.words.some(w => norm(w) === norm(a2)) &&
    (!g.when || g.when.test(q.text))
  );
  if (!inSameGroup) return false;

  // 2. 텍스트 분할 및 위치 검사
  const parts = q.text.split("{{blank}}");
  if (parts.length !== q.answers.length + 1) return false;

  const minI = Math.min(i, j), maxI = Math.max(i, j);
  let mid = "";
  for (let k = minI + 1; k <= maxI; k++) mid += parts[k];
  mid = mid.trim();

  // 3. 줄바꿈, 탭, 콜론(:), 괄호 설명 ( ), 개별 조건이 있으면 개별 정의이므로 대등하지 않음
  if (/[\n\t:]/.test(mid)) return false;
  if (/\(.*?\)/.test(mid)) return false;
  if (/[은는이가]\s*결합한 것은/.test(mid)) return false;

  // 따옴표/기호 제거한 clean 문자열
  const midClean = mid.replace(/['"‘’“”,·/]/g, "").trim();

  // 4. 대등 나열 패턴
  // - 접속 조사 나열 (예: "와", "과", "및", "또는", 따옴표 붙은 "와 '")
  if (/^(와|과|및|또는)$/.test(midClean)) return true;
  // - 쉼표/슬래시/가운뎃점 나열 (예: ", ", ", 수식언, ", " / ")
  if (/^([,·/]\s*([가-힣]+[,·/]\s*)*)$/.test(mid)) return true;
  if (/^(와|과|및|또는|,|\/|·)\s*$/.test(mid)) return true;
  if (/^[가-힣]+(와|과|및|,|\/)\s*$/.test(mid)) return true;
  // - 문장 끝부분에 대등 나열 구문이 있고 mid가 단순 조사/구분자인 경우
  const after = parts[maxI + 1] || "";
  if (/등에도 붙는다|등으로|로 나뉜다|로 분류|포함되어 있으므로|쓰일 때도 있다|모두 쓰이므로/.test(after)) {
    if (!/[은는이가를]\s+[가-힣]+[은는]/.test(mid) && mid.length <= 15) return true;
  }

  return false;
}

// 문항 q에 대해 학생의 답변 picks 채점 (대등 빈칸은 순서 바뀌어도 유연하게 정답 처리)
function gradeQuestion(q, picks) {
  const n = q.answers.length;
  const ok = new Array(n).fill(false);

  // 대등 클러스터 생성 (Union-Find)
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x, y) => { parent[find(x)] = find(y); };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areEquivBlanks(q, i, j)) union(i, j);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }

  // 클러스터별 채점
  clusters.forEach(indices => {
    const unpickedAnswers = [];
    const unsolvedIndices = [];
    indices.forEach(idx => {
      const p = picks[idx], a = q.answers[idx];
      if (p !== null && norm(p) === norm(a)) {
        ok[idx] = true;
      } else {
        unpickedAnswers.push(a);
        unsolvedIndices.push(idx);
      }
    });

    unsolvedIndices.forEach(idx => {
      const p = picks[idx];
      if (p !== null) {
        const matchIdx = unpickedAnswers.findIndex(a => norm(a) === norm(p));
        if (matchIdx >= 0) {
          ok[idx] = true;
          unpickedAnswers.splice(matchIdx, 1);
        }
      }
    });
  });

  return ok;
}

// ===== 결과 =====
function finish(timedOut) {
  if (finished) return; finished = true; clearInterval(timerId);
  releaseAwake();
  clearSession();
  let right = 0, solved = 0, total = 0;
  const wrong = [];
  quiz.forEach(({ q }, i) => {
    const picks = answers[i];
    total += q.answers.length; solved += picks.filter(p => p !== null).length;
    const ok = gradeQuestion(q, picks);
    right += ok.filter(Boolean).length;
    if (picks.some((p, b) => p !== null && !ok[b])) wrong.push({ q, ok, picks });
  });
  const sec = Math.round((Date.now() - startedAt) / 1000);
  const pct = total ? Math.round((right / total) * 100) : 0, passed = pct >= PASS[level];
  $("score").innerHTML = `<div>${pct}<small>점</small></div>`;
  $("ring").style.setProperty("--p", pct);
  $("resultImg").src = passed ? IMG.pass : IMG.fail;
  $("verdict").textContent = passed ? "통과! 🎉" : "아쉽다… 다시 도전!";
  $("verdict").className = passed ? "pass" : "fail";
  $("reveal").classList.toggle("is-fail", !passed);
  $("wrongTitle").hidden = !wrong.length;
  $("sub").textContent = `맞힌 빈칸 ${right} / ${total} · ${LEVEL_NAME[level]} 통과 ${PASS[level]}점 · ${fmt(sec)}` + (timedOut ? ` · 시간 종료 (미응시 ${total - solved})` : "");
  
  // 내가 답한 오답 ➔ 정답 비교 표시 (맞힌 빈칸은 학생 선택 그대로 인정)
  $("wrongList").innerHTML = wrong.length
    ? wrong.map(({ q, ok, picks }) => {
        let n = 0;
        const t = layout(q.text).replace(/\{\{blank\}\}/g, () => {
          const b = n++, isOk = ok[b], pick = picks[b], ans = q.answers[b];
          if (isOk) {
            return `<b class="good">${esc(pick || ans)}</b>`;
          } else {
            return `<span class="wrong-box"><b class="my-pick">${esc(pick || "미응시")}</b><span class="arrow">➔</span><b class="ans">${esc(ans)}</b></span>`;
          }
        });
        return `<div class="card passage">${t}</div>`;
      }).join("")
    : '<p class="note">틀린 문제가 없습니다.</p>';

  show("result"); window.scrollTo(0, 0);
  $("suspense").hidden = false; $("reveal").hidden = true;
  setTimeout(() => { $("suspense").hidden = true; $("reveal").hidden = false; }, 2000);

  const levelText = `${LEVEL_NAME[level]}(${count}개)`;
  saveWrongNotes(wrong, levelText);
  sendResult({
    time: stamp(new Date()), name: $("name").value.trim(), level: levelText,
    total, score: right, solved, wrong: wrong.map(w => w.q.id).join(","), seconds: sec, timedOut: timedOut ? "Y" : "N"
  });
}

// ===== 스프레드시트 전송 =====
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

// ===== 오답노트 (로컬 스토리지 보관) =====
function getWrongNotes() {
  try { return JSON.parse(localStorage.getItem("wrongNotes") || "[]"); } catch (e) { return []; }
}
function saveWrongNotes(wrongItems, levelText) {
  if (!wrongItems || !wrongItems.length) return;
  const current = getWrongNotes();
  const now = stamp(new Date());
  wrongItems.forEach(({ q, ok, picks }) => {
    const idx = current.findIndex(x => x.id === q.id);
    const item = {
      id: q.id, text: q.text, answers: q.answers,
      ok, picks, level: levelText, time: now
    };
    if (idx >= 0) current[idx] = item;
    else current.unshift(item);
  });
  try { localStorage.setItem("wrongNotes", JSON.stringify(current)); } catch (e) {}
  updateNotesBadge();
}
function updateNotesBadge() {
  const cnt = getWrongNotes().length;
  const el = $("notesBadge"); if (el) el.textContent = cnt;
}
function renderNotes() {
  const notes = getWrongNotes();
  const box = $("notesList");
  if (!notes.length) {
    box.innerHTML = '<div class="card passage"><p class="note" style="padding: 24px 0;">아직 저장된 오답이 없습니다.<br>문제를 풀고 틀린 문항이 생기면 여기에 자동으로 모입니다!</p></div>';
    return;
  }
  box.innerHTML = notes.map((item, i) => {
    let n = 0;
    const t = layout(item.text).replace(/\{\{blank\}\}/g, () => {
      const b = n++, isOk = item.ok[b], pick = item.picks[b], ans = item.answers[b];
      if (isOk) {
        return `<b class="good">${esc(pick || ans)}</b>`;
      } else {
        return `<span class="wrong-box"><b class="my-pick">${esc(pick || "미응시")}</b><span class="arrow">➔</span><b class="ans">${esc(ans)}</b></span>`;
      }
    });
    return `
      <div class="card passage" style="margin-bottom: 20px;">
        <div class="notes-meta">
          <span>#${i + 1} [${esc(item.level)}]</span>
          <span>${esc(item.time)}</span>
        </div>
        ${t}
      </div>`;
  }).join("");
}

// 오답노트 화면 이벤트
$("btnNotes").addEventListener("click", () => { renderNotes(); show("notes"); window.scrollTo(0, 0); });
const resNotesBtn = $("btnResultNotes");
if (resNotesBtn) resNotesBtn.addEventListener("click", () => { renderNotes(); show("notes"); window.scrollTo(0, 0); });
$("btnNotesBack").addEventListener("click", () => { show("start"); updateNotesBadge(); checkResume(); window.scrollTo(0, 0); });
$("btnClearNotes").addEventListener("click", () => {
  if (confirm("오답노트를 모두 비우시겠습니까?")) {
    try { localStorage.removeItem("wrongNotes"); } catch (e) {}
    renderNotes(); updateNotesBadge();
  }
});

// ===== 풀던 문제 보관 (탭이 닫히거나 새로고침돼도 이어 풀기) =====
const SKEY = "session";
function saveSession() {
  if (finished || !quiz.length) return;
  try {
    localStorage.setItem(SKEY, JSON.stringify({
      level, count, name: $("name").value.trim(), startedAt, deadline, idx, bi, answers,
      quiz: quiz.map(x => ({ id: x.q.id, choices: x.choices }))
    }));
  } catch (e) {}
}
function clearSession() { try { localStorage.removeItem(SKEY); } catch (e) {} }
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || "null");
    const pool = s && DATA && DATA[s.level];
    if (!pool) return null;
    const byId = new Map(pool.map(q => [q.id, q]));
    const qz = s.quiz.map(x => ({ q: byId.get(x.id), choices: x.choices }));
    if (!qz.length || qz.some(x => !x.q || x.choices.length !== x.q.answers.length)) return null;
    return { ...s, quiz: qz };
  } catch (e) { return null; }
}

let saved = null;
function checkResume() {
  saved = loadSession();
  if (!saved) { clearSession(); $("resume").hidden = true; return; }
  const left = Math.max(0, Math.ceil((saved.deadline - Date.now()) / 1000));
  const done = saved.answers.flat().filter(p => p !== null).length, all = saved.answers.flat().length;
  const lv = `${LEVEL_NAME[saved.level] || saved.level}(${saved.count}개)`;
  $("resumeInfo").innerHTML = `<b>${esc(saved.name || "이름 없음")}</b> · ${lv} 풀던 문제가 있어요.<br>` +
    (left > 0 ? `빈칸 ${done} / ${all} 완료 · 남은 시간 ${fmt(left)}` : `제한시간이 끝났어요. 푼 데까지 채점합니다.`);
  $("btnResume").textContent = left > 0 ? "이어서 풀기" : "결과 보기";
  $("resume").hidden = false;
}

$("btnResume").addEventListener("click", () => {
  const s = saved; if (!s) return;
  level = s.level; count = s.count; $("name").value = s.name;
  [...$("levelGroup").children].forEach(x => x.classList.toggle("on", x.dataset.level === level));
  [...$("countGroup").children].forEach(x => x.classList.toggle("on", +x.dataset.count === count));
  refreshStart();
  quiz = s.quiz; answers = s.answers; idx = Math.min(s.idx, quiz.length - 1); bi = s.bi;
  startedAt = s.startedAt; deadline = s.deadline; finished = false; clearTimeout(autoId);
  $("resume").hidden = true; saved = null;
  enterQuiz();
});

$("btnDiscard").addEventListener("click", () => {
  if (!confirm("풀던 문제를 버리고 처음부터 시작할까요?")) return;
  clearSession(); saved = null; $("resume").hidden = true;
});

const solving = () => !$("quiz").hidden && !finished;
window.addEventListener("popstate", () => { if (solving()) history.pushState({ quiz: 1 }, ""); });
window.addEventListener("beforeunload", e => { if (solving()) { saveSession(); e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("pagehide", saveSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveSession();
  else if (solving()) keepAwake();
});

// 화면 꺼짐 방지
let wakeLock = null;
async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {}
}
function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

updateNotesBadge();
load();
