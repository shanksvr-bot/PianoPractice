const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");

const connectionStatus = document.getElementById("connectionStatus");
const message = document.getElementById("message");

const noteDisplay = document.getElementById("noteDisplay");
const frequencyDisplay = document.getElementById("frequencyDisplay");
const confidenceDisplay = document.getElementById("confidenceDisplay");
const noteIndicator = document.getElementById("noteIndicator");

let audioContext = null;
let analyser = null;
let microphone = null;
let microphoneStream = null;

let audioBuffer = null;
let running = false;
let animationFrame = null;
let lastAnalysis = 0;
let lastDetectedTime = 0;
let currentNote = null;

const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B"
];

function frequencyToNote(frequency) {

  const midi = Math.round(
    69 + 12 * Math.log2(frequency / 440)
  );

  const noteName = NOTE_NAMES[
    ((midi % 12) + 12) % 12
  ];

  const octave = Math.floor(midi / 12) - 1;

  const expectedFrequency =
    440 * Math.pow(2, (midi - 69) / 12);

  const cents = Math.round(
    1200 * Math.log2(frequency / expectedFrequency)
  );

  return {
    name: noteName + octave,
    midi: midi,
    cents: cents
  };
}


// YIN pitch detection algorithm

function detectPitch(buffer, sampleRate) {

  // Reduce sample count for faster processing.
  const size = Math.floor(buffer.length / 2);

  const samples = new Float32Array(size);

  let energy = 0;

  for (let i = 0; i < size; i++) {

    const value =
      (buffer[i * 2] + buffer[i * 2 + 1]) / 2;

    samples[i] = value;
    energy += value * value;
  }

  const rms = Math.sqrt(energy / size);

  if (rms < 0.008) {
    return null;
  }

  const effectiveRate = sampleRate / 2;

  const minFrequency = 27;
  const maxFrequency = 1400;

  const minTau = Math.floor(
    effectiveRate / maxFrequency
  );

  const maxTau = Math.min(
    Math.floor(effectiveRate / minFrequency),
    Math.floor(size / 2)
  );

  const difference = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau++) {

    let sum = 0;

    for (let i = 0; i < size - maxTau; i++) {

      const delta = samples[i] - samples[i + tau];

      sum += delta * delta;
    }

    difference[tau] = sum;
  }

  let runningSum = 0;

  const normalized = new Float32Array(maxTau + 1);

  normalized[0] = 1;

  for (let tau = 1; tau <= maxTau; tau++) {

    runningSum += difference[tau];

    normalized[tau] = runningSum === 0
      ? 1
      : difference[tau] * tau / runningSum;
  }

  let selectedTau = -1;

  for (let tau = minTau; tau <= maxTau; tau++) {

    if (normalized[tau] < 0.15) {

      while (
        tau + 1 <= maxTau &&
        normalized[tau + 1] < normalized[tau]
      ) {
        tau++;
      }

      selectedTau = tau;
      break;
    }
  }

  if (selectedTau === -1) {

    let bestValue = 0.30;

    for (let tau = minTau; tau <= maxTau; tau++) {

      if (normalized[tau] < bestValue) {
        bestValue = normalized[tau];
        selectedTau = tau;
      }
    }
  }

  if (selectedTau === -1) {
    return null;
  }

  // Refine frequency using interpolation.

  const left = normalized[selectedTau - 1];
  const center = normalized[selectedTau];
  const right = normalized[selectedTau + 1];

  const denominator = left - 2 * center + right;

  let adjustment = 0;

  if (denominator !== 0) {
    adjustment = 0.5 * (left - right) / denominator;
  }

  const refinedTau = selectedTau + adjustment;

  const frequency = effectiveRate / refinedTau;

  if (
    frequency < minFrequency ||
    frequency > maxFrequency
  ) {
    return null;
  }

  return {
    frequency: frequency,
    clarity: Math.max(0, 1 - center),
    volume: rms
  };
}


// Update the display.

function displayNote(result) {

  const note = frequencyToNote(result.frequency);

  currentNote = note.name;
  lastDetectedTime = performance.now();
processPracticeNote(note);
  noteDisplay.textContent = note.name;

  frequencyDisplay.textContent =
    result.frequency.toFixed(1) + " Hz";

  confidenceDisplay.textContent =
    "Signal quality: " +
    Math.round(result.clarity * 100) +
    "% | Tuning: " +
    (note.cents >= 0 ? "+" : "") +
    note.cents +
    " cents";

  noteIndicator.style.width =
    Math.max(0, Math.min(100, result.clarity * 100)) + "%";
}


// Main audio processing loop.

// Main audio processing loop.

