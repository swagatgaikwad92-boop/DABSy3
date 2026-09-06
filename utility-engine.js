/* ============================================================
   D.A.B.S.y — utility-engine.js
   Timer / Tasks / Reminders shown inside the Utility tab.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  const memory = window.DABSy.memory;
  const body = document.getElementById("utility-body");
  const utilButtons = document.querySelectorAll(".util-btn[data-util]");

  let timerInterval = null;
  let timerSeconds = 0;

  function renderTimer(){
    body.innerHTML = `
      <div id="timer-display">00:00</div>
      <div style="display:flex; gap:8px;">
        <button class="util-btn" id="t-5">5 min</button>
        <button class="util-btn" id="t-15">15 min</button>
        <button class="util-btn" id="t-25">25 min</button>
        <button class="util-btn" id="t-stop">Stop</button>
      </div>
    `;
    const display = document.getElementById("timer-display");
    function fmt(s){ const m=Math.floor(s/60), r=s%60; return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`; }
    function start(mins){
      clearInterval(timerInterval);
      timerSeconds = mins*60;
      display.textContent = fmt(timerSeconds);
      timerInterval = setInterval(()=>{
        timerSeconds--;
        display.textContent = fmt(Math.max(0,timerSeconds));
        if(timerSeconds <= 0){
          clearInterval(timerInterval);
          bus.emit("dabsy:say", { text: "Time's up." });
          bus.emit("face:recoil");
        }
      }, 1000);
    }
    document.getElementById("t-5").onclick = ()=>start(5);
    document.getElementById("t-15").onclick = ()=>start(15);
    document.getElementById("t-25").onclick = ()=>start(25);
    document.getElementById("t-stop").onclick = ()=>{ clearInterval(timerInterval); display.textContent="00:00"; };
  }

  function renderTasks(){
    const tasks = memory.getTasks();
    body.innerHTML = `
      <div style="display:flex; gap:8px;">
        <input id="new-task" placeholder="Add a task…" style="flex:1; background:var(--glass-strong); border:1px solid var(--glass-border); border-radius:12px; padding:10px; color:var(--ink); outline:none;" />
        <button class="util-btn" id="add-task">Add</button>
      </div>
      <div id="task-list"></div>
    `;
    const list = document.getElementById("task-list");
    tasks.forEach(t=>{
      const row = document.createElement("div");
      row.className = "task-row";
      row.innerHTML = `<span style="text-decoration:${t.done?'line-through':'none'}; opacity:${t.done?0.5:1}">${escapeHtml(t.text)}</span>`;
      const actions = document.createElement("div");
      const doneBtn = document.createElement("button"); doneBtn.textContent = t.done ? "Undo" : "Done";
      doneBtn.onclick = ()=>{ memory.toggleTask(t.id); renderTasks(); };
      const delBtn = document.createElement("button"); delBtn.textContent = "✕"; delBtn.style.marginLeft="8px";
      delBtn.onclick = ()=>{ memory.removeTask(t.id); renderTasks(); };
      actions.appendChild(doneBtn); actions.appendChild(delBtn);
      row.appendChild(actions);
      list.appendChild(row);
    });
    document.getElementById("add-task").onclick = ()=>{
      const input = document.getElementById("new-task");
      if(input.value.trim()){ memory.addTask(input.value.trim()); renderTasks(); }
    };
  }

  function renderReminders(){
    const reminders = memory.getReminders();
    body.innerHTML = `
      <p class="hint">This is a plain note list with no set time. For a reminder that fires at
      a specific time, use the Schedule tab, or just tell D.A.B.S.y out loud —
      "remind me to submit my assignment at 6pm."</p>
      <div style="display:flex; gap:8px;">
        <input id="new-reminder" placeholder="Remind me to…" style="flex:1; background:var(--glass-strong); border:1px solid var(--glass-border); border-radius:12px; padding:10px; color:var(--ink); outline:none;" />
        <button class="util-btn" id="add-reminder">Add</button>
      </div>
      <div id="reminder-list"></div>
    `;
    const list = document.getElementById("reminder-list");
    reminders.forEach(r=>{
      const row = document.createElement("div");
      row.className = "task-row";
      row.innerHTML = `<span>${escapeHtml(r.text)}</span>`;
      const delBtn = document.createElement("button"); delBtn.textContent = "✕";
      delBtn.onclick = ()=>{ memory.removeReminder(r.id); renderReminders(); };
      row.appendChild(delBtn);
      list.appendChild(row);
    });
    document.getElementById("add-reminder").onclick = ()=>{
      const input = document.getElementById("new-reminder");
      if(input.value.trim()){ memory.addReminder(input.value.trim(), null); renderReminders(); }
    };
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  utilButtons.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const which = btn.dataset.util;
      if(which === "timer") renderTimer();
      if(which === "tasks") renderTasks();
      if(which === "reminders") renderReminders();
    });
  });

  window.DABSy = window.DABSy || {};
  window.DABSy.utility = { renderTimer, renderTasks, renderReminders };
})();
