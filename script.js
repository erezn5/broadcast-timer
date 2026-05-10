function pad(num) {
  return String(num).padStart(2, "0");
}

function formatTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const clockBridge = window.clockBridge || null;
const NTP_SYNC_INTERVAL_MS = 60_000;
const NTP_CUSTOM_OPTION_VALUE = "__custom__";

let systemClockOffsetMs = 0;
let ntpServerAddress = "";
let ntpOffsetMs = null;
let ntpSyncIntervalId = null;
let ntpSyncInFlight = false;
let ntpStatusElement = null;
let systemClockControlRefs = null;
let clockSettingsToggleButton = null;
let clockSettingsPanelElement = null;
let clockSettingsAutoCloseTimerId = null;
let setClockSettingsPanelOpen = null;
let timerDisplayFitRafId = null;
let timerDisplayMeasurer = null;
let timerDisplayResizeObserver = null;

function isNtpConfigured() {
  return ntpServerAddress.length > 0;
}

function scheduleClockSettingsAutoClose(delayMs = 1400) {
  if (typeof setClockSettingsPanelOpen !== "function") {
    return;
  }

  if (clockSettingsAutoCloseTimerId !== null) {
    clearTimeout(clockSettingsAutoCloseTimerId);
  }

  clockSettingsAutoCloseTimerId = setTimeout(() => {
    setClockSettingsPanelOpen(false);
    clockSettingsAutoCloseTimerId = null;
  }, delayMs);
}

function syncClockSettingsIndicator() {
  if (!clockSettingsToggleButton) {
    return;
  }

  const active = isNtpConfigured();
  clockSettingsToggleButton.classList.toggle("ntp-active", active);
  clockSettingsToggleButton.setAttribute(
    "aria-label",
    active ? "הגדרות סנכרון שעון (NTP פעיל)" : "הגדרות סנכרון שעון"
  );
}

function triggerButtonClickFeedback(button) {
  if (!button) {
    return;
  }

  button.classList.remove("is-clicked");
  void button.offsetWidth;
  button.classList.add("is-clicked");

  window.setTimeout(() => {
    button.classList.remove("is-clicked");
  }, 140);
}

function normalizeNtpServer(value) {
  return String(value || "").trim();
}

function ensureTimerDisplayMeasurer() {
  if (timerDisplayMeasurer) {
    return timerDisplayMeasurer;
  }

  const measurer = document.createElement("span");
  measurer.style.position = "fixed";
  measurer.style.left = "-99999px";
  measurer.style.top = "0";
  measurer.style.visibility = "hidden";
  measurer.style.pointerEvents = "none";
  measurer.style.whiteSpace = "nowrap";
  document.body.appendChild(measurer);
  timerDisplayMeasurer = measurer;
  return measurer;
}

function fitTimerDisplayToSlot(displayElement) {
  if (!displayElement || !displayElement.isConnected) {
    return;
  }

  const bounds = displayElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  const measurer = ensureTimerDisplayMeasurer();
  const displayStyle = window.getComputedStyle(displayElement);
  measurer.style.fontFamily = displayStyle.fontFamily;
  measurer.style.fontWeight = displayStyle.fontWeight;
  measurer.style.fontStyle = displayStyle.fontStyle;
  measurer.style.letterSpacing = "-0.015em";
  measurer.style.lineHeight = "0.94";
  measurer.style.fontVariantNumeric = displayStyle.fontVariantNumeric;
  measurer.style.fontFeatureSettings = displayStyle.fontFeatureSettings;
  measurer.textContent = "88:88:88";

  const targetWidth = bounds.width * 0.985;
  const targetHeight = bounds.height * 0.93;
  const probeFontSize = 200;
  measurer.style.fontSize = `${probeFontSize}px`;
  const probeBounds = measurer.getBoundingClientRect();

  if (probeBounds.width <= 0 || probeBounds.height <= 0) {
    return;
  }

  const widthRatio = probeBounds.width / probeFontSize;
  const heightRatio = probeBounds.height / probeFontSize;
  const fitByWidth = targetWidth / widthRatio;
  const fitByHeight = targetHeight / heightRatio;
  const fitSize = Math.floor(Math.min(fitByWidth, fitByHeight));
  const safeMin = bounds.width > 350 ? 80 : 32;
  const safeMax = Math.floor(bounds.height * 1.05);
  const clamped = Math.max(safeMin, Math.min(fitSize, safeMax));

  displayElement.style.fontSize = `${clamped}px`;
}