function analyzeAudio(timestamp) {

  if (!running) return;

  animationFrame = requestAnimationFrame(analyzeAudio);

  if (timestamp - lastAnalysis < 90) {
    return;
  }

  lastAnalysis = timestamp;

  analyser.getFloatTimeDomainData(audioBuffer);

  const result = detectPitch(
    audioBuffer,
    audioContext.sampleRate
  );

  if (result && result.clarity > 0.65) {

    displayNote(result);

  } else {

    if (timestamp - lastDetectedTime > 250) {
      lastPracticeMidi = null;
    }

    if (timestamp - lastDetectedTime > 500) {

      noteDisplay.textContent = "--";
      frequencyDisplay.textContent = "0.0 Hz";
      confidenceDisplay.textContent = "Waiting for a note...";
      noteIndicator.style.width = "0%";

      currentNote = null;
    }
  }
}

// Start microphone.

// Start microphone.

async function startListening() {

  try {

    message.textContent = "Requesting microphone access...";

    microphoneStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

    audioContext = new (
      window.AudioContext ||
      window.webkitAudioContext
    )();

    await audioContext.resume();

    microphone =
      audioContext.createMediaStreamSource(microphoneStream);

    analyser = audioContext.createAnalyser();

    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;

    microphone.connect(analyser);

    audioBuffer = new Float32Array(
      analyser.fftSize
    );

    running = true;

    lastAnalysis = 0;
    lastDetectedTime = 0;

    startButton.disabled = true;
    stopButton.disabled = false;

    connectionStatus.textContent = "Listening";
    connectionStatus.className = "status connected";

    message.textContent =
      "Microphone active. Play a note on your keyboard.";

    analyzeAudio();

  } catch (error) {

    console.error(error);

    message.textContent =
      "Microphone error: " + error.message;

    stopListening();
  }
}

// Stop microphone.

function stopListening() {

  running = false;

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (microphoneStream) {

    microphoneStream.getTracks().forEach(track => {
      track.stop();
    });

    microphoneStream = null;
  }

  if (audioContext) {

    audioContext.close();
    audioContext = null;
  }

  microphone = null;
  analyser = null;

  startButton.disabled = false;
  stopButton.disabled = true;

  connectionStatus.textContent = "Not Listening";
  connectionStatus.className = "status disconnected";

  message.textContent = "Microphone is not active.";

  noteDisplay.textContent = "--";
  frequencyDisplay.textContent = "0.0 Hz";
  confidenceDisplay.textContent = "Waiting for a note...";
  noteIndicator.style.width = "0%";

  currentNote = null;
}


startButton.addEventListener(
  "click",
  startListening
);

stopButton.addEventListener(
  "click",
  stopListening
);
// ======================================
// SHEET MUSIC PDF VIEWER
// ======================================

let pdfDocument = null;
let currentPage = 1;
let renderingPDF = false;
let pendingPage = null;

const pdfUpload = document.getElementById("pdfUpload");
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const pdfMessage = document.getElementById("pdfMessage");
const pdfViewer = document.getElementById("pdfViewer");

const pdfCanvas = document.getElementById("pdfCanvas");
const pdfContext = pdfCanvas.getContext("2d");

const previousPage = document.getElementById("previousPage");
const nextPage = document.getElementById("nextPage");
const pageNumber = document.getElementById("pageNumber");


// Upload PDF

pdfUpload.addEventListener("change", async function(event) {

  const file = event.target.files[0];

  if (!file) return;

  if (file.type !== "application/pdf") {
    pdfMessage.textContent = "Please select a PDF file.";
    return;
  }

  if (!window.pdfjsLib) {
    pdfMessage.textContent = "PDF viewer library failed to load.";
    return;
  }

  try {

    pdfMessage.textContent = "Loading sheet music...";

    pdfViewer.hidden = true;

    const fileData = await file.arrayBuffer();

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(fileData)
    });

    const loadedDocument = await loadingTask.promise;

    pdfDocument = loadedDocument;
    currentPage = 1;

    pdfViewer.hidden = false;

    pdfMessage.textContent =
      file.name + " loaded successfully.";

    await renderPDFPage(currentPage);

  } catch(error) {

    console.error(error);

    pdfMessage.textContent =
      "Unable to load PDF: " + error.message;

    pdfDocument = null;
    pdfViewer.hidden = true;

  }

});


// Render selected PDF page

