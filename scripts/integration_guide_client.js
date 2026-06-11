    (function () {
      var returnBtn = document.getElementById("return-to-top");
      if (returnBtn) {
        returnBtn.addEventListener("click", function () {
          window.scrollTo({ top: 0, behavior: "smooth" });
          history.replaceState(null, "", window.location.pathname + window.location.search);
        });
      }

      var nav = document.getElementById("contents");
      if (nav) {
        try {
          var stored = localStorage.getItem("cwIntegrationGuideNavOpen");
          if (stored === "0") nav.open = false;
          if (stored === "1") nav.open = true;
        } catch (e) {}
        nav.addEventListener("toggle", function () {
          try {
            localStorage.setItem("cwIntegrationGuideNavOpen", nav.open ? "1" : "0");
          } catch (e) {}
        });
        nav.querySelectorAll("a[href^='#']").forEach(function (link) {
          link.addEventListener("click", function (ev) {
            var id = link.getAttribute("href").slice(1);
            var target = document.getElementById(id);
            if (!target) return;
            ev.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            history.replaceState(null, "", "#" + id);
          });
        });
      }

      document.querySelectorAll(".term-info-btn").forEach(function (btn) {
        var dialogId = btn.getAttribute("data-term-dialog");
        var dialog = dialogId ? document.getElementById(dialogId) : null;
        if (!dialog) return;
        btn.addEventListener("click", function () { dialog.showModal(); });
        var close = dialog.querySelector(".term-info-close");
        if (close) close.addEventListener("click", function () { dialog.close(); });
        dialog.addEventListener("click", function (ev) {
          if (ev.target === dialog) dialog.close();
        });
      });

      function flashCopied(el, className) {
        if (!el) return;
        el.classList.add(className);
        window.setTimeout(function () { el.classList.remove(className); }, 1400);
      }

      function showCopiedToast(anchorEl) {
        if (!anchorEl || !anchorEl.getBoundingClientRect) return;
        var existing = document.querySelector(".term-copy-toast");
        if (existing) existing.remove();
        var toast = document.createElement("div");
        toast.className = "term-copy-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        toast.textContent = "Copied";
        document.body.appendChild(toast);
        var lineRect = anchorEl.getBoundingClientRect();
        var toastRect = toast.getBoundingClientRect();
        var top = lineRect.bottom + 4;
        var left = lineRect.left;
        if (left + toastRect.width > window.innerWidth - 8) {
          left = window.innerWidth - toastRect.width - 8;
        }
        if (left < 8) left = 8;
        if (top + toastRect.height > window.innerHeight - 8) {
          top = lineRect.top - toastRect.height - 4;
        }
        toast.style.top = top + "px";
        toast.style.left = left + "px";
        window.setTimeout(function () {
          toast.classList.add("term-copy-toast-hide");
          window.setTimeout(function () { toast.remove(); }, 450);
        }, 1400);
      }

      function copyGuideText(text, el, className, showToast) {
        if (!text) return;
        var done = function () {
          flashCopied(el, className || "copied");
          if (showToast) showCopiedToast(el);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text);
            done();
          });
          return;
        }
        fallbackCopy(text);
        done();
      }

      function fallbackCopy(text) {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(area);
      }

      document.querySelectorAll(".term-line[data-copy]").forEach(function (line) {
        line.addEventListener("click", function () {
          copyGuideText(line.getAttribute("data-copy"), line, "copied", true);
        });
        line.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            copyGuideText(line.getAttribute("data-copy"), line, "copied", true);
          }
        });
      });

      document.querySelectorAll(".term-copy-all-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var termId = btn.getAttribute("data-copy-target");
          var store = termId ? document.getElementById(termId + "-copy-all") : null;
          if (!store) return;
          copyGuideText(store.value, btn, "copied", false);
        });
      });
    })();