function fitAllTimerDisplaysToSlots() {
  const displays = document.querySelectorAll(".timer-display");
  displays.forEach((displayElement) => {
    fitTimerDisplayToSlot(displayElement);
  });
}

function scheduleTimerDisplayFit() {
  if (timerDisplayFitRafId !== null) {
    window.cancelAnimationFrame(timerDisplayFitRafId);
  }

  timerDisplayFitRafId = window.requestAnimationFrame(() => {
    timerDisplayFitRafId = null;
    fitAllTimerDisplaysToSlots();
  });
}

function getEffectiveClockDate() {
  const offsetMs = ntpOffsetMs !== null ? ntpOffsetMs : systemClockOffsetMs;
  return new Date(Date.now() + offsetMs);
}

function setNtpStatus(message, tone = "info") {
  if (!ntpStatusElement) {
    return;
  }

  ntpStatusElement.textContent = message;
  ntpStatusElement.classList.remove("is-ok", "is-error");

  if (tone === "ok") {
    ntpStatusElement.classList.add("is-ok");
  } else if (tone === "error") {
    ntpStatusElement.classList.add("is-error");
  }
}

function updateManualClockControlsState() {
  if (!systemClockControlRefs) {
    return;
  }

  const disableManualControls = isNtpConfigured();

  systemClockControlRefs.fields.forEach((field) => {
    field.disabled = disableManualControls;
  });

  systemClockControlRefs.setButton.disabled = disableManualControls;

  if (disableManualControls) {
    updateSystemClockInputs();
  }
}

function stopNtpSyncLoop() {
  if (ntpSyncIntervalId !== null) {
    clearInterval(ntpSyncIntervalId);
    ntpSyncIntervalId = null;
  }
  ntpSyncInFlight = false;
  ntpOffsetMs = null;
}

async function syncNtpOnce(triggeredManually = false) {
  if (!isNtpConfigured()) {
    return;
  }

  if (!clockBridge || typeof clockBridge.queryNtpTime !== "function") {
    ntpOffsetMs = null;
    setNtpStatus("NTP לא זמין בבילד הזה. שימוש בשעון מחשב/ידני.", "error");
    return;
  }

  if (ntpSyncInFlight) {
    return;
  }

  ntpSyncInFlight = true;
  const requestedServer = ntpServerAddress;

  if (triggeredManually) {
    setNtpStatus(`מסנכרן מול ${requestedServer}...`);
  }

  try {
    const result = await clockBridge.queryNtpTime(requestedServer);

    if (requestedServer !== ntpServerAddress || !isNtpConfigured()) {
      return;
    }

    const nextOffsetMs = Number.isFinite(result && result.offsetMs)
      ? result.offsetMs
      : null;

    ntpOffsetMs = nextOffsetMs;

    if (nextOffsetMs === null) {
      throw new Error("Invalid NTP response.");
    }

    updateSystemClock();
    updateSystemClockInputs();

    const hostLabel = result && result.host ? result.host : requestedServer;
    const roundTripSuffix = Number.isFinite(result && result.roundTripMs)
      ? ` | RTT ${Math.round(result.roundTripMs)}ms`
      : "";

    setNtpStatus(`NTP פעיל: ${hostLabel}${roundTripSuffix}`, "ok");
    if (triggeredManually && isNtpConfigured() && clockSettingsPanelElement && !clockSettingsPanelElement.hidden) {
      scheduleClockSettingsAutoClose();
    }
  } catch (error) {
    if (requestedServer !== ntpServerAddress || !isNtpConfigured()) {
      return;
    }

    ntpOffsetMs = null;
    updateSystemClock();
    updateSystemClockInputs();

    const reason = error && error.message ? error.message : "NTP request failed";
    setNtpStatus(`NTP לא זמין כרגע (${reason}). שימוש בשעון מחשב/ידני.`, "error");
  } finally {
    ntpSyncInFlight = false;
  }
}

function startNtpSyncLoop() {
  if (!isNtpConfigured()) {
    stopNtpSyncLoop();
    return;
  }

  if (ntpSyncIntervalId !== null) {
    clearInterval(ntpSyncIntervalId);
  }

  ntpOffsetMs = null;
  void syncNtpOnce(false);

  ntpSyncIntervalId = setInterval(() => {
    void syncNtpOnce(false);
  }, NTP_SYNC_INTERVAL_MS);
}