async function renderPDFPage(pageNumberToRender) {

  if (!pdfDocument) return;

  if (renderingPDF) {
    pendingPage = pageNumberToRender;
    return;
  }

  renderingPDF = true;

  try {

    const page = await pdfDocument.getPage(
      pageNumberToRender
    );

    const containerWidth =
      pdfCanvas.parentElement.clientWidth - 10;

    const originalViewport = page.getViewport({
      scale: 1
    });

    const scale = Math.min(
      containerWidth / originalViewport.width,
      2
    );

    const viewport = page.getViewport({
      scale: scale
    });

    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    pdfCanvas.width = Math.floor(
      viewport.width * pixelRatio
    );

    pdfCanvas.height = Math.floor(
      viewport.height * pixelRatio
    );

    pdfCanvas.style.width = viewport.width + "px";
    pdfCanvas.style.height = viewport.height + "px";

    const renderContext = {
      canvasContext: pdfContext,
      viewport: viewport,
      transform: pixelRatio === 1
        ? null
        : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    };

    await page.render(renderContext).promise;

    currentPage = pageNumberToRender;

    pageNumber.textContent =
      "Page " + currentPage +
      " of " + pdfDocument.numPages;

    previousPage.disabled = currentPage <= 1;

    nextPage.disabled =
      currentPage >= pdfDocument.numPages;

  } catch(error) {

    console.error("PDF rendering error:", error);

    pdfMessage.textContent =
      "Unable to display this page.";

  } finally {

    renderingPDF = false;

    if (pendingPage !== null) {

      const nextPageToRender = pendingPage;
      pendingPage = null;

      renderPDFPage(nextPageToRender);

    }

  }

}


// Page navigation

previousPage.addEventListener("click", function() {

  if (pdfDocument && currentPage > 1) {
    renderPDFPage(currentPage - 1);
  }

});

nextPage.addEventListener("click", function() {

  if (
    pdfDocument &&
    currentPage < pdfDocument.numPages
  ) {
    renderPDFPage(currentPage + 1);
  }

});


// Re-render when screen orientation or size changes.

let pdfResizeTimer;

window.addEventListener("resize", function() {

  if (!pdfDocument) return;

  clearTimeout(pdfResizeTimer);

  pdfResizeTimer = setTimeout(function() {
    renderPDFPage(currentPage);
  }, 300);

});
// ======================================
// PIANO PRACTICE ENGINE - TEST MODE
// ======================================

const practiceSequence = [
  { name: "C4", midi: 60 },
  { name: "D4", midi: 62 },
  { name: "E4", midi: 64 },
  { name: "F4", midi: 65 },
  { name: "G4", midi: 67 }
];

const practiceSequenceDisplay =
  document.getElementById("practiceSequence");

const practiceFeedback =
  document.getElementById("practiceFeedback");

const practiceProgress =
  document.getElementById("practiceProgress");

const startPracticeButton =
  document.getElementById("startPractice");

const resetPracticeButton =
  document.getElementById("resetPractice");

let practiceActive = false;
let practiceIndex = 0;
let lastPracticeMidi = null;

function updatePracticeDisplay() {

  const completed = practiceSequence
    .slice(0, practiceIndex)
    .map(note =>
      `<span style="color:#42d98b">${note.name}</span>`
    );

  const remaining = practiceSequence
    .slice(practiceIndex)
    .map((note, index) => {

      if (index === 0) {
        return `<span style="color:#ffd45c">${note.name}</span>`;
      }

      return `<span style="color:#aebdca">${note.name}</span>`;
    });

  practiceSequenceDisplay.innerHTML =
    [...completed, ...remaining].join(" → ");

  practiceProgress.textContent =
    "Notes completed: " +
    practiceIndex +
    " / " +
    practiceSequence.length;
}


function processPracticeNote(note) {

  if (!practiceActive) return;

  // Don't repeatedly count a sustained note.
  if (lastPracticeMidi === note.midi) return;

  lastPracticeMidi = note.midi;

  const expected = practiceSequence[practiceIndex];

  if (!expected) return;

  if (note.midi === expected.midi) {

    practiceIndex++;

    practiceFeedback.textContent =
      "Correct! " + expected.name;

    practiceFeedback.style.color = "#42d98b";

    updatePracticeDisplay();

    if (practiceIndex >= practiceSequence.length) {

      practiceActive = false;

      practiceFeedback.textContent =
        "Excellent! You completed the practice sequence!";

      practiceFeedback.style.color = "#42d98b";

    }

  } else {

    practiceFeedback.textContent =
      "You played " + note.name +
      " — expected " + expected.name;

    practiceFeedback.style.color = "#ff6868";

  }

}


function startPractice() {

  practiceIndex = 0;
  lastPracticeMidi = null;
  practiceActive = true;

  updatePracticeDisplay();

  practiceFeedback.textContent =
    "Play C4 to begin.";

  practiceFeedback.style.color = "#ffd45c";

}


function resetPractice() {

  practiceActive = false;
  practiceIndex = 0;
  lastPracticeMidi = null;

  updatePracticeDisplay();

  practiceFeedback.textContent =
    "Practice reset. Press Start Practice when ready.";

  practiceFeedback.style.color = "#bdcbd6";

}


startPracticeButton.addEventListener(
  "click",
  startPractice
);

resetPracticeButton.addEventListener(
  "click",
  resetPractice
);

updatePracticeDisplay();
