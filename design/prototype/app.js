/*
 * 공용 셸: 사이드바 내비게이션, 테마 토글, 배지 헬퍼, 방향 안 picker.
 * 각 화면은 <body data-page="..."> 와 #page 를 두고 FO.mountShell() 뒤에 자기 내용을 그린다.
 */
(function () {
  const FO = window.FO;

  const icon = {
    tickets: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5.5 4h7M5.5 8h7M5.5 12h7"/><circle cx="2.75" cy="4" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="8" r=".75" fill="currentColor" stroke="none"/><circle cx="2.75" cy="12" r=".75" fill="currentColor" stroke="none"/></svg>',
    runs: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8h3l1.75-4.5 3.5 9L11.5 8h3"/></svg>',
    runners: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="4.5" rx="1.25"/><rect x="2" y="9" width="12" height="4.5" rx="1.25"/><path d="M4.5 4.75h.01M4.5 11.25h.01" stroke-width="2" stroke-linecap="round"/></svg>',
    stats: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5"/></svg>',
    settings: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/></svg>',
    sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.75"/><path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M13.25 9.6A5.5 5.5 0 1 1 6.4 2.75a4.5 4.5 0 0 0 6.85 6.85Z"/></svg>',
    external: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>',
    pr: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6"/></svg>',
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  };

  const pages = [
    { id: "tickets", href: "tickets.html", label: "Tickets", icon: icon.tickets },
    { id: "runs", href: "runs.html", label: "Runs", icon: icon.runs },
    { id: "runners", href: "runners.html", label: "Runners", icon: icon.runners },
    { id: "stats", href: "stats.html", label: "Stats", icon: icon.stats },
    { id: "settings", href: "settings.html", label: "Settings", icon: icon.settings },
  ];

  const resultLabel = { merged: "Merged", check: "Human Check", failed: "Failed" };
  const failReasonLabel = { agent: "에이전트 오류", runner: "러너 연결 끊김" };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function runTone(run) {
    if (run.state === "queued") return "queued";
    if (run.state === "running") return "running";
    return run.result;
  }

  function runLabel(run) {
    if (run.state === "queued") return "Queued";
    if (run.state === "running") return "진행 중";
    return resultLabel[run.result];
  }

  function runBadge(run) {
    return `<span class="badge" data-tone="${runTone(run)}">${runLabel(run)}</span>`;
  }

  function minutes(m) {
    if (m < 60) return `${m}분`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}시간 ${r}분` : `${h}시간`;
  }

  function sidebar(active) {
    const running = FO.runs.filter((r) => r.state === "running").length;
    const queued = FO.runs.filter((r) => r.state === "queued").length;
    const openTickets = FO.tickets.filter((t) => t.trackerState !== "Done").length;
    const counts = { tickets: openTickets, runs: running + queued };
    const nav = pages
      .map((p) => {
        const current = p.id === active || (active === "run" && p.id === "runs");
        const count = counts[p.id] != null ? `<span class="nav-count">${counts[p.id]}</span>` : "";
        return `<a class="nav-link" href="${p.href}"${current ? ' aria-current="page"' : ""}>${p.icon}<span>${p.label}</span>${count}</a>`;
      })
      .join("");
    const runnerRows = FO.runners
      .map(
        (r) => `<a class="sidebar-runner" href="runners.html#${r.id}">
          <span class="dot" data-tone="${r.online ? "online" : "offline"}"></span>
          <span>${r.id}</span>
          <span class="num">${r.online ? `${r.running}/${r.capacity}` : "Offline"}</span>
        </a>`
      )
      .join("");
    return `
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark" aria-hidden="true">F</span>factory-orchestrator</div>
        <nav class="nav" aria-label="화면">${nav}</nav>
        <div class="sidebar-section-label">Runners</div>
        <div class="sidebar-runners">${runnerRows}</div>
        <div class="sidebar-footer">
          <a class="nav-link" href="onboarding.html"${active === "onboarding" ? ' aria-current="page"' : ""}>${icon.plus}<span>첫 실행 설정</span></a>
          <button class="btn btn-ghost" type="button" id="theme-toggle" style="justify-content:flex-start"></button>
        </div>
      </aside>`;
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function paintThemeButton() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const dark = currentTheme() === "dark";
    btn.innerHTML = dark ? `${icon.sun}<span>라이트 모드로 보기</span>` : `${icon.moon}<span>다크 모드로 보기</span>`;
  }

  function setTheme(theme) {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("fo-theme", theme);
    } catch (e) {
      /* 저장소를 쓸 수 없어도 화면은 바뀐다 */
    }
    paintThemeButton();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  }

  function mountShell(active) {
    const app = document.getElementById("app");
    const page = document.getElementById("page");
    app.insertAdjacentHTML("afterbegin", sidebar(active));
    page.setAttribute("tabindex", "-1");
    paintThemeButton();
    document.getElementById("theme-toggle").addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
  }

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

  /*
   * 방향 안 picker. 숫자 키 1–N, 좌우 화살표로 바꾼다. variants: [{ name, render(): html, after?(stage) }]
   */
  function picker(stage, variants) {
    const nav = document.createElement("nav");
    nav.className = "proto-picker";
    nav.setAttribute("aria-label", "방향 안");
    nav.innerHTML =
      '<span class="proto-picker-highlight" aria-hidden="true"></span>' +
      variants.map((v) => `<button class="proto-picker-item" type="button">${esc(v.name)}</button>`).join("");
    document.body.appendChild(nav);

    const highlight = nav.querySelector(".proto-picker-highlight");
    const items = [...nav.querySelectorAll(".proto-picker-item")];
    let current = 0;

    function moveHighlight() {
      const el = items[current];
      highlight.style.width = el.offsetWidth + "px";
      highlight.style.transform = `translateX(${el.offsetLeft}px)`;
    }

    function mount(i) {
      stage.innerHTML = "";
      requestAnimationFrame(() => {
        stage.innerHTML = variants[i].render();
        if (variants[i].after) variants[i].after(stage);
      });
    }

    function setActive(i) {
      if (i < 0 || i >= variants.length) return;
      current = i;
      items.forEach((el, j) => {
        el.toggleAttribute("data-active", j === i);
        if (j === i) el.setAttribute("aria-current", "true");
        else el.removeAttribute("aria-current");
      });
      moveHighlight();
      const url = new URL(location.href);
      url.searchParams.set("v", i + 1);
      try {
        history.replaceState(null, "", url);
      } catch (e) {
        /* file:// 에서 막혀도 전환은 된다 */
      }
      mount(i);
    }

    items.forEach((el, i) => el.addEventListener("click", () => setActive(i)));
    window.addEventListener("resize", moveHighlight);

    document.addEventListener("keydown", (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= variants.length) setActive(num - 1);
      else if (e.key === "ArrowRight") setActive((current + 1) % variants.length);
      else if (e.key === "ArrowLeft") setActive((current - 1 + variants.length) % variants.length);
      else if (e.key === "r" || e.key === "R") mount(current);
    });

    setActive((parseInt(new URLSearchParams(location.search).get("v"), 10) || 1) - 1);
    requestAnimationFrame(() => requestAnimationFrame(() => nav.setAttribute("data-ready", "")));
  }

  Object.assign(FO, { icon, esc, runTone, runLabel, runBadge, minutes, resultLabel, failReasonLabel, mountShell, toast, picker });
})();