async function setupClockSettings() {
  const toggleButton = document.getElementById("clockSettingsToggleBtn");
  const panel = document.getElementById("clockSettingsPanel");
  const closeButton = document.getElementById("clockSettingsCloseBtn");
  const ntpSelect = document.getElementById("ntpServerSelect");
  const ntpCustomInput = document.getElementById("ntpServerCustomInput");
  const saveButton = document.getElementById("ntpServerSaveBtn");
  const syncNowButton = document.getElementById("ntpSyncNowBtn");
  ntpStatusElement = document.getElementById("ntpStatus");

  if (
    !toggleButton ||
    !panel ||
    !closeButton ||
    !ntpSelect ||
    !ntpCustomInput ||
    !saveButton ||
    !syncNowButton ||
    !ntpStatusElement
  ) {
    return;
  }

  clockSettingsToggleButton = toggleButton;
  clockSettingsPanelElement = panel;

  const hasOptionValue = (value) => {
    const normalized = normalizeNtpServer(value);
    return Array.from(ntpSelect.options).some((option) => option.value === normalized);
  };

  const setCustomInputVisibility = (showCustomInput) => {
    ntpCustomInput.hidden = !showCustomInput;
    if (!showCustomInput) {
      ntpCustomInput.value = "";
    }
  };

  const readServerFromControls = () => {
    const selectedValue = normalizeNtpServer(ntpSelect.value);
    if (selectedValue === NTP_CUSTOM_OPTION_VALUE) {
      return normalizeNtpServer(ntpCustomInput.value);
    }
    return selectedValue;
  };

  const applyServerToControls = (serverValue) => {
    const normalized = normalizeNtpServer(serverValue);

    if (!normalized || hasOptionValue(normalized)) {
      ntpSelect.value = normalized;
      setCustomInputVisibility(false);
      return;
    }

    ntpSelect.value = NTP_CUSTOM_OPTION_VALUE;
    ntpCustomInput.value = normalized;
    setCustomInputVisibility(true);
  };

  setClockSettingsPanelOpen = (isOpen) => {
    if (clockSettingsAutoCloseTimerId !== null) {
      clearTimeout(clockSettingsAutoCloseTimerId);
      clockSettingsAutoCloseTimerId = null;
    }

    panel.hidden = !isOpen;
    toggleButton.setAttribute("aria-expanded", isOpen ? "true" : "false");

    if (isOpen) {
      if (ntpSelect.value === NTP_CUSTOM_OPTION_VALUE) {
        ntpCustomInput.focus();
        ntpCustomInput.select();
      } else {
        ntpSelect.focus();
      }
    }
  };

  toggleButton.addEventListener("click", () => {
    const isOpen = toggleButton.getAttribute("aria-expanded") === "true";
    const willOpen = !isOpen;
    setClockSettingsPanelOpen(willOpen);

    if (willOpen && isNtpConfigured()) {
      setNtpStatus(`מסנכרן מול ${ntpServerAddress}...`);
      void syncNtpOnce(true);
    }
  });

  closeButton.addEventListener("click", () => {
    setClockSettingsPanelOpen(false);
  });

  panel.addEventListener("click", (event) => {
    if (event.target === panel) {
      setClockSettingsPanelOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setClockSettingsPanelOpen(false);
    }
  });

  ntpSelect.addEventListener("change", () => {
    const isCustomSelection = ntpSelect.value === NTP_CUSTOM_OPTION_VALUE;
    setCustomInputVisibility(isCustomSelection);
    if (isCustomSelection) {
      ntpCustomInput.focus();
      ntpCustomInput.select();
    }
  });

  ntpSelect.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });

  ntpCustomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveButton.click();
    }
  });

  saveButton.addEventListener("click", async () => {
    triggerButtonClickFeedback(saveButton);
    const nextServer = readServerFromControls();

    if (ntpSelect.value === NTP_CUSTOM_OPTION_VALUE && !nextServer) {
      setNtpStatus("Enter a custom NTP host or choose a server from the list.", "error");
      ntpCustomInput.focus();
      return;
    }

    try {
      const savedSettings = clockBridge && typeof clockBridge.saveClockSettings === "function"
        ? await clockBridge.saveClockSettings({ ntpServer: nextServer })
        : { ntpServer: nextServer };

      ntpServerAddress = normalizeNtpServer(savedSettings && savedSettings.ntpServer);
      syncClockSettingsIndicator();
      applyServerToControls(ntpServerAddress);
      updateManualClockControlsState();

      if (isNtpConfigured()) {
        setNtpStatus(`שרת NTP נשמר (${ntpServerAddress}).`);
        startNtpSyncLoop();
        void syncNtpOnce(true);
      } else {
        stopNtpSyncLoop();
        setNtpStatus("לא הוגדר שרת NTP. השעון מסונכרן לשעון המחשב.");
        updateSystemClock();
        updateSystemClockInputs();
        setClockSettingsPanelOpen(false);
      }
    } catch (error) {
      const reason = error && error.message ? error.message : "Save failed";
      setNtpStatus(`שמירת שרת NTP נכשלה (${reason}).`, "error");
    }
  });

  syncNowButton.addEventListener("click", () => {
    triggerButtonClickFeedback(syncNowButton);
    if (!isNtpConfigured()) {
      setNtpStatus("Select an NTP server and save first.", "error");
      return;
    }
    void syncNtpOnce(true);
  });

  let initialSettings = { ntpServer: "" };

  if (clockBridge && typeof clockBridge.loadClockSettings === "function") {
    try {
      initialSettings = await clockBridge.loadClockSettings();
    } catch (error) {
      const reason = error && error.message ? error.message : "Load failed";
      setNtpStatus(`טעינת הגדרות NTP נכשלה (${reason}).`, "error");
    }
  } else {
    setNtpStatus("NTP לא זמין. שימוש בשעון מחשב/ידני.", "error");
  }

  ntpServerAddress = normalizeNtpServer(initialSettings && initialSettings.ntpServer);
  syncClockSettingsIndicator();
  applyServerToControls(ntpServerAddress);
  updateManualClockControlsState();

  if (isNtpConfigured()) {
    setNtpStatus(`שרת פעיל: ${ntpServerAddress}.`);
    startNtpSyncLoop();
  } else {
    setNtpStatus("לא הוגדר שרת NTP. השעון מסונכרן לשעון המחשב.");
    stopNtpSyncLoop();
    updateSystemClock();
  }

  setClockSettingsPanelOpen(false);
}

