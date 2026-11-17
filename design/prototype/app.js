/*
 * 시안 B 공용 셸: 사이드바(Workspace 전환기 + 홈), 런 상태·이유 헬퍼,
 * 목록 행과 상세 패널 렌더러, 목록 ↔ 패널 선택 동작.
 * 각 화면은 <body data-page="..."> 와 #page 를 두고 FO.mount(page, render) 를 부른다.
 */
(function () {
  const FO = window.FO;

  const svg = (d, extra = "") => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const icon = {
    home: svg('<path d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-3v-4H6v4H3a.5.5 0 0 1-.5-.5Z"/>'),
    tickets: svg('<path d="M5.5 4h7M5.5 8h7M5.5 12h7"/><circle cx="2.75" cy="4" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="8" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="12" r=".75" fill="currentColor" stroke="none"/>'),
    runs: svg('<path d="M1.5 8h3l1.75-4.5 3.5 9L11.5 8h3"/>'),
    runners: svg('<rect x="2" y="2.5" width="12" height="4.5" rx="1.25"/><rect x="2" y="9" width="12" height="4.5" rx="1.25"/><path d="M4.5 4.75h.01M4.5 11.25h.01" stroke-width="2"/>'),
    stats: svg('<path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5"/>'),
    settings: svg('<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'),
    chevron: svg('<path d="m5 6.5 3 3 3-3"/>'),
    check: svg('<path d="m3.5 8.5 3 3 6-7"/>', ' stroke-width="1.75"'),
    x: svg('<path d="m4 4 8 8M12 4l-8 8"/>', ' stroke-width="1.75"'),
    external: svg('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
    arrow: svg('<path d="M3 8h10M9 4l4 4-4 4"/>'),
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function minutes(m) {
    if (m < 60) return `${m}분`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}시간 ${r}분` : `${h}시간`;
  }

  /*
   * 값 뒤 조사: 마지막 글자의 받침으로 고른다. 한글 음절과 숫자(읽는 소리)만 보고,
   * 그 밖의 글자(영문 등)는 받침 없음으로 본다.
   * pair는 "을/를", "이/가", "은/는", "과/와", "으로/로"처럼 받침 있을 때/없을 때 순서다.
   */
  const DIGIT_FINAL = { 0: 21, 1: 8, 2: 0, 3: 16, 4: 0, 5: 0, 6: 1, 7: 8, 8: 8, 9: 0 };
  function finalOf(word) {
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
    if (ch >= "0" && ch <= "9") return DIGIT_FINAL[ch];
    return 0;
  }
  function josa(word, pair) {
    const [withFinal, without] = pair.split("/");
    const f = finalOf(word);
    /* 으로/로: 받침이 없거나 ㄹ이면 '로' */
    const useWithout = withFinal === "으로" ? f === 0 || f === 8 : f === 0;
    return `${word}${useWithout ? without : withFinal}`;
  }

  /* ---------- Workspace ---------- */
  const WS_KEY = "fo-b-ws";
  const validWs = (id) => id === "all" || FO.workspaces.some((w) => w.id === id);
  function readWs() {
    const q = new URLSearchParams(location.search).get("ws");
    if (validWs(q)) return q;
    try {
      const saved = localStorage.getItem(WS_KEY);
      return validWs(saved) ? saved : "commerce";
    } catch (e) {
      return "commerce";
    }
  }
  let ws = readWs();
  const wsName = (id) => (id === "all" ? "전체" : FO.workspaces.find((w) => w.id === id).name);
  const inWs = (run) => ws === "all" || FO.workspaceOfRun(run).id === ws;
  const ticketInWs = (t) => ws === "all" || FO.workspaceOfProject(t.project).id === ws;

  /* ---------- 런 상태 ---------- */
  const failLabel = { agent: "에이전트 오류", runner: "러너 연결 끊김", closed: "PR이 닫힘" };
  const resultLabel = { merged: "Merged", check: "Human Check", failed: "Failed" };

  function tone(run) {
    if (run.state === "queued") return "neutral";
    if (run.state === "running") return "running";
    return run.result === "merged" ? "neutral" : run.result;
  }

  function label(run) {
    if (run.state === "queued") return "Queued";
    if (run.state === "running") return "진행 중";
    return resultLabel[run.result];
  }

  /* 행 아래 한 줄 이유 */
  function shortWhy(run) {
    if (run.result === "check") return run.pr.ci === "failed" ? `PR #${run.pr.number} 열림 · CI 실패` : `PR #${run.pr.number} 열림 · 확인이 필요해요`;
    if (run.result === "failed") return failLabel[run.failReason];
    if (run.state === "running") return run.step;
    if (run.state === "queued") return run.reason;
    return `PR #${run.pr.number} 병합`;
  }

  function longWhy(run) {
    if (run.state === "running") return `${run.step}. ${run.started}에 시작했어요.`;
    if (run.state === "queued") return `${run.reason}. 들어온 순서대로 시작하고, 지금 대기열 ${run.position}번째예요.`;
    if (run.result === "merged") return `에이전트가 CI 통과를 확인하고 ${josa(`PR #${run.pr.number}`, "을/를")} 병합했어요.`;
    return run.note;
  }

  function timeCell(run) {
    if (run.state === "queued") return `Queued ${minutes(run.waited)}`;
    return minutes(run.elapsed);
  }

  const latestByTicket = () => {
    const seen = new Set();
    return FO.runs
      .slice()
      .sort((a, b) => b.id - a.id)
      .filter((r) => (seen.has(r.ticket) ? false : seen.add(r.ticket)));
  };
  /* 손댈 일: 티켓마다 마지막 런이 Human Check·Failed 인 것 */
  const attention = () => latestByTicket().filter((r) => r.state === "done" && r.result !== "merged" && inWs(r));

  /* ---------- 목록 행 ---------- */
  const stateText = (run) => `<span class="state" data-tone="${tone(run)}">${label(run)}</span>`;

  function runRow(run, opts = {}) {
    const t = FO.ticket(run.ticket);
    const showWhy = opts.why ?? (run.state === "done" && run.result !== "merged");
    const why = showWhy
      ? `<span class="row-why">${run.result === "check" || run.result === "failed" ? `<span class="dot" data-tone="${run.result}" aria-hidden="true"></span>${stateText(run)}<span class="sep" aria-hidden="true">·</span>` : ""}<span>${esc(shortWhy(run))}</span></span>`
      : "";
    const third = opts.wsCol ? esc(FO.workspaceOfRun(run).name) : esc(FO.agents[run.agent]);
    const last = run.pr ? `#${run.pr.number}` : "—";
    const status = opts.statusCol ? `<span class="cell">${run.result === "check" || run.result === "failed" ? `<span class="dot" data-tone="${run.result}" aria-hidden="true"></span> ` : ""}${stateText(run)}</span>` : "";
    return `<button class="row" type="button" role="option" aria-selected="false" data-key="run:${run.id}" data-href="run.html?id=${run.id}">
      <span class="cell"><span class="row-title">${esc(t.title)}</span>${why}</span>${status}
      <span class="cell id">${run.ticket}</span>
      <span class="cell">${run.runner}</span>
      <span class="cell">${third}</span>
      <span class="cell num r">${timeCell(run)}</span>
      <span class="cell num r">${last}</span>
    </button>`;
  }

  function thead(cols) {
    return `<div class="thead" aria-hidden="true">${cols.map((c) => `<span class="${c.r ? "r" : ""}">${c.label}</span>`).join("")}</div>`;
  }

  const runCols = (opts = {}) => [
    { label: "제목" },
    ...(opts.statusCol ? [{ label: "상태" }] : []),
    { label: "티켓" },
    { label: "러너" },
    { label: opts.wsCol ? "Workspace" : "에이전트" },
    { label: "경과", r: true },
    { label: "PR", r: true },
  ];

  /* ---------- 상세 패널: 런 ---------- */
  const ciLabel = { passed: "통과", failed: "실패", running: "도는 중" };
  const prLabel = { open: "열림", merged: "병합됨", closed: "닫힘" };

  function events(run) {
    const d = FO.runDetails[run.id];
    if (d) return d.timeline;
    const list = [];
    if (run.state === "queued") {
      list.push({ time: run.queued, label: "할당했어요", detail: "Queued로 기다리고 있어요" });
      return list;
    }
    list.push({ time: run.started, label: "에이전트를 시작했어요", detail: `${FO.agents[run.agent]} · ${run.runner}` });
    if (run.pr) list.push({ time: "", label: `${josa(`PR #${run.pr.number}`, "을/를")} 열었어요`, detail: "" });
    if (run.state === "running") list.push({ time: "지금", label: run.step, detail: "" });
    if (run.state === "done") {
      const tail = { merged: "PR을 병합하고 끝났어요", check: "PR이 열린 채 끝났어요", failed: `${josa(failLabel[run.failReason], "으로/로")} 끝났어요` }[run.result];
      list.push({ time: run.ended, label: tail, detail: "", tone: run.result === "merged" ? "" : run.result });
    }
    return list;
  }

  function runActions(run) {
    const prBtn = (primary) => `<a class="btn ${primary ? "btn-primary" : ""}" href="https://github.example.com/acme/pull/${run.pr.number}" target="_blank" rel="noreferrer">PR #${run.pr.number} 열기${icon.external}</a>`;
    const rerun = (primary) => `<button class="btn ${primary ? "btn-primary" : ""}" type="button" data-toast="새 런을 시작했어요. 대기열에 넣었어요">새 런 시작</button>`;
    if (run.result === "check") return prBtn(true) + rerun(false);
    if (run.result === "failed") return rerun(true) + (run.failReason === "runner" ? `<a class="btn" href="runners.html?sel=${run.runner}">${run.runner} 보기</a>` : "");
    if (run.state === "queued" && !FO.runner(run.runner).online) return `<a class="btn" href="runners.html?sel=${run.runner}">${run.runner} 보기</a>`;
    if (run.result === "merged") return prBtn(false);
    if (run.state === "running" && run.pr) return prBtn(false);
    return "";
  }

  function runPanel(run) {
    const t = FO.ticket(run.ticket);
    const ws = FO.workspaceOfRun(run);
    const when =
      run.state === "done" ? `${run.ended}에 끝났어요` : run.state === "running" ? `${minutes(run.elapsed)}째` : `${minutes(run.waited)}째 기다리는 중`;
    const dot = run.result === "check" || run.result === "failed" ? `<span class="dot" data-tone="${run.result}" aria-hidden="true"></span>` : "";
    const props = [
      ["러너", `${run.runner}${FO.runner(run.runner).online ? "" : '<span class="muted">Offline</span>'}`],
      ["에이전트", FO.agents[run.agent]],
      run.state === "queued" ? ["들어온 시각", run.queued] : ["시작", `${run.started}${run.ended ? `<span class="muted">→ ${run.ended}</span>` : ""}`],
      [run.state === "queued" ? "기다린 시간" : "경과 시간", run.state === "queued" ? minutes(run.waited) : minutes(run.elapsed)],
      ["PR", run.pr ? `#${run.pr.number}<span class="muted">${prLabel[run.pr.state]}</span>` : '<span class="none">없음</span>'],
      ["CI", run.pr ? ciLabel[run.pr.ci] : '<span class="none">—</span>'],
      ["Workspace", `${esc(ws.name)}<span class="muted">${esc(t.project)}</span>`],
    ];
    const acts = runActions(run);
    return `<div class="panel-inner">
      <div class="panel-head">
        <p class="panel-state">${dot}${stateText(run)}<span class="muted">${when}</span></p>
        <h2 class="panel-title">${esc(t.title)}</h2>
        <p class="panel-sub num">${run.ticket} · Run ${run.id}</p>
      </div>
      <p class="panel-why">${esc(longWhy(run))}</p>
      ${acts ? `<div class="actions">${acts}</div>` : ""}
      <dl class="props">${props.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      <div>
        <h3 class="panel-block-title">기록</h3>
        <ol class="events">${events(run)
          .slice(-4)
          .map((e) => `<li class="event" data-tone="${e.tone || ""}"><time>${e.time}</time><span class="event-label">${esc(e.label)}</span></li>`)
          .join("")}</ol>
      </div>
      <div class="panel-foot"><a class="link" href="run.html?id=${run.id}">런 상세 보기</a></div>
    </div>`;
  }

  /* ---------- 목록 ↔ 패널 ---------- */
  function bindSplit(root, panel, renderers, initial) {
    const rows = () => [...root.querySelectorAll(".row[data-key]")];
    function select(key, focus) {
      const all = rows();
      const row = all.find((r) => r.dataset.key === key) || all[0];
      all.forEach((r) => r.setAttribute("aria-selected", String(r === row)));
      if (!row) {
        panel.innerHTML = "";
        return;
      }
      const [kind, id] = row.dataset.key.split(":");
      panel.innerHTML = renderers[kind](id);
      if (focus) row.focus();
      const url = new URL(location.href);
      url.searchParams.set("sel", row.dataset.key.split(":")[1]);
      try {
        history.replaceState(null, "", url);
      } catch (e) {
        /* file:// 에서 막혀도 선택은 된다 */
      }
    }
    root.addEventListener("click", (e) => {
      const row = e.target.closest(".row[data-key]");
      if (row) select(row.dataset.key);
    });
    root.addEventListener("dblclick", (e) => {
      const row = e.target.closest(".row[data-href]");
      if (row) location.href = row.dataset.href;
    });
    root.addEventListener("keydown", (e) => {
      const row = e.target.closest(".row[data-key]");
      if (!row) return;
      const all = rows();
      const i = all.indexOf(row);
      if (e.key === "ArrowDown" && all[i + 1]) {
        e.preventDefault();
        select(all[i + 1].dataset.key, true);
      } else if (e.key === "ArrowUp" && all[i - 1]) {
        e.preventDefault();
        select(all[i - 1].dataset.key, true);
      } else if (e.key === "Enter" && row.dataset.href && row.getAttribute("aria-selected") === "true") {
        e.preventDefault();
        location.href = row.dataset.href;
      }
    });
    const sel = new URLSearchParams(location.search).get("sel");
    const want = sel ? rows().find((r) => r.dataset.key.endsWith(":" + sel)) : null;
    select(want ? want.dataset.key : initial);
  }

  /* ---------- 사이드바 ---------- */
  const pages = [
    { id: "home", href: "index.html", label: "홈", icon: icon.home },
    { id: "tickets", href: "tickets.html", label: "Tickets", icon: icon.tickets },
    { id: "runs", href: "runs.html", label: "Runs", icon: icon.runs },
    { id: "runners", href: "runners.html", label: "Runners", icon: icon.runners },
    { id: "stats", href: "stats.html", label: "Stats", icon: icon.stats },
    { id: "settings", href: "settings.html", label: "Settings", icon: icon.settings },
  ];

  function runningOn(id) {
    return FO.runs.filter((r) => r.state === "running" && r.runner === id).length;
  }

  function sidebar(active) {
    const counts = {
      home: attention().length,
      runs: FO.runs.filter((r) => (r.state === "running" || r.state === "queued") && inWs(r)).length,
    };
    const nav = pages
      .map((p) => {
        const current = p.id === active || (active === "run" && p.id === "runs");
        const n = counts[p.id];
        const count = n ? `<span class="nav-count"${p.id === "home" ? " data-attention" : ""}>${n}</span>` : "";
        return `<a class="nav-link" href="${p.href}"${current ? ' aria-current="page"' : ""}>${p.icon}<span>${p.label}</span>${count}</a>`;
      })
      .join("");
    const runnerRows = FO.runners
      .map(
        (r) => `<a class="sidebar-runner" href="runners.html?sel=${r.id}">
          <span class="dot" data-tone="${r.online ? "online" : "offline"}"></span>
          <span>${r.id}</span>
          <span class="num">${r.online ? `${runningOn(r.id)}/${r.capacity}` : "Offline"}</span>
        </a>`
      )
      .join("");
    const items = [...FO.workspaces.map((w) => [w.id, w.name]), ["all", "전체"]]
      .map(
        ([id, name]) =>
          `<button class="ws-item${id === "all" ? " ws-all" : ""}" type="button" role="menuitemradio" aria-checked="${id === ws}" data-ws="${id}">${esc(name)}${icon.check}</button>`
      )
      .join("");
    return `
      <a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true">F</span>factory-orchestrator</a>
      <div class="ws">
        <button class="ws-trigger" type="button" aria-haspopup="menu" aria-expanded="false" id="ws-trigger">
          <span class="ws-name">${esc(wsName(ws))}</span>${icon.chevron}
        </button>
        <div class="ws-menu" role="menu" aria-label="Workspace" id="ws-menu" hidden>${items}</div>
      </div>
      <nav class="nav" aria-label="화면">${nav}</nav>
      <div class="sidebar-section-label">Runners</div>
      <div class="sidebar-runners">${runnerRows}</div>
`;
  }

  function mount(active, render) {
    const side = document.createElement("aside");
    side.className = "sidebar";
    const app = document.getElementById("app");
    app.prepend(side);
    const paint = () => {
      side.innerHTML = sidebar(active);
    };
    paint();

    const setMenu = (open) => {
      document.getElementById("ws-trigger").setAttribute("aria-expanded", String(open));
      const menu = document.getElementById("ws-menu");
      menu.hidden = !open;
      if (open) menu.querySelector('[aria-checked="true"]').focus();
    };

    side.addEventListener("click", (e) => {
      if (e.target.closest("#ws-trigger")) {
        setMenu(document.getElementById("ws-menu").hidden);
        return;
      }
      const item = e.target.closest("[data-ws]");
      if (item) {
        ws = item.dataset.ws;
        try {
          localStorage.setItem(WS_KEY, ws);
        } catch (err) {
          /* 저장하지 못해도 이 화면에서는 바뀐다 */
        }
        const url = new URL(location.href);
        url.searchParams.delete("ws");
        url.searchParams.delete("sel");
        try {
          history.replaceState(null, "", url);
        } catch (err) {
          /* file:// */
        }
        paint();
        render();
        document.getElementById("ws-trigger").focus();
      }
    });
    side.addEventListener("keydown", (e) => {
      const menu = document.getElementById("ws-menu");
      if (menu.hidden) return;
      const list = [...menu.querySelectorAll(".ws-item")];
      const i = list.indexOf(document.activeElement);
      if (e.key === "Escape") {
        setMenu(false);
        document.getElementById("ws-trigger").focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length].focus();
      }
    });
    document.addEventListener("click", (e) => {
      const menu = document.getElementById("ws-menu");
      if (menu && !menu.hidden && !e.target.closest(".ws")) setMenu(false);
    });
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-toast]");
      if (b) toast(b.dataset.toast);
    });
    render();
  }

  /* "전체"에서 Workspace 범위 화면을 열었을 때 */
  function allNotice(title) {
    return `<div class="split-list" style="grid-column: 1 / -1">
      <div class="page-head"><div><h1 class="page-title">${title}</h1>
      <p class="page-sub">전체에서는 모든 Workspace의 손댈 일만 모아 봐요. ${josa(title, "은/는")} Workspace를 골라야 보여요.</p></div></div>
      <div class="actions">${FO.workspaces.map((w) => `<button class="btn" type="button" data-pick-ws="${w.id}">${esc(w.name)} 보기</button>`).join("")}
      <a class="btn btn-ghost" href="index.html">손댈 일 보기</a></div>
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick-ws]");
    if (b) document.querySelector(`.ws-item[data-ws="${b.dataset.pickWs}"]`).click();
  });

  let toastTimer;
  function toast(message) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML = `${icon.check.replace("<svg", '<svg width="14" height="14"')}<span>${esc(message)}</span>`;
    el.setAttribute("data-show", "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.removeAttribute("data-show"), 2600);
  }

  Object.assign(FO, {
    icon, esc, minutes, josa, tone, label, stateText, shortWhy, longWhy, failLabel, resultLabel, ciLabel, prLabel,
    attention, latestByTicket, runRow, runCols, thead, runPanel, events, bindSplit, mount, allNotice, toast, runningOn,
    inWs, ticketInWs, wsName,
  });
  /* Object.assign은 getter 값을 한 번만 복사하므로 ws는 따로 정의한다 */
  Object.defineProperty(FO, "ws", { get: () => ws });
})();
