
const reverbPresets = [
  { name: "Hall (2 Bars)", totalNotes: 2 },
  { name: "Large Room (1 Bar)", totalNotes: 1 },
  { name: "Small Room (1/2 Note)", totalNotes: 0.5 },
  { name: "Tight Ambience (1/4 Note)", totalNotes: 0.25 }
];

const noteValues = [
  { label: "1/1", factor: 1 },
  { label: "1/2", factor: 0.5 },
  { label: "1/4", factor: 0.25 },
  { label: "1/8", factor: 0.125 },
  { label: "1/16", factor: 0.0625 },
  { label: "1/32", factor: 0.03125 },
  { label: "1/64", factor: 0.015625 }
];

function calculateTimes() {
  const bpm = parseFloat(document.getElementById("bpm").value);
  if (!bpm || bpm <= 0) return;

  const beatMs = 60000 / bpm;

  // Reverb table
  const reverbBody = document.getElementById("reverbResults");
  reverbBody.innerHTML = "";

  reverbPresets.forEach(preset => {
    const totalTime = beatMs * 4 * preset.totalNotes;
    const preDelay = beatMs / 16;
    const decay = totalTime - preDelay;

    reverbBody.innerHTML += `
      <tr>
        <td>${preset.name}</td>
        <td>${preDelay.toFixed(2)}</td>
        <td>${decay.toFixed(2)}</td>
        <td>${totalTime.toFixed(2)}</td>
      </tr>
    `;
  });

  // Delay table
  const delayBody = document.getElementById("delayResults");
  delayBody.innerHTML = "";

  noteValues.forEach(note => {
    const normal = beatMs * 4 * note.factor;
    const dotted = normal * 1.5;
    const triplet = normal * (2 / 3);

    delayBody.innerHTML += `
      <tr>
        <td>${note.label}</td>
        <td>${normal.toFixed(2)} ms</td>
        <td>${dotted.toFixed(2)} ms</td>
        <td>${triplet.toFixed(2)} ms</td>
      </tr>
    `;
  });
}

document.getElementById("calculate").addEventListener("click", calculateTimes);
calculateTimes();