function setupTimerDisplayResizeObserver() {
  if (typeof window.ResizeObserver !== "function") {
    return;
  }

  if (timerDisplayResizeObserver) {
    timerDisplayResizeObserver.disconnect();
  }

  timerDisplayResizeObserver = new window.ResizeObserver(() => {
    scheduleTimerDisplayFit();
  });

  const displays = document.querySelectorAll(".timer-display");
  displays.forEach((displayElement) => {
    timerDisplayResizeObserver.observe(displayElement);
  });
}

function setupTimeFieldBehavior() {
  const groups = document.querySelectorAll(".time-inputs");
  const allowedKeys = new Set([
    "Backspace",
    "Delete",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ]);

  groups.forEach((group) => {
    const fields = Array.from(group.querySelectorAll("input"));
    const firstField = fields[0] || null;
    const timerSuffixMatch = firstField ? firstField.id.match(/\d+$/) : null;
    const timerSuffix = timerSuffixMatch ? timerSuffixMatch[0] : "";
    const setButton = timerSuffix ? document.getElementById(`set${timerSuffix}`) : null;

    fields.forEach((input, index) => {
      const nextInput = fields[index + 1] || null;
      const isHours = input.id.startsWith("hours");
      const maxValue = isHours ? 99 : 59;

      input.setAttribute("inputmode", "numeric");

      input.addEventListener("focus", () => {
        input.select();
      });

      input.addEventListener("keydown", (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          if (setButton) {
            setButton.click();
          }
          return;
        }

        if (allowedKeys.has(event.key)) {
          return;
        }

        if (!/^\d$/.test(event.key)) {
          event.preventDefault();
          return;
        }

        const hasSelection = input.selectionStart !== input.selectionEnd;
        if (input.value.length >= 2 && !hasSelection) {
          event.preventDefault();
          if (nextInput) {
            nextInput.focus();
            nextInput.select();
          }
        }
      });

      input.addEventListener("input", () => {
        let value = input.value.replace(/\D/g, "").slice(0, 2);

        if (value.length === 2) {
          value = String(Math.min(Number.parseInt(value, 10), maxValue)).padStart(2, "0");
        }

        input.value = value;

        if (value.length === 2 && nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      });

      input.addEventListener("blur", () => {
        const value = input.value.replace(/\D/g, "").slice(0, 2);
        const parsed = value === "" ? 0 : Number.parseInt(value, 10);
        input.value = pad(Math.min(parsed, maxValue));
      });
    });
  });
}

