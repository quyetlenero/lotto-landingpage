/**
 * Embeddable AI chat widget. Usage:
 *   <script src="https://<backend-domain>/widget.js" data-widget-key="wk_xxx" defer></script>
 * Optional attributes: data-api-base (defaults to this script's own origin),
 * data-primary-color / data-accent-color (defaults match the current site's --red/--gold).
 * No dependencies, no build step — plain ES2017-ish JS so it runs unmodified in any modern browser.
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var widgetKey = scriptEl.getAttribute("data-widget-key");
  if (!widgetKey) {
    console.error("[chat-widget] missing data-widget-key attribute");
    return;
  }

  var apiBase = scriptEl.getAttribute("data-api-base") || new URL(scriptEl.src).origin;
  var primaryColor = scriptEl.getAttribute("data-primary-color") || "#D62828";
  var accentColor = scriptEl.getAttribute("data-accent-color") || "#F59E0B";

  var SESSION_STORAGE_KEY = "mab_chat_session_id";
  var TRANSCRIPT_STORAGE_KEY = "mab_chat_transcript";
  var OPEN_BODY_CLASS = "mab-chat-open";

  function getOrCreateSessionId() {
    var existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    var fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  }

  function loadTranscript() {
    try {
      var raw = sessionStorage.getItem(TRANSCRIPT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function saveTranscript(transcript) {
    try {
      sessionStorage.setItem(TRANSCRIPT_STORAGE_KEY, JSON.stringify(transcript));
    } catch (err) {
      // sessionStorage full/unavailable — transcript just won't survive a reload, not fatal.
    }
  }

  var sessionId = getOrCreateSessionId();
  var transcript = loadTranscript();

  injectStyles();
  var els = buildDom();
  transcript.forEach(function (entry) {
    appendBubble(entry.role, entry.text, false);
  });

  function injectStyles() {
    var style = document.createElement("style");
    style.textContent =
      ":root{--mab-primary:" + primaryColor + ";--mab-accent:" + accentColor + ";}" +
      ".mab-bubble{position:fixed;bottom:96px;right:20px;z-index:1000;width:56px;height:56px;" +
      "border-radius:50%;background:var(--mab-primary);color:#fff;border:none;cursor:pointer;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.3);font-size:26px;display:flex;align-items:center;" +
      "justify-content:center;font-family:'Be Vietnam Pro',sans-serif;}" +
      ".mab-bubble:hover{filter:brightness(1.08);}" +
      ".mab-panel{position:fixed;bottom:96px;right:20px;z-index:1000;width:340px;max-width:calc(100vw - 40px);" +
      "height:460px;max-height:70vh;background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.35);" +
      "display:none;flex-direction:column;overflow:hidden;font-family:'Be Vietnam Pro',sans-serif;}" +
      ".mab-panel.mab-open{display:flex;}" +
      ".mab-bubble.mab-hidden{display:none;}" +
      ".mab-header{background:var(--mab-primary);color:#fff;padding:14px 16px;display:flex;" +
      "align-items:center;justify-content:space-between;font-family:'Montserrat',sans-serif;font-weight:700;}" +
      ".mab-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1;}" +
      ".mab-messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;" +
      "background:#F7F3EC;}" +
      ".mab-msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;" +
      "white-space:pre-wrap;word-break:break-word;}" +
      ".mab-msg-user{align-self:flex-end;background:var(--mab-primary);color:#fff;" +
      "border-bottom-right-radius:4px;}" +
      ".mab-msg-bot{align-self:flex-start;background:#fff;color:#222;border:1px solid #E3DACD;" +
      "border-bottom-left-radius:4px;}" +
      ".mab-msg-error{align-self:flex-start;background:#fff3f3;color:#A61E1E;border:1px solid #f3caca;" +
      "font-size:13px;}" +
      ".mab-retry{margin-top:6px;background:var(--mab-primary);color:#fff;border:none;border-radius:8px;" +
      "padding:4px 10px;font-size:12px;cursor:pointer;}" +
      ".mab-typing{align-self:flex-start;display:flex;gap:4px;padding:10px 12px;}" +
      ".mab-typing span{width:6px;height:6px;border-radius:50%;background:#999;" +
      "animation:mab-bounce 1.2s infinite ease-in-out;}" +
      ".mab-typing span:nth-child(2){animation-delay:.15s;}" +
      ".mab-typing span:nth-child(3){animation-delay:.3s;}" +
      "@keyframes mab-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}" +
      ".mab-inputRow{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff;}" +
      ".mab-input{flex:1;border:1px solid #ddd;border-radius:10px;padding:8px 10px;font-size:14px;" +
      "font-family:'Be Vietnam Pro',sans-serif;resize:none;}" +
      ".mab-send{background:var(--mab-primary);color:#fff;border:none;border-radius:10px;" +
      "padding:0 14px;font-weight:700;cursor:pointer;}" +
      ".mab-send:disabled{opacity:.5;cursor:default;}" +
      "body." + OPEN_BODY_CLASS + " .phone-float,body." + OPEN_BODY_CLASS + " .back-top{display:none!important;}" +
      "@media(max-width:767px){.mab-bubble,.mab-panel{bottom:88px;right:16px;}}";
    document.head.appendChild(style);
  }

  function buildDom() {
    var bubble = document.createElement("button");
    bubble.className = "mab-bubble";
    bubble.setAttribute("aria-label", "Mở chat");
    bubble.textContent = "💬";

    var panel = document.createElement("div");
    panel.className = "mab-panel";

    var header = document.createElement("div");
    header.className = "mab-header";
    var title = document.createElement("span");
    title.textContent = "Chat với chúng tôi";
    var closeBtn = document.createElement("button");
    closeBtn.className = "mab-close";
    closeBtn.setAttribute("aria-label", "Đóng chat");
    closeBtn.textContent = "✕";
    header.appendChild(title);
    header.appendChild(closeBtn);

    var messages = document.createElement("div");
    messages.className = "mab-messages";

    var inputRow = document.createElement("div");
    inputRow.className = "mab-inputRow";
    var input = document.createElement("textarea");
    input.className = "mab-input";
    input.rows = 1;
    input.placeholder = "Nhập tin nhắn...";
    var sendBtn = document.createElement("button");
    sendBtn.className = "mab-send";
    sendBtn.textContent = "Gửi";
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(inputRow);

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    bubble.addEventListener("click", function () {
      panel.classList.add("mab-open");
      bubble.classList.add("mab-hidden");
      document.body.classList.add(OPEN_BODY_CLASS);
      input.focus();
    });
    closeBtn.addEventListener("click", function () {
      panel.classList.remove("mab-open");
      bubble.classList.remove("mab-hidden");
      document.body.classList.remove(OPEN_BODY_CLASS);
    });

    function trySend() {
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendMessage(text);
    }
    sendBtn.addEventListener("click", trySend);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        trySend();
      }
    });

    return { bubble: bubble, panel: panel, messages: messages, input: input, sendBtn: sendBtn };
  }

  function appendBubble(role, text, persist) {
    var div = document.createElement("div");
    div.className = role === "user" ? "mab-msg mab-msg-user" : "mab-msg mab-msg-bot";
    div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
    if (persist !== false) {
      transcript.push({ role: role, text: text });
      saveTranscript(transcript);
    }
    return div;
  }

  function showTyping() {
    var typing = document.createElement("div");
    typing.className = "mab-typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    els.messages.appendChild(typing);
    els.messages.scrollTop = els.messages.scrollHeight;
    return typing;
  }

  function setSending(isSending) {
    els.input.disabled = isSending;
    els.sendBtn.disabled = isSending;
  }

  function sendMessage(text) {
    appendBubble("user", text);
    setSending(true);
    var typing = showTyping();

    fetch(apiBase + "/chat/website", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetKey: widgetKey, sessionId: sessionId, message: text }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("request failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        typing.remove();
        appendBubble("bot", data.reply || "");
        setSending(false);
      })
      .catch(function () {
        typing.remove();
        var errorDiv = document.createElement("div");
        errorDiv.className = "mab-msg mab-msg-error";
        errorDiv.textContent = "Không gửi được tin nhắn. Vui lòng thử lại.";
        var retryBtn = document.createElement("button");
        retryBtn.className = "mab-retry";
        retryBtn.textContent = "Gửi lại";
        retryBtn.addEventListener("click", function () {
          errorDiv.remove();
          sendMessage(text);
        });
        errorDiv.appendChild(document.createElement("br"));
        errorDiv.appendChild(retryBtn);
        els.messages.appendChild(errorDiv);
        els.messages.scrollTop = els.messages.scrollHeight;
        setSending(false);
      });
  }
})();
