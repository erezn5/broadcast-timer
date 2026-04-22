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

let systemClockOffsetMs = 0;

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
  const now = new Date(Date.now() + systemClockOffsetMs);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById("systemClock").textContent = time;
}

function updateSystemClockInputs() {
  const now = new Date(Date.now() + systemClockOffsetMs);
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
  new Timer(1);
  new Timer(2);
  setInterval(updateSystemClock, 1000);
  updateSystemClock();
}

window.addEventListener("DOMContentLoaded", initRenderer);