function setupSystemClockControls() {
  const hoursInput = document.getElementById("sysHours");
  const minutesInput = document.getElementById("sysMinutes");
  const secondsInput = document.getElementById("sysSeconds");
  const setButton = document.getElementById("systemClockSetBtn");

  if (!hoursInput || !minutesInput || !secondsInput || !setButton) {
    return;
  }

  const fields = [hoursInput, minutesInput, secondsInput];
  systemClockControlRefs = {
    fields,
    setButton
  };
  const maxValues = [23, 59, 59];
  const allowedKeys = new Set([
    "Backspace",
    "Delete",
    "Tab",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
  ]);

  const normalizeField = (input, maxValue) => {
    const value = input.value.replace(/\D/g, "").slice(0, 2);
    const parsed = value === "" ? 0 : Number.parseInt(value, 10);
    input.value = pad(Math.min(parsed, maxValue));
  };

  const applyManualClockFromInputs = () => {
    if (isNtpConfigured()) {
      setNtpStatus("NTP פעיל. כדי לעבור להזנה ידנית, נקה את כתובת השרת ולחץ שמור.", "error");
      return;
    }

    fields.forEach((input, index) => {
      normalizeField(input, maxValues[index]);
    });

    const hours = Number.parseInt(hoursInput.value, 10);
    const minutes = Number.parseInt(minutesInput.value, 10);
    const seconds = Number.parseInt(secondsInput.value, 10);

    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, seconds, 0);
    systemClockOffsetMs = target.getTime() - now.getTime();
    updateSystemClock();
  };

  fields.forEach((input, index) => {
    const nextInput = fields[index + 1] || null;
    const maxValue = maxValues[index];

    input.setAttribute("inputmode", "numeric");

    input.addEventListener("focus", () => {
      input.select();
    });

    input.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        applyManualClockFromInputs();
        return;
      }

      if (allowedKeys.has(event.key)) {
        return;
      }

      if (!/^\d$/.test(event.key)) {
        event.preventDefault();
        return;
      }

      const hasSelection = input.selectionStart !== input.selectionEnd;
      if (input.value.length >= 2 && !hasSelection) {
        event.preventDefault();
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }
    });

    input.addEventListener("input", () => {
      let value = input.value.replace(/\D/g, "").slice(0, 2);

      if (value.length === 2) {
        value = String(Math.min(Number.parseInt(value, 10), maxValue)).padStart(2, "0");
      }

      input.value = value;

      if (value.length === 2 && nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    });

    input.addEventListener("blur", () => {
      normalizeField(input, maxValue);
    });
  });

  setButton.addEventListener("click", applyManualClockFromInputs);

  updateManualClockControlsState();
  updateSystemClockInputs();
}

class Timer {
  constructor(index) {
    this.display = document.getElementById(`display${index}`);
    this.progressFill = document.getElementById(`progressFill${index}`);
    this.hoursInput = document.getElementById(`hours${index}`);
    this.minutesInput = document.getElementById(`minutes${index}`);
    this.secondsInput = document.getElementById(`seconds${index}`);
    this.modeButton = document.getElementById(`mode${index}`);
    this.upButton = document.getElementById(`up${index}`);
    this.downButton = document.getElementById(`down${index}`);
    this.setButton = document.getElementById(`set${index}`);
    this.startButton = document.getElementById(`start${index}`);
    this.resetButton = document.getElementById(`reset${index}`);
    this.card = this.display ? this.display.closest(".timer-card") : null;

    this.configuredSeconds = 0;
    this.remainingSeconds = 0;
    this.animationFrameId = null;
    this.isRunning = false;
    this.mode = "down";
    this.runBaseSeconds = 0;
    this.runStartedAtMs = 0;
    this.hasSetValue = false;

    if (!this.hasAllElements()) {
      return;
    }

    this.bindEvents();
    this.updateDisplay();
    this.updateStartButton();
    this.updateModeButtons();
    this.updateProgress();
    this.updateCardState();
  }

  hasAllElements() {
    return Boolean(
      this.display &&
      this.progressFill &&
      this.hoursInput &&
      this.minutesInput &&
      this.secondsInput &&
      (this.modeButton || (this.upButton && this.downButton)) &&
      this.setButton &&
      this.startButton &&
      this.resetButton &&
      this.card
    );
  }

  bindEvents() {
    if (this.modeButton) {
      this.modeButton.addEventListener("click", () => {
        const nextMode = this.mode === "down" ? "up" : "down";
        this.applyMode(nextMode);
      });
    }

    if (this.upButton && this.downButton) {
      this.upButton.addEventListener("click", () => {
        this.applyMode("up");
      });

      this.downButton.addEventListener("click", () => {
        this.applyMode("down");
      });
    }

    this.setButton.addEventListener("click", () => {
      const wasRunning = this.isRunning;
      const totalSeconds = this.readAndNormalizeInputs();
      this.configuredSeconds = totalSeconds;
      this.remainingSeconds = totalSeconds;
      this.hasSetValue = true;
      this.stopTimer(false);
      this.updateDisplay();
      this.updateProgress();

      if (wasRunning && (this.mode === "up" || totalSeconds > 0)) {
        this.startButton.click();
      }
    });

    this.startButton.addEventListener("click", () => {
      if (this.isRunning) {
        this.stopTimer();
        return;
      }

      if (this.mode === "down" && this.remainingSeconds <= 0) {
        return;
      }

      this.isRunning = true;
      this.runBaseSeconds = this.remainingSeconds;
      this.runStartedAtMs = Date.now();
      this.updateStartButton();
      this.updateCardState();
      this.startRunLoop();
    });

    this.resetButton.addEventListener("click", () => {
      this.stopTimer();
      const totalSeconds = this.readAndNormalizeInputs();
      this.configuredSeconds = totalSeconds;
      this.remainingSeconds = totalSeconds;
      this.hasSetValue = true;
      this.updateDisplay();
      this.updateProgress();
      this.updateCardState();
    });
  }

  applyMode(nextMode) {
    if (this.isRunning) {
      this.remainingSeconds = this.getRunningSeconds(Date.now());
      this.runBaseSeconds = this.remainingSeconds;
      this.runStartedAtMs = Date.now();
    }

    this.mode = nextMode;
    this.updateModeButtons();

    if (!this.isRunning) {
      this.remainingSeconds = this.configuredSeconds;
    }

    this.updateDisplay();
    this.updateProgress();
  }

  readInputValue(input, max) {
    const value = Number.parseInt(input.value, 10);
    if (Number.isNaN(value)) {
      return 0;
    }
    return Math.min(Math.max(value, 0), max);
  }

  readAndNormalizeInputs() {
    const hours = this.readInputValue(this.hoursInput, 99);
    const minutes = this.readInputValue(this.minutesInput, 59);
    const seconds = this.readInputValue(this.secondsInput, 59);

    this.hoursInput.value = pad(hours);
    this.minutesInput.value = pad(minutes);
    this.secondsInput.value = pad(seconds);

    return hours * 3600 + minutes * 60 + seconds;
  }

  startRunLoop() {
    const step = () => {
      if (!this.isRunning) {
        this.animationFrameId = null;
        return;
      }

      const nowMs = Date.now();
      this.remainingSeconds = this.getRunningSeconds(nowMs);
      this.updateDisplay();
      this.updateProgress(nowMs);

      if (this.mode === "down" && this.getRunningSecondsExact(nowMs) <= 0) {
        this.remainingSeconds = 0;
        this.updateDisplay();
        this.updateProgress(nowMs);
        this.stopTimer(false);
        return;
      }

      this.animationFrameId = window.requestAnimationFrame(step);
    };

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = window.requestAnimationFrame(step);
  }

  getRunningSecondsExact(nowMs) {
    if (!this.isRunning) {
      return this.remainingSeconds;
    }

    const elapsedSeconds = Math.max(0, (nowMs - this.runStartedAtMs) / 1000);

    if (this.mode === "up") {
      return this.runBaseSeconds + elapsedSeconds;
    }

    return Math.max(0, this.runBaseSeconds - elapsedSeconds);
  }

  getRunningSeconds(nowMs) {
    const exactSeconds = this.getRunningSecondsExact(nowMs);
    return this.mode === "up" ? Math.floor(exactSeconds) : Math.ceil(exactSeconds);
  }

  updateDisplay() {
    this.display.textContent = formatTime(this.remainingSeconds);
  }

  updateStartButton() {
    this.startButton.textContent = this.isRunning ? "PAUSE" : "START";
  }

  updateModeButtons() {
    this.card.classList.toggle("mode-up", this.mode === "up");
    this.card.classList.toggle("mode-down", this.mode === "down");

    if (this.modeButton) {
      this.modeButton.textContent = this.mode === "up" ? "UP" : "DN";
      this.modeButton.classList.toggle("mode-up", this.mode === "up");
      this.modeButton.classList.toggle("mode-down", this.mode === "down");
    }

    if (this.upButton && this.downButton) {
      this.upButton.classList.toggle("mode-active", this.mode === "up");
      this.downButton.classList.toggle("mode-active", this.mode === "down");
    }
  }

  updateProgress(nowMs = Date.now()) {
    if (this.mode === "up") {
      this.progressFill.style.backgroundColor = "#00ff00";
      this.progressFill.style.width = "100%";
      return;
    }

    this.progressFill.style.backgroundColor = "#ff0000";

    if (this.configuredSeconds <= 0) {
      this.progressFill.style.width = "0%";
      return;
    }

    const remainingForProgress = this.isRunning
      ? this.getRunningSecondsExact(nowMs)
      : this.remainingSeconds;
    const percent = (remainingForProgress / this.configuredSeconds) * 100;
    const clampedPercent = Math.min(100, Math.max(0, percent));
    this.progressFill.style.width = `${clampedPercent}%`;
  }

  updateCardState() {
    const shouldBeActive = this.isRunning || this.hasSetValue;
    this.card.classList.toggle("inactive", !shouldBeActive);
  }

  stopTimer(syncWithClock = true) {
    if (syncWithClock && this.isRunning) {
      this.remainingSeconds = this.getRunningSeconds(Date.now());
      this.updateDisplay();
      this.updateProgress();
    }

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isRunning = false;
    this.updateStartButton();
    this.updateCardState();
  }
}

function updateSystemClock() {
  const now = getEffectiveClockDate();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById("systemClock").textContent = time;
}

function updateSystemClockInputs() {
  const now = getEffectiveClockDate();
  const hoursInput = document.getElementById("sysHours");
  const minutesInput = document.getElementById("sysMinutes");
  const secondsInput = document.getElementById("sysSeconds");

  if (!hoursInput || !minutesInput || !secondsInput) {
    return;
  }

  hoursInput.value = pad(now.getHours());
  minutesInput.value = pad(now.getMinutes());
  secondsInput.value = pad(now.getSeconds());
}

function setupLayoutToggle() {
  const app = document.querySelector(".app");
  const toggleContainer = document.getElementById("layoutToggle");

  if (!app || !toggleContainer) {
    return;
  }

  const singleButton = toggleContainer.querySelector('[data-layout="single"]');
  const doubleButton = toggleContainer.querySelector('[data-layout="double"]');

  if (!singleButton || !doubleButton) {
    return;
  }

  const applyLayout = (layout) => {
    const isSingleLayout = layout === "single";
    app.classList.toggle("single-layout", isSingleLayout);
    singleButton.classList.toggle("is-active", isSingleLayout);
    doubleButton.classList.toggle("is-active", !isSingleLayout);
    singleButton.setAttribute("aria-pressed", isSingleLayout ? "true" : "false");
    doubleButton.setAttribute("aria-pressed", isSingleLayout ? "false" : "true");
    scheduleTimerDisplayFit();
  };

  singleButton.addEventListener("click", () => {
    applyLayout("single");
  });

  doubleButton.addEventListener("click", () => {
    applyLayout("double");
  });

  applyLayout(app.classList.contains("single-layout") ? "single" : "double");
}

function initRenderer() {
  setupTimeFieldBehavior();
  setupSystemClockControls();
  setupLayoutToggle();
  void setupClockSettings();
  new Timer(1);
  new Timer(2);
  setupTimerDisplayResizeObserver();
  scheduleTimerDisplayFit();
  window.setTimeout(scheduleTimerDisplayFit, 120);
  window.setTimeout(scheduleTimerDisplayFit, 500);
  window.addEventListener("resize", scheduleTimerDisplayFit);
  if (document.fonts && typeof document.fonts.ready?.then === "function") {
    document.fonts.ready.then(() => {
      scheduleTimerDisplayFit();
    });
  }
  setInterval(() => {
    updateSystemClock();
    if (isNtpConfigured()) {
      updateSystemClockInputs();
    }
  }, 1000);
  updateSystemClock();
}

window.addEventListener("DOMContentLoaded", initRenderer);